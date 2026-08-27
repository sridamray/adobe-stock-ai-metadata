const OPENAI_URL = "https://api.openai.com/v1/responses";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_METADATA") {
    generateMetadata(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
    return true;
  }
});

async function generateMetadata({ imageUrl, settings, uniqueness }) {
  if (!imageUrl) throw new Error("No selected Adobe Stock image was found.");

  const s = settings || {};
  const provider = s.provider || "openai";
  const count = Math.min(49, Math.max(5, Number(s.keywordCount) || 49));
  const imageData = await imageUrlToData(imageUrl);
  const prompt = buildPrompt({
    assetType: s.assetType || "Vector",
    category: s.category || "Auto",
    keywordCount: count,
    language: s.language || "English",
    titleStyle: s.titleStyle || "SEO-friendly",
    uniqueness: uniqueness || {}
  });

  let result;
  if (provider === "gemini") {
    result = await generateWithGemini(imageData, prompt, s.geminiApiKey, s.geminiModel || "gemini-3.7-flash");
  } else if (provider === "auto") {
    if (!s.apiKey && !s.geminiApiKey) throw new Error("Add an OpenAI API key or Google AI Studio API key in Settings.");
    try {
      if (!s.apiKey) throw new Error("OpenAI key not configured.");
      result = await generateWithOpenAI(imageData, prompt, s.apiKey, s.model || "gpt-4.1-mini");
    } catch (openaiError) {
      if (!s.geminiApiKey) throw new Error(`OpenAI failed: ${openaiError.message}`);
      result = await generateWithGemini(imageData, prompt, s.geminiApiKey, s.geminiModel || "gemini-3.7-flash");
      result.fallback = true;
      result.providerMessage = `OpenAI failed, so Gemini was used automatically: ${openaiError.message}`;
    }
  } else {
    result = await generateWithOpenAI(imageData, prompt, s.apiKey, s.model || "gpt-4.1-mini");
  }

  const title = String(result.title || "").trim().slice(0, 200);
  let keywords = Array.isArray(result.keywords) ? result.keywords : [];
  keywords = keywords
    .map(k => String(k).trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((k, i, arr) => arr.findIndex(x => x.toLowerCase() === k.toLowerCase()) === i)
    .slice(0, count);

  if (!title) throw new Error("The AI response did not contain a usable title.");
  if (keywords.length < 5) throw new Error(`The AI returned only ${keywords.length} keywords. Please generate again.`);
  return { ok: true, title, keywords, provider: result.provider, fallback: !!result.fallback, providerMessage: result.providerMessage || "" };
}

async function generateWithOpenAI(imageData, prompt, apiKey, model) {
  if (!apiKey) throw new Error("OpenAI API key is missing.");
  const body = {
    model,
    input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      { type: "input_image", image_url: imageData.dataUrl, detail: "high" }
    ] }]
  };
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`OpenAI returned a non-JSON response (${response.status}).`); }
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}.`);
  const text = extractOpenAIText(data);
  return { ...parseJsonResult(text), provider: "OpenAI" };
}

async function generateWithGemini(imageData, prompt, apiKey, model) {
  if (!apiKey) throw new Error("Google AI Studio API key is missing.");

  const requested = String(model || "gemini-3.7-flash").trim().replace(/^models\//, "");
  const candidates = buildGeminiModelFallbacks(requested);
  let lastError = null;

  for (const candidateModel of candidates) {
    try {
      return await callGeminiModel(imageData, prompt, apiKey, candidateModel);
    } catch (error) {
      lastError = error;
      if (!isRetryableGeminiError(error)) throw error;
      // If Google is temporarily overloaded, move to the next stable Flash model.
      // A short delay also helps with transient 429/503 responses.
      await sleep(700);
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

function buildGeminiModelFallbacks(requested) {
  const defaults = [
    requested,
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite"
  ];
  return [...new Set(defaults.map(x => String(x).replace(/^models\//, "").trim()).filter(Boolean))];
}

function isRetryableGeminiError(error) {
  const msg = String(error?.message || "");
  return /HTTP (429|500|502|503|504)|RESOURCE_EXHAUSTED|high demand|temporarily|overloaded|unavailable/i.test(msg);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiModel(imageData, prompt, apiKey, model) {
  const safeModel = String(model || "gemini-3.7-flash").trim().replace(/^models\//, "");
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(safeModel)}:generateContent`;

  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: imageData.mimeType || "image/jpeg", data: imageData.base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 4096
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Gemini ${safeModel} returned a non-JSON HTTP response (${response.status}).`); }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Gemini request failed with HTTP ${response.status}.`;
    throw new Error(`Gemini ${safeModel}: ${message} (HTTP ${response.status})`);
  }

  const text = extractGeminiText(data);
  return { ...parseJsonResult(text), provider: `Google Gemini (${safeModel})` };
}

async function imageUrlToData(url) {
  const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the selected thumbnail image (${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The selected Adobe Stock thumbnail is not an image.");
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const base64 = btoa(binary);
  return { base64, mimeType: blob.type, dataUrl: `data:${blob.type};base64,${base64}` };
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) for (const content of item.content || []) if (typeof content.text === "string") parts.push(content.text);
  const text = parts.join("\n").trim();
  if (!text) throw new Error("OpenAI returned no text output.");
  return text;
}

function extractGeminiText(data) {
  // Standard Gemini GenerateContent response:
  // candidates[0].content.parts[].text
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const parts = [];

  for (const candidate of candidates) {
    const candidateParts = candidate?.content?.parts;
    if (Array.isArray(candidateParts)) {
      for (const part of candidateParts) {
        if (typeof part?.text === "string" && part.text.trim()) {
          parts.push(part.text.trim());
        }
      }
    }
  }

  // Also support alternative response shapes defensively.
  if (!parts.length && typeof data?.output_text === "string") {
    parts.push(data.output_text.trim());
  }
  if (!parts.length && Array.isArray(data?.outputs)) {
    for (const output of data.outputs) {
      if (typeof output?.text === "string") parts.push(output.text.trim());
      for (const part of output?.content || []) {
        if (typeof part?.text === "string") parts.push(part.text.trim());
      }
    }
  }

  const text = parts.filter(Boolean).join("\n").trim();
  if (text) return text;

  const finishReasons = candidates
    .map(c => c?.finishReason)
    .filter(Boolean);
  const blockReason = data?.promptFeedback?.blockReason;

  if (blockReason) {
    throw new Error(`Gemini blocked the request (${blockReason}). Try another image or prompt.`);
  }
  if (finishReasons.length) {
    throw new Error(`Gemini returned no text output (finish reason: ${finishReasons.join(", ")}).`);
  }

  throw new Error("Gemini returned no text output. Check the selected model/API key and try again.");
}

function parseJsonResult(text) {
  let cleaned = String(text || "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  throw new Error("Could not parse the AI metadata as JSON.");
}

function buildPrompt({ assetType, category, keywordCount, language, titleStyle, uniqueness }) {
  const previousTitles = Array.isArray(uniqueness?.previousTitles) ? uniqueness.previousTitles.slice(-20) : [];
  const previousKeywords = Array.isArray(uniqueness?.previousKeywords) ? uniqueness.previousKeywords.slice(-300) : [];
  return `
You are an expert Adobe Stock metadata editor.

Analyze the supplied image carefully. Create metadata that accurately describes ONLY what is visibly supported by the image. Do not invent brands, locations, events, identities, professions, or other details that cannot be verified from the image.

Target marketplace: Adobe Stock.
Asset type: ${assetType}.
Category hint: ${category}.
Language: ${language}.
Title style: ${titleStyle}.
Required keyword count: exactly ${keywordCount} keywords.

UNIQUENESS RULES FOR A BATCH:
- This image is one item in a batch of related stock assets. Make the title clearly unique from previous titles by focusing on the exact visible pose, action, direction, body position, composition, viewpoint, or other visible distinction.
- Do not copy or lightly reword a previous title.
- Keywords must be image-specific and SEO-relevant. Keep the strongest core subject terms, but vary secondary keywords based on what is actually different in this image. Do not pad keywords with irrelevant terms just to make them different.
- Avoid exact duplicate keyword entries.
- Previous titles (do not copy): ${JSON.stringify(previousTitles)}
- Recent keywords used in this batch (avoid unnecessary repetition): ${JSON.stringify(previousKeywords)}

TITLE RULES:
- One natural, searchable English title.
- Maximum 200 characters.
- Put the most important subject/action near the beginning.
- Describe the visible subject, action, pose, style, and useful composition details.
- Avoid keyword stuffing, repetition, quotation marks, hashtags, file names, and promotional claims.
- Do not use words such as "best", "amazing", "perfect", "high quality".
- Do not identify a real person.
- For a silhouette/vector, accurately mention silhouette/vector/illustration only when visibly appropriate.

KEYWORD RULES:
- Return exactly ${keywordCount} relevant keywords.
- Put the most important 10 keywords first.
- Use a mix of single words and useful two-word phrases.
- Avoid duplicates and near-duplicates.
- Avoid generic filler unless it is actually useful for this image.
- Do not include brands, copyrighted character names, celebrity names, locations, or events unless clearly visible and appropriate.
- Do not repeat words excessively.
- Keep keywords in English.
- Lowercase is preferred.
- Keywords must be comma-safe strings: do not put commas inside a keyword phrase.

RETURN JSON ONLY:
{
  "title": "your title",
  "keywords": ["keyword 1", "keyword 2", "..."]
}
`;
}
