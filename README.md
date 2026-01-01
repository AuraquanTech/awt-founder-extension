# Superpower ChatGPT 2.0 (Clean-Room)

A privacy-first Chrome extension that runs **packaged** (no-remote) scripts on supported pages (ChatGPT domains by default).

## Included scripts (enabled by default)
- **ChatGPT: Export button** — floating export button (TXT / Markdown / JSON)
- **ChatGPT: Conversation manager** — autosave to local storage + searchable mini panel, Save/Export/Copy actions

## Privacy
- Uses **chrome.storage.local** only (no sync).
- No remote code, no external requests.

## Quick actions
- Popup buttons: Export TXT/MD/JSON, Save, Copy MD, Re-run scripts
- Keyboard shortcuts:
  - Toggle extension
  - Quick export (default format)
  - Open conversation search (Options)

## Dev notes
- MV3 service worker: `background/service-worker.js` (ESM)
- Content bootstrap (classic content script): `content/content-script.js` dynamically imports `content/runner.js`
- Scripts live in `scripts/**` and are loaded by registry entries.

## Load unpacked
1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
