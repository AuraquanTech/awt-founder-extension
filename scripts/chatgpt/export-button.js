/**
 * ChatGPT Export Button (packaged script)
 * ======================================
 * Floating button with multi-format export (TXT/MD/JSON).
 * - Click: export default format (from options or script default)
 * - Shift+Click: Markdown
 * - Alt/Option+Click: JSON
 */

function extFor(fmt) {
  if (fmt === "md" || fmt === "markdown") return "md";
  if (fmt === "json") return "json";
  return "txt";
}

export default async function run({ api, context }) {
  const BTN_ID = "awt-chatgpt-export-btn";
  if (!api.ensureOnce(BTN_ID)) return;

  const opts = context?.settings?.scriptOptions?.[context?.scriptMeta?.id] || context?.scriptMeta?.defaultOptions || {};
  const position = opts.buttonPosition || "bottom-left";

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.className = "awt-btn";
  btn.textContent = "Export";

  const left = position === "bottom-right" ? "auto" : "18px";
  const right = position === "bottom-right" ? "18px" : "auto";

  Object.assign(btn.style, {
    position: "fixed",
    bottom: "18px",
    left,
    right,
    zIndex: 999999,
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid rgba(0,0,0,0.15)",
    background: "rgba(255,255,255,0.92)",
    color: "#111827",
    fontSize: "12px",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
  });

  const doExport = async (fmt) => {
    const conv = api.getConversation();
    const normalized = fmt === "markdown" ? "md" : fmt;
    const text = api.format(conv, normalized);
    const ext = extFor(normalized);
    await api.downloadText(`${conv.id}-${Date.now()}.${ext}`, text, normalized === "json" ? "application/json" : normalized === "md" ? "text/markdown" : "text/plain");
  };

  btn.addEventListener("click", (e) => {
    const fmt = e.altKey ? "json" : e.shiftKey ? "md" : (opts.defaultFormat || "txt");
    doExport(fmt);
  });

  document.documentElement.appendChild(btn);

  // clean up if removed
  return () => {
    try { btn.remove(); } catch {}
  };
}

// Optional action handler so popup can invoke format-specific export through the script
export async function onAction({ api, action, payload }) {
  if (action !== "export") return;
  const fmt = payload?.format || "txt";
  const conv = api.getConversation();
  const text = api.format(conv, fmt === "markdown" ? "md" : fmt);
  const ext = extFor(fmt);
  await api.downloadText(`${conv.id}-${Date.now()}.${ext}`, text, fmt === "json" ? "application/json" : fmt === "md" ? "text/markdown" : "text/plain");
}
