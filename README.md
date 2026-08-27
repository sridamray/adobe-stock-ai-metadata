# Adobe Stock AI Metadata Assistant 1.5

Chrome extension for Adobe Stock Contributor. Generates SEO-friendly, image-specific titles and keywords with OpenAI or Google AI Studio (Gemini), then fills Adobe Stock's metadata fields.

## v1.5 features
- Sticky in-page AI sidebar on Adobe Stock uploads.
- Sidebar can be hidden and shown again.
- Detects multiple selected upload tiles.
- **Generate Selected** processes each selected file one by one.
- Each file gets its own AI analysis and its own title/keyword set.
- Batch uniqueness memory: previous titles are sent to the AI so it does not copy/reword them.
- Secondary keywords are varied when the image visibly supports the variation; irrelevant filler is prohibited.
- Progress bar and per-file success/failure log.
- OpenAI, Google AI Studio (Gemini), or Auto fallback.
- Default Gemini model: `gemini-3.1-flash-lite`.
- Adobe Stock title selector: `[data-t="asset-title-content-tagger"]`.
- Adobe Stock keyword selector: `#content-keywords-ui-textarea`.

## Setup
1. Extract the ZIP.
2. Chrome → `chrome://extensions` → Developer mode → Load unpacked.
3. Select the extracted extension folder.
4. Open/refresh Adobe Stock Contributor uploads.
5. Open the extension popup → Settings → add API key(s).
6. Select Gemini/OpenAI/Auto.
7. Select multiple Adobe Stock files.
8. Use the sticky **Generate Selected** sidebar.

## Important
The extension intentionally makes direct browser API calls and stores API keys in Chrome extension storage. Do not share the extension folder or API keys. For better security, restrict/rotate exposed keys.
