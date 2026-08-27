let activeTabId = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  $("settingsBtn").addEventListener("click", () => $("settings").classList.toggle("hidden"));
  $("provider").addEventListener("change", updateProviderUI);
  $("showKey").addEventListener("click", () => {
    $("apiKey").type = $("apiKey").type === "password" ? "text" : "password";
    $("showKey").textContent = $("apiKey").type === "password" ? "Show" : "Hide";
  });
  $("showGeminiKey").addEventListener("click", () => {
    $("geminiApiKey").type = $("geminiApiKey").type === "password" ? "text" : "password";
    $("showGeminiKey").textContent = $("geminiApiKey").type === "password" ? "Show" : "Hide";
  });
  $("saveSettings").addEventListener("click", saveSettings);
  $("testApi").addEventListener("click", testApi);
  $("refresh").addEventListener("click", loadSelection);
  $("generate").addEventListener("click", generateAndApply);
  $("copyResult").addEventListener("click", copyResult);
  await loadSelection();
});

async function loadSettings() {
  const s = await chrome.storage.local.get({
    provider: "openai",
    apiKey: "",
    model: "gpt-4.1-mini",
    geminiApiKey: "",
    geminiModel: "gemini-3.1-flash-lite",
    assetType: "Vector",
    category: "Auto",
    keywordCount: "49",
    language: "English"
  });
  $("provider").value = s.provider;
  $("apiKey").value = s.apiKey;
  $("model").value = s.model;
  $("geminiApiKey").value = s.geminiApiKey;
  $("geminiModel").value = s.geminiModel;
  updateProviderUI();
  $("assetType").value = s.assetType;
  $("category").value = s.category;
  $("keywordCount").value = String(s.keywordCount);
  $("language").value = s.language;
}

async function saveSettings(showMessage = true) {
  const settings = {
    provider: $("provider").value,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gpt-4.1-mini",
    geminiApiKey: $("geminiApiKey").value.trim(),
    geminiModel: $("geminiModel").value.trim() || "gemini-3.7-flash",
    assetType: $("assetType").value,
    category: $("category").value.trim() || "Auto",
    keywordCount: Number($("keywordCount").value),
    language: $("language").value
  };
  await chrome.storage.local.set(settings);
  if (showMessage) setStatus("settingsStatus", "Settings saved.", "ok");
  return settings;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadSelection() {
  setStatus("status", "Checking selected Adobe Stock image…", "info");
  const selection = $("selection");
  selection.innerHTML = '<div class="spinner"></div><span>Checking selected image…</span>';

  try {
    const tab = await getActiveTab();
    activeTabId = tab?.id;
    if (!activeTabId) throw new Error("No active browser tab.");

    const result = await sendToStockPage(activeTabId, { type: "GET_SELECTION" });
    if (!result?.ok) throw new Error(result?.error || "No selected image.");

    selection.innerHTML = `
      <img class="thumb" src="${escapeHtmlAttr(result.imageUrl)}">
      <div class="selection-text">
        <strong>Image selected ✓</strong>
        <span>${escapeHtml(result.imageUrl)}</span>
      </div>
    `;
    setStatus("status", "Ready. Click Generate & Apply.", "ok");
  } catch (error) {
    selection.innerHTML = `<span>${escapeHtml(error.message || "Open an Adobe Stock upload page and select an image.")}</span>`;
    setStatus("status", "Select one Adobe Stock upload tile first.", "error");
  }
}

async function generateAndApply() {
  const button = $("generate");
  button.disabled = true;
  setStatus("status", "Reading selected image…", "info");

  try {
    const settings = await saveSettings(false);
    if (settings.provider === "openai" && !settings.apiKey) throw new Error("Add your OpenAI API key in ⚙ Settings first.");
    if (settings.provider === "gemini" && !settings.geminiApiKey) throw new Error("Add your Google AI Studio API key in ⚙ Settings first.");
    if (settings.provider === "auto" && !settings.apiKey && !settings.geminiApiKey) throw new Error("Add an OpenAI or Google AI Studio API key in ⚙ Settings first.");

    if (!activeTabId) {
      const tab = await getActiveTab();
      activeTabId = tab?.id;
    }

    const selection = await sendToStockPage(activeTabId, { type: "GET_SELECTION" });
    if (!selection?.ok || !selection.imageUrl) {
      throw new Error(selection?.error || "Select one Adobe Stock image first.");
    }

    setStatus("status", `Analyzing image with ${settings.provider === "gemini" ? "Google Gemini" : settings.provider === "auto" ? "AI" : "OpenAI"}…`, "info");

    const result = await chrome.runtime.sendMessage({
      type: "GENERATE_METADATA",
      imageUrl: selection.imageUrl,
      settings
    });

    if (!result?.ok) throw new Error(result?.error || "Metadata generation failed.");

    $("resultCard").classList.remove("hidden");
    $("resultTitle").value = result.title;
    $("resultKeywords").value = result.keywords.join(", ");
    $("keywordCounter").textContent = `${result.keywords.length} keywords`;

    setStatus("status", "Applying metadata to Adobe Stock…", "info");
    const applied = await sendToStockPage(activeTabId, {
      type: "APPLY_METADATA",
      title: result.title,
      keywords: result.keywords
    });
    if (!applied?.ok) throw new Error(applied?.error || "Could not fill Adobe Stock fields.");

    const providerNote = result.providerMessage ? ` — ${result.providerMessage}` : ` — ${result.provider}`;
    setStatus("status", `Generated + applied ✓ ${applied.keywordCount || result.keywords.length} keywords${providerNote}`, "ok");
  } catch (error) {
    setStatus("status", error.message || "Something went wrong.", "error");
  } finally {
    button.disabled = false;
  }
}

async function testApi() {
  const button = $("testApi");
  button.disabled = true;
  setStatus("settingsStatus", "Testing selected provider…", "info");
  try {
    const settings = await saveSettings(false);
    if (settings.provider === "openai") {
      if (!settings.apiKey) throw new Error("Enter an OpenAI API key first.");
      const response = await fetch("https://api.openai.com/v1/models", { headers: { "Authorization": `Bearer ${settings.apiKey}` } });
      const text = await response.text();
      if (!response.ok) { let message = `HTTP ${response.status}`; try { message = JSON.parse(text)?.error?.message || message; } catch {} throw new Error(message); }
      setStatus("settingsStatus", "OpenAI API key works ✓", "ok");
    } else if (settings.provider === "gemini") {
      if (!settings.geminiApiKey) throw new Error("Enter a Google AI Studio API key first.");
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(settings.geminiApiKey));
      const text = await response.text();
      if (!response.ok) { let message = `HTTP ${response.status}`; try { message = JSON.parse(text)?.error?.message || message; } catch {} throw new Error(message); }
      setStatus("settingsStatus", "Google AI Studio API key works ✓", "ok");
    } else {
      const results = [];
      if (settings.apiKey) {
        const r = await fetch("https://api.openai.com/v1/models", { headers: { "Authorization": `Bearer ${settings.apiKey}` } });
        results.push(`OpenAI ${r.ok ? "✓" : "✗"}`);
      } else results.push("OpenAI not configured");
      if (settings.geminiApiKey) {
        const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(settings.geminiApiKey));
        results.push(`Gemini ${r.ok ? "✓" : "✗"}`);
      } else results.push("Gemini not configured");
      setStatus("settingsStatus", results.join(" · "), "ok");
    }
  } catch (error) {
    setStatus("settingsStatus", error.message || "API test failed.", "error");
  } finally {
    button.disabled = false;
  }
}

function updateProviderUI() {
  const provider = $("provider")?.value || "openai";
  $("openaiSettings")?.classList.toggle("hidden", provider === "gemini");
  $("geminiSettings")?.classList.toggle("hidden", provider === "openai");
}

async function copyResult() {
  const title = $("resultTitle").value;
  const keywords = $("resultKeywords").value;
  await navigator.clipboard.writeText(`${title}\n\n${keywords}`);
  setStatus("status", "Title + keywords copied.", "ok");
}


async function sendToStockPage(tabId, message) {
  if (!tabId) throw new Error("No active Adobe Stock tab.");
  try {
    const direct = await chrome.tabs.sendMessage(tabId, message);
    if (direct) return direct;
  } catch (e) {
    // The page may have been opened before the extension was loaded/reloaded.
    // Fall back to programmatic injection so the user does not need to reload.
  }

  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: stockPageBridge,
    args: [message]
  });
  const result = injected?.[0]?.result;
  if (!result) throw new Error("Could not connect to the Adobe Stock page. Refresh the Adobe Stock tab once and try again.");
  return result;
}

function stockPageBridge(message) {
  function getSelectedAsset() {
    const selectors = [
      '[role="option"][aria-selected="true"] img.upload-tile__thumbnail',
      '[role="option"][aria-selected="true"] img[data-t="upload-thumbnail"]',
      '.upload-tile__wrapper.active img.upload-tile__thumbnail',
      '[data-t="assets-content-grid"] [role="option"][aria-selected="true"] img',
      '[data-t="assets-content-grid"] .upload-tile__wrapper.active img'
    ];
    let option = null;
    for (const selector of selectors) {
      option = document.querySelector(selector);
      if (option?.src) break;
    }
    if (!option?.src) throw new Error("Select one Adobe Stock upload tile first.");
    return {
      imageUrl: option.currentSrc || option.src,
      title: readTitle(),
      keywords: readKeywords()
    };
  }

  function readTitle() {
    return document.querySelector('[data-t="asset-title-content-tagger"], textarea[name="title"], textarea[aria-label*="title" i]')?.value || "";
  }
  function readKeywords() {
    return document.querySelector('#content-keywords-ui-textarea, textarea[name="keywordsUITextArea"]')?.value || "";
  }
  function applyMetadata(title, keywords) {
    const titleField = document.querySelector('[data-t="asset-title-content-tagger"], textarea[name="title"], textarea[aria-label*="title" i]');
    const keywordField = document.querySelector('#content-keywords-ui-textarea, textarea[name="keywordsUITextArea"]');
    if (!titleField) throw new Error("Adobe Stock Content title field was not found. Open the selected file details first.");
    if (!keywordField) throw new Error("Adobe Stock Keywords field was not found. Open the selected file details first.");
    setReactValue(titleField, String(title || "").slice(0, 200));
    const keywordText = Array.isArray(keywords) ? keywords.map(k => String(k).trim()).filter(Boolean).join(", ") : String(keywords || "");
    setReactValue(keywordField, keywordText);
    titleField.dispatchEvent(new Event("change", {bubbles:true}));
    keywordField.dispatchEvent(new Event("change", {bubbles:true}));
    titleField.dispatchEvent(new Event("blur", {bubbles:true}));
    keywordField.dispatchEvent(new Event("blur", {bubbles:true}));
    return {ok:true, title:titleField.value, keywordCount: keywordText ? keywordText.split(",").map(x=>x.trim()).filter(Boolean).length : 0};
  }
  function setReactValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    try { element.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:value})); }
    catch { element.dispatchEvent(new Event("input", {bubbles:true})); }
    element.dispatchEvent(new Event("change", {bubbles:true}));
  }
  try {
    if (message?.type === "GET_SELECTION") return {ok:true, ...getSelectedAsset()};
    if (message?.type === "APPLY_METADATA") return applyMetadata(message.title, message.keywords);
    return {ok:false, error:"Unknown page message."};
  } catch (error) {
    return {ok:false, error:error?.message || String(error)};
  }
}

function setStatus(id, message, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type || ""}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function escapeHtmlAttr(value) { return escapeHtml(value); }