// Content-script entrypoint (no static imports for max compatibility)
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL("content/runner.js"));
    await mod.bootContentRunner();
  } catch (e) {
    // Fail silently but log for debugging
    console.warn("[AWT] Failed to boot runner:", e);
  }
})();
