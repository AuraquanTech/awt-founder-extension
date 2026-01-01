/**
 * ChatGPT Conversation Manager (packaged script)
 * =============================================
 * - Autosave on new messages (debounced + hash check)
 * - Small panel UI: search saved, save now, export/copy
 */

let observer = null;
let autosaveTimer = null;
let lastSavedHash = "";

function ensureStyles() {
  const STYLE_ID = "awt-conv-manager-style";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .awt-fab{position:fixed;bottom:18px;right:18px;z-index:999999;}
    .awt-fab button{width:44px;height:44px;border-radius:14px;border:1px solid rgba(0,0,0,.15);background:rgba(17,24,39,.92);color:#fff;cursor:pointer;font:600 14px ui-sans-serif,system-ui;}
    .awt-panel{position:fixed;right:18px;bottom:72px;width:360px;max-height:70vh;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:14px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.98);box-shadow:0 12px 30px rgba(0,0,0,.18);z-index:999999;font:12px ui-sans-serif,system-ui;color:#111827;}
    .awt-panel.awt-hidden{display:none;}
    .awt-row{display:flex;gap:8px;align-items:center;}
    .awt-row input{flex:1;padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.12);outline:none;}
    .awt-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
    .awt-actions button{padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#f9fafb;cursor:pointer;}
    .awt-list{overflow:auto;max-height:46vh;border-top:1px solid rgba(0,0,0,.08);padding-top:8px;}
    .awt-item{padding:8px;border-radius:10px;border:1px solid rgba(0,0,0,.08);margin-bottom:8px;cursor:pointer;}
    .awt-item .t{font-weight:700;font-size:12px;margin-bottom:4px;}
    .awt-item .m{font-size:11px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  `;
  document.documentElement.appendChild(style);
}

async function renderList(api, panel, query) {
  const res = await api.listConversations(query || "");
  const list = panel.querySelector("#awt-list");
  list.innerHTML = "";
  const items = res?.items || [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.style.color = "#6b7280";
    empty.textContent = query ? "No matches." : "No saved conversations yet.";
    list.appendChild(empty);
    return;
  }
  for (const c of items) {
    const div = document.createElement("div");
    div.className = "awt-item";
    div.title = c.url || "";
    div.innerHTML = `<div class="t"></div><div class="m"></div>`;
    div.querySelector(".t").textContent = c.title || c.id;
    div.querySelector(".m").textContent = (c.text || "").replace(/\s+/g," ").slice(0,140);
    div.addEventListener("click", () => {
      if (c.url) window.open(c.url, "_blank", "noopener,noreferrer");
    });
    list.appendChild(div);
  }
}

function watchForMessages(api, opts) {
  if (observer) return;
  const target = api.q("main") || document.body;
  observer = new MutationObserver(() => {
    if (!opts.autosave) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      try {
        const conv = api.getConversation();
        const h = conv?.hash || "";
        // better: ask background-saved hash, but store locally per page
        if (h && h === lastSavedHash) return;
        const resp = await api.saveConversation({ ...conv, autosave: true });
        if (resp?.ok) lastSavedHash = h;
      } catch {}
    }, opts.autosaveDebounceMs || 1200);
  });
  observer.observe(target, { childList: true, subtree: true });
}

export default async function run({ api, context }) {
  ensureStyles();

  const FAB_ID = "awt-conv-fab";
  const PANEL_ID = "awt-conv-panel";
  if (!api.ensureOnce(FAB_ID)) return;

  const opts = context?.settings?.scriptOptions?.[context?.scriptMeta?.id] || context?.scriptMeta?.defaultOptions || {};

  const fab = document.createElement("div");
  fab.id = FAB_ID;
  fab.className = "awt-fab";
  fab.innerHTML = `<button title="Conversation manager">💾</button>`;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "awt-panel awt-hidden";
  panel.innerHTML = `
    <div class="awt-row">
      <input id="awt-search" placeholder="Search saved..." />
      <button id="awt-close" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#fff;cursor:pointer;">✕</button>
    </div>
    <div class="awt-actions">
      <button id="awt-save">Save</button>
      <button id="awt-export">Export</button>
      <button id="awt-copy">Copy</button>
    </div>
    <div id="awt-list" class="awt-list"></div>
  `;

  const toggle = async (open) => {
    panel.classList.toggle("awt-hidden", !open);
    if (open) await renderList(api, panel, panel.querySelector("#awt-search").value || "");
  };

  fab.querySelector("button").addEventListener("click", () => {
    const open = panel.classList.contains("awt-hidden");
    toggle(open);
  });

  panel.querySelector("#awt-close").addEventListener("click", () => toggle(false));

  panel.querySelector("#awt-search").addEventListener("input", async (e) => {
    await renderList(api, panel, e.target.value || "");
  });

  panel.querySelector("#awt-save").addEventListener("click", async () => {
    const conv = api.getConversation();
    await api.saveConversation({ ...conv, autosave: false });
    await renderList(api, panel, panel.querySelector("#awt-search").value || "");
  });

  panel.querySelector("#awt-export").addEventListener("click", async () => {
    const conv = api.getConversation();
    const text = api.format(conv, (context?.settings?.ui?.defaultExportFormat || "md"));
    const fmt = (context?.settings?.ui?.defaultExportFormat || "md");
    const ext = fmt === "json" ? "json" : fmt === "md" ? "md" : "txt";
    await api.downloadText(`${conv.id}-${Date.now()}.${ext}`, text, fmt === "json" ? "application/json" : fmt === "md" ? "text/markdown" : "text/plain");
  });

  panel.querySelector("#awt-copy").addEventListener("click", async () => {
    const conv = api.getConversation();
    const text = api.format(conv, "md");
    await api.copyText(text);
  });

  document.documentElement.appendChild(panel);
  document.documentElement.appendChild(fab);

  watchForMessages(api, opts);

  api.onCleanup(() => { try { observer?.disconnect(); } catch {} observer=null; });

  return () => {
    try { observer?.disconnect(); } catch {}
    try { fab.remove(); } catch {}
    try { panel.remove(); } catch {}
  };
}

export async function onAction({ api, action, payload }) {
  if (action === "toggle") {
    const panel = document.getElementById("awt-conv-panel");
    if (!panel) return;
    panel.classList.toggle("awt-hidden");
  }
  if (action === "save") {
    const conv = api.getConversation();
    return await api.saveConversation({ ...conv, autosave: false });
  }
}
