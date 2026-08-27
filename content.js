(() => {
  const MARK = "__adobe_stock_ai_metadata_loaded_v15__";
  if (window[MARK]) return;
  window[MARK] = true;

  let panel = null;
  let collapsed = false;
  let batchRunning = false;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message?.type === "GET_SELECTION") {
        sendResponse({ ok: true, ...getSelectedAsset() });
        return;
      }
      if (message?.type === "GET_SELECTED_ASSETS") {
        sendResponse({ ok: true, assets: getSelectedAssets() });
        return;
      }
      if (message?.type === "APPLY_METADATA") {
        sendResponse(applyMetadata(message.title, message.keywords));
        return;
      }
      if (message?.type === "SHOW_SIDEBAR") {
        ensureSidebar();
        panel?.classList.remove("asai-hidden");
        collapsed = false;
        updateCollapseState();
        refreshSidebarSelection();
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "HIDE_SIDEBAR") {
        ensureSidebar();
        collapsed = true;
        updateCollapseState();
        sendResponse({ ok: true });
        return;
      }
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  });

  // Keep a page-side sticky assistant available. This is intentionally separate
  // from the Chrome popup so the user can keep it open while editing files.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(ensureSidebar, 300));
  } else {
    setTimeout(ensureSidebar, 300);
  }

  function getSelectedOptions() {
    const selectors = [
      '[data-t="assets-content-grid"] [role="option"][aria-selected="true"]',
      '.content-grid [role="option"][aria-selected="true"]',
      '[role="option"][aria-selected="true"]'
    ];
    for (const selector of selectors) {
      const list = Array.from(document.querySelectorAll(selector));
      if (list.length) return list;
    }
    return [];
  }

  function getSelectedAssets() {
    return getSelectedOptions().map((option, index) => {
      const img = option.querySelector('img.upload-tile__thumbnail, img[data-t="upload-thumbnail"], img');
      return {
        index,
        imageUrl: img?.currentSrc || img?.src || "",
        element: option
      };
    }).filter(x => x.imageUrl);
  }

  function getSelectedAsset() {
    const selected = getSelectedAssets();
    if (!selected.length) throw new Error("Select one Adobe Stock upload tile first.");

    // If multiple files are selected, prefer the most recently active tile.
    const active = document.querySelector('.upload-tile__wrapper.active img.upload-tile__thumbnail')
      || document.querySelector('[role="option"][aria-selected="true"] img.upload-tile__thumbnail');
    const imageUrl = active?.currentSrc || active?.src || selected[0].imageUrl;
    return { imageUrl, title: readTitle(), keywords: readKeywords(), selectedCount: selected.length };
  }

  function readTitle() {
    const el = document.querySelector('[data-t="asset-title-content-tagger"], textarea[name="title"], textarea[aria-label*="title" i]');
    return el?.value || "";
  }

  function readKeywords() {
    const el = document.querySelector('#content-keywords-ui-textarea, textarea[name="keywordsUITextArea"]');
    return el?.value || "";
  }

  function applyMetadata(title, keywords) {
    const titleField = document.querySelector('[data-t="asset-title-content-tagger"], textarea[name="title"], textarea[aria-label*="title" i]');
    const keywordField = document.querySelector('#content-keywords-ui-textarea, textarea[name="keywordsUITextArea"]');
    if (!titleField) throw new Error("Adobe Stock Content title field was not found. Open the selected file details first.");
    if (!keywordField) throw new Error("Adobe Stock Keywords field was not found. Open the selected file details first.");

    setReactValue(titleField, String(title || "").slice(0, 200));
    const keywordText = Array.isArray(keywords)
      ? keywords.map(k => String(k).trim()).filter(Boolean).join(", ")
      : String(keywords || "");
    setReactValue(keywordField, keywordText);

    titleField.dispatchEvent(new Event("change", { bubbles: true }));
    keywordField.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => {
      try {
        titleField.dispatchEvent(new Event("blur", { bubbles: true }));
        keywordField.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch {}
    }, 100);

    return { ok: true, title: titleField.value, keywordCount: keywordText.split(",").map(x => x.trim()).filter(Boolean).length };
  }

  function setReactValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    try {
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function ensureSidebar() {
    if (!document.body) return;
    if (panel && document.body.contains(panel)) {
      refreshSidebarSelection();
      return panel;
    }

    panel = document.createElement("aside");
    panel.id = "asai-sticky-sidebar";
    panel.innerHTML = `
      <div class="asai-head">
        <div class="asai-brand"><span class="asai-logo">AS</span><div><b>Adobe Stock AI</b><small>Batch Metadata</small></div></div>
        <div class="asai-head-actions"><button id="asai-refresh" title="Refresh selection">↻</button><button id="asai-collapse" title="Hide sidebar">−</button></div>
      </div>
      <div class="asai-body">
        <div class="asai-selection-line"><span id="asai-count">0 selected</span><span id="asai-provider">AI</span></div>
        <div class="asai-help">Select multiple upload tiles, then generate. Each file is processed separately for unique, image-specific metadata.</div>
        <div class="asai-controls">
          <button id="asai-generate-selected" class="asai-primary">Generate Selected</button>
          <button id="asai-generate-one" class="asai-secondary">Generate Current</button>
        </div>
        <div class="asai-progress-wrap"><div id="asai-progress-bar"></div></div>
        <div id="asai-progress">Ready.</div>
        <div id="asai-log" class="asai-log"></div>
        <button id="asai-show" class="asai-show">Show AI Sidebar</button>
      </div>
    `;
    document.body.appendChild(panel);
    injectStyles();

    panel.querySelector("#asai-collapse").addEventListener("click", () => {
      collapsed = true;
      updateCollapseState();
    });
    panel.querySelector("#asai-refresh").addEventListener("click", refreshSidebarSelection);
    panel.querySelector("#asai-generate-selected").addEventListener("click", () => runBatch(false));
    panel.querySelector("#asai-generate-one").addEventListener("click", () => runBatch(true));
    panel.querySelector("#asai-show").addEventListener("click", () => {
      collapsed = false;
      updateCollapseState();
    });

    refreshSidebarSelection();
    return panel;
  }

  function updateCollapseState() {
    if (!panel) return;
    panel.classList.toggle("asai-collapsed", collapsed);
    const body = panel.querySelector(".asai-body");
    if (body) body.style.display = collapsed ? "none" : "block";
  }

  function refreshSidebarSelection() {
    if (!panel) return;
    const assets = getSelectedAssets();
    const count = panel.querySelector("#asai-count");
    const provider = panel.querySelector("#asai-provider");
    if (count) count.textContent = `${assets.length} selected`;
    if (provider) {
      chrome.storage.local.get({ provider: "gemini", geminiModel: "gemini-3.1-flash-lite" }).then(s => {
        provider.textContent = s.provider === "auto" ? "Auto AI" : s.provider === "openai" ? "OpenAI" : (s.geminiModel || "Gemini");
      }).catch(() => {});
    }
  }

  async function runBatch(currentOnly) {
    if (batchRunning) return;
    batchRunning = true;
    const generateButton = panel.querySelector("#asai-generate-selected");
    const currentButton = panel.querySelector("#asai-generate-one");
    generateButton.disabled = true;
    currentButton.disabled = true;
    clearLog();

    try {
      const settings = await chrome.storage.local.get({
        provider: "gemini",
        apiKey: "",
        model: "gpt-4.1-mini",
        geminiApiKey: "",
        geminiModel: "gemini-3.1-flash-lite",
        assetType: "Vector",
        category: "Auto",
        keywordCount: 49,
        language: "English"
      });
      if (settings.provider === "gemini" && !settings.geminiApiKey) throw new Error("Add your Google AI Studio API key in the extension Settings.");
      if (settings.provider === "openai" && !settings.apiKey) throw new Error("Add your OpenAI API key in the extension Settings.");
      if (settings.provider === "auto" && !settings.apiKey && !settings.geminiApiKey) throw new Error("Add an OpenAI or Google AI Studio API key in Settings.");

      let assets = getSelectedAssets();
      if (!assets.length) throw new Error("Select at least one Adobe Stock upload tile.");
      if (currentOnly) {
        const current = document.querySelector('.upload-tile__wrapper.active')?.closest('[role="option"]')
          || assets[0].element;
        assets = [{ imageUrl: current.querySelector('img')?.currentSrc || current.querySelector('img')?.src, element: current }].filter(x => x.imageUrl);
      }

      setProgress(0, `Starting ${assets.length} file${assets.length > 1 ? "s" : ""}…`);
      const history = [];
      let success = 0;

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        try {
          setProgress(i / assets.length * 100, `Preparing ${i + 1}/${assets.length}…`);
          await selectTileByUrl(asset.imageUrl);
          await waitForFields(3500);
          const selected = getSelectedAsset();

          const result = await chrome.runtime.sendMessage({
            type: "GENERATE_METADATA",
            imageUrl: selected.imageUrl,
            settings,
            uniqueness: {
              previousTitles: history.map(x => x.title),
              previousKeywords: history.flatMap(x => x.keywords).slice(-500)
            }
          });
          if (!result?.ok) throw new Error(result?.error || "AI generation failed.");

          const applied = applyMetadata(result.title, result.keywords);
          if (!applied.ok) throw new Error(applied.error || "Could not apply metadata.");

          history.push({ title: result.title, keywords: result.keywords });
          success++;
          addLog(`✓ ${i + 1}/${assets.length} — ${result.title}`, "ok");
          setProgress((i + 1) / assets.length * 100, `Completed ${i + 1}/${assets.length}`);

          // Give Adobe's React state/network layer time to persist before moving on.
          await sleep(900);
        } catch (error) {
          addLog(`✗ ${i + 1}/${assets.length} — ${error.message || error}`, "error");
          setProgress((i + 1) / assets.length * 100, `Completed ${i + 1}/${assets.length} (one failed)`);
        }
      }

      setProgress(100, `Finished: ${success}/${assets.length} successful.`);
      refreshSidebarSelection();
    } catch (error) {
      setProgress(0, error.message || String(error));
      addLog(`✗ ${error.message || error}`, "error");
    } finally {
      generateButton.disabled = false;
      currentButton.disabled = false;
      batchRunning = false;
    }
  }

  async function selectTileByUrl(imageUrl) {
    const targetUrl = String(imageUrl || "");
    if (!targetUrl) throw new Error("This batch item has no image URL.");
    let img = Array.from(document.querySelectorAll('img.upload-tile__thumbnail, img[data-t="upload-thumbnail"], [data-t="assets-content-grid"] img')).find(el => (el.currentSrc || el.src) === targetUrl);
    if (!img) {
      img = Array.from(document.querySelectorAll('img.upload-tile__thumbnail, img[data-t="upload-thumbnail"], [data-t="assets-content-grid"] img')).find(el => (el.currentSrc || el.src).split("?")[0] === targetUrl.split("?")[0]);
    }
    if (!img) throw new Error("Could not find this selected upload tile again. Refresh selection and retry.");
    const element = img.closest('[role="option"]') || img.parentElement;
    element.scrollIntoView({ block: "center", inline: "center" });
    await sleep(120);
    const clickable = element.querySelector('.upload-tile__wrapper, img.upload-tile__thumbnail, [title="Content tile"]') || element;
    // Use a real click when possible so Adobe's React selection handlers receive it.
    if (typeof clickable.click === "function") {
      clickable.click();
    } else {
      clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(750);
  }

  async function waitForFields(timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (document.querySelector('[data-t="asset-title-content-tagger"], #content-keywords-ui-textarea')) return true;
      await sleep(180);
    }
    throw new Error("Adobe Stock metadata sidebar did not open for this file.");
  }

  function setProgress(percent, text) {
    const bar = panel?.querySelector("#asai-progress-bar");
    const label = panel?.querySelector("#asai-progress");
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (label) label.textContent = text;
  }

  function clearLog() {
    const log = panel?.querySelector("#asai-log");
    if (log) log.innerHTML = "";
  }
  function addLog(text, type) {
    const log = panel?.querySelector("#asai-log");
    if (!log) return;
    const row = document.createElement("div");
    row.className = `asai-log-row ${type || ""}`;
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function injectStyles() {
    if (document.getElementById("asai-styles")) return;
    const style = document.createElement("style");
    style.id = "asai-styles";
    style.textContent = `
      #asai-sticky-sidebar{position:fixed;right:18px;top:86px;width:360px;z-index:2147483646;background:#fff;border:1px solid #d8d8d8;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.20);font:13px/1.4 Arial,sans-serif;color:#222;overflow:hidden}
      #asai-sticky-sidebar *{box-sizing:border-box}
      #asai-sticky-sidebar .asai-head{height:58px;background:#1d1d1d;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:9px 12px}
      #asai-sticky-sidebar .asai-brand{display:flex;align-items:center;gap:9px}.asai-logo{width:34px;height:34px;border-radius:8px;background:#fff;color:#111;display:grid;place-items:center;font-weight:800}.asai-brand b{display:block;font-size:14px}.asai-brand small{display:block;color:#bbb;font-size:10px;margin-top:1px}
      #asai-sticky-sidebar .asai-head-actions{display:flex;gap:5px}.asai-head-actions button{border:0;background:transparent;color:#fff;font-size:21px;width:28px;height:28px;cursor:pointer;border-radius:5px}.asai-head-actions button:hover{background:#333}
      #asai-sticky-sidebar .asai-body{padding:13px}.asai-selection-line{display:flex;justify-content:space-between;font-weight:700;margin-bottom:8px}.asai-selection-line span:last-child{font-weight:500;color:#555}.asai-help{font-size:11px;color:#666;background:#f6f6f6;border-radius:7px;padding:8px;margin-bottom:11px}
      .asai-controls{display:flex;gap:7px}.asai-controls button{flex:1;border:0;border-radius:7px;padding:10px 8px;font-weight:700;cursor:pointer}.asai-primary{background:#087f73;color:#fff}.asai-secondary{background:#eee;color:#222}.asai-controls button:disabled{opacity:.55;cursor:not-allowed}
      .asai-progress-wrap{height:5px;background:#e9e9e9;border-radius:5px;margin-top:12px;overflow:hidden}.asai-progress-wrap>div{height:100%;width:0;background:#087f73;transition:width .25s}.asai-progress{margin-top:7px}.asai-log{margin-top:8px;max-height:210px;overflow:auto;border-top:1px solid #eee;padding-top:5px}.asai-log-row{padding:5px 3px;border-bottom:1px solid #f0f0f0;font-size:11px}.asai-log-row.error{color:#c62828}.asai-log-row.ok{color:#176b38}.asai-show{display:none;width:100%;border:0;background:#1d1d1d;color:#fff;padding:9px;cursor:pointer}
      #asai-sticky-sidebar.asai-collapsed{width:190px}.asai-collapsed .asai-brand small{display:none}.asai-collapsed .asai-body{display:none!important}.asai-collapsed .asai-show{display:block}
      @media(max-width:700px){#asai-sticky-sidebar{right:8px;top:70px;width:calc(100vw - 16px)}}
    `;
    document.documentElement.appendChild(style);
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
})();
