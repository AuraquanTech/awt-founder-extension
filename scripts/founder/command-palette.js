/**
 * Founder: Command Palette
 * =======================
 * Cmd/Ctrl+K overlay for:
 * - Save / Export / Copy
 * - Open Power Search
 * - Jump to saved conversations
 * - Send artifacts to configured connectors
 */

function isModKey(e) {
  return navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function ensureUI(api, opts = {}) {
  api.ensureOnce("awt-cp-style", () => {
    const css = document.createElement("style");
    css.id = "awt-cp-style";
    css.textContent = `
      #awt-cp-overlay{position:fixed;inset:0;z-index:2147483647;display:none;background:rgba(0,0,0,.35);backdrop-filter: blur(4px);}
      #awt-cp{position:absolute;top:10vh;left:50%;transform:translateX(-50%);width:min(840px,92vw);background:var(--awt-card,#fff);color:var(--awt-text,#111);border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 20px 70px rgba(0,0,0,.25);overflow:hidden}
      @media (prefers-color-scheme: dark){#awt-cp{--awt-card:#0b1220;--awt-text:#e5e7eb;border-color:rgba(255,255,255,.12)}}
      #awt-cp-head{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid rgba(0,0,0,.08)}
      #awt-cp-head input{flex:1;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.18);background:transparent;color:inherit;outline:none}
      #awt-cp-head .hint{opacity:.75;font-size:12px}
      #awt-cp-list{max-height:62vh;overflow:auto}
      .awt-cp-item{padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.06);cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
      .awt-cp-item:hover{background:rgba(0,0,0,.04)}
      .awt-cp-left{display:flex;flex-direction:column;gap:4px}
      .awt-cp-title{font-weight:800}
      .awt-cp-sub{opacity:.78;font-size:12px}
      .awt-cp-right{opacity:.7;font-size:12px;white-space:nowrap}
      .awt-cp-item.sel{background:rgba(37,99,235,.12)}
      @media (prefers-color-scheme: dark){
        #awt-cp-head input{border-color:rgba(255,255,255,.18)}
        .awt-cp-item:hover{background:rgba(255,255,255,.06)}
      }
    `;
    document.documentElement.appendChild(css);
  });

  api.ensureOnce("awt-cp-overlay", () => {
    const overlay = document.createElement("div");
    overlay.id = "awt-cp-overlay";
    overlay.innerHTML = `
      <div id="awt-cp" role="dialog" aria-modal="true">
        <div id="awt-cp-head">
          <input id="awt-cp-q" placeholder="${escapeHtml(opts.placeholder || "Type a command or search…")}" />
          <div class="hint">Esc</div>
        </div>
        <div id="awt-cp-list"></div>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
  });

  const overlay = document.getElementById("awt-cp-overlay");
  const qEl = document.getElementById("awt-cp-q");
  const listEl = document.getElementById("awt-cp-list");

  const state = { open: false, query: "", items: [], sel: 0, connectors: null };

  async function loadConnectors() {
    const res = await api.getConnectors();
    state.connectors = res?.connectors || { byId: {}, order: [] };
  }

  function commands() {
    const base = [
      { kind: "cmd", id: "save", title: "Save current chat", sub: "Store locally (stable /c/<id> key)", right: "Enter" },
      { kind: "cmd", id: "export_md", title: "Export current chat → Markdown", sub: "Downloads .md", right: "Enter" },
      { kind: "cmd", id: "copy_md", title: "Copy current chat → Markdown", sub: "Clipboard", right: "Enter" },
      { kind: "cmd", id: "power_search", title: "Open Power Search", sub: "Advanced filters + tagging", right: "Enter" },
      { kind: "cmd", id: "options", title: "Open Options", sub: "Connectors, features, settings", right: "Enter" },
    ];

    const connectors = state.connectors?.order?.map((cid) => state.connectors.byId[cid]).filter(Boolean).filter(c => c.enabled) || [];
    for (const c of connectors) {
      base.push({ kind: "send", id: `send_tasks:${c.id}`, title: `Send tasks → ${c.name}`, sub: "Webhook payload: tasks + meta", right: "Enter", connectorId: c.id, payload: "tasks" });
      base.push({ kind: "send", id: `send_md:${c.id}`, title: `Send markdown → ${c.name}`, sub: "Webhook payload: markdown", right: "Enter", connectorId: c.id, payload: "md" });
    }
    return base;
  }

  async function buildItems() {
    const q = state.query.trim();
    const cmd = commands();

    let items = cmd;
    if (q) {
      const ql = q.toLowerCase();
      items = cmd.filter(x => (x.title + " " + x.sub).toLowerCase().includes(ql));

      // saved conversations
      const convRes = await api.listConversations({ query: q, limit: opts.maxResults || 18 });
      const convs = convRes?.items || [];
      for (const c of convs.slice(0, 12)) {
        items.push({
          kind: "conv",
          id: c.id,
          title: c.title || "(untitled)",
          sub: (c.text || "").slice(0, 120).replace(/\n/g, " "),
          right: "Open",
          url: c.url
        });
      }
    }

    state.items = items.slice(0, opts.maxResults || 18);
    state.sel = 0;
    render();
  }

  function render() {
    listEl.innerHTML = state.items.map((it, i) => `
      <div class="awt-cp-item ${i === state.sel ? "sel" : ""}" data-idx="${i}">
        <div class="awt-cp-left">
          <div class="awt-cp-title">${escapeHtml(it.title)}</div>
          <div class="awt-cp-sub">${escapeHtml(it.sub || "")}</div>
        </div>
        <div class="awt-cp-right">${escapeHtml(it.right || "")}</div>
      </div>
    `).join("");

    listEl.querySelectorAll(".awt-cp-item").forEach((row) => {
      row.addEventListener("mousemove", () => {
        state.sel = Number(row.dataset.idx);
        highlight();
      });
      row.addEventListener("click", () => execute(state.items[Number(row.dataset.idx)]));
    });
  }

  function highlight() {
    listEl.querySelectorAll(".awt-cp-item").forEach((row) => row.classList.remove("sel"));
    const row = listEl.querySelector(`.awt-cp-item[data-idx="${state.sel}"]`);
    if (row) row.classList.add("sel");
  }

  async function execute(item) {
    if (!item) return;

    if (item.kind === "cmd") {
      if (item.id === "save") {
        const c = api.getConversation();
        const resp = await api.saveConversation({ ...c, autosave: false });
        api.notify(resp?.ok ? "Saved" : "Save failed", resp?.ok ? "success" : "error");
      }
      if (item.id === "export_md") {
        const c = api.getConversation();
        const md = api.formatConversation(c, "md");
        await api.downloadText(`awt-${c.id}.md`, md, "text/markdown");
      }
      if (item.id === "copy_md") {
        const c = api.getConversation();
        await api.copyText(api.formatConversation(c, "md"));
        api.notify("Copied", "success");
      }
      if (item.id === "power_search") {
        const ov = document.getElementById("awt-ps-overlay");
        if (ov) {
          ov.style.display = "block";
          const q = document.getElementById("awt-ps-q");
          if (q) q.focus();
        } else {
          api.notify("Power Search is not ready (enable Founder: Power Search).", "warning");
        }
      }
      if (item.id === "options") {
        await api.openOptions();
      }
      close();
      return;
    }

    if (item.kind === "send") {
      const c = api.getConversation();
      const arts = api.extractArtifacts(c);

      const payloadType = item.payload;
      const payload = payloadType === "tasks" ? { tasks: arts.tasks, meta: { id: c.id, title: c.title, url: c.url, ts: Date.now() } }
                    : payloadType === "md" ? { markdown: api.formatConversation(c, "md"), meta: { id: c.id, title: c.title, url: c.url, ts: Date.now() } }
                    : { meta: { id: c.id, title: c.title, url: c.url, ts: Date.now() } };

      const res = await api.sendToConnector({ connectorId: item.connectorId, payload, kind: "json" });
      if (res?.ok) {
        api.notify("Sent (queued)", "success");
      } else if (res?.error === "missing_host_permission") {
        api.notify("Missing domain permission. Open Options → Grant domain.", "warning");
        await api.openOptions();
      } else {
        api.notify("Send failed", "error");
      }
      close();
      return;
    }

    if (item.kind === "conv") {
      if (item.url) location.href = item.url;
      close();
      return;
    }
  }

  function open() {
    overlay.style.display = "block";
    qEl.value = "";
    state.query = "";
    state.open = true;
    state.sel = 0;
    qEl.focus();
    buildItems();
  }

  function close() {
    overlay.style.display = "none";
    state.open = false;
  }

  function toggle() { state.open ? close() : open(); }

  // input / hotkeys
  let t = null;
  qEl.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = qEl.value;
      buildItems();
    }, 120);
  };

  const keyHandler = (e) => {
    const isInput = ["INPUT", "TEXTAREA"].includes(e.target?.tagName) || e.target?.isContentEditable;
    if (isInput && e.key !== "Escape" && !(isModKey(e) && e.key.toLowerCase() === "k")) return;

    if (e.key === "Escape") {
      if (state.open) {
        e.preventDefault();
        close();
      }
      return;
    }

    if (isModKey(e) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggle();
      return;
    }

    if (!state.open) return;

    if (e.key === "ArrowDown") { e.preventDefault(); state.sel = Math.min(state.items.length - 1, state.sel + 1); highlight(); }
    if (e.key === "ArrowUp") { e.preventDefault(); state.sel = Math.max(0, state.sel - 1); highlight(); }
    if (e.key === "Enter") { e.preventDefault(); execute(state.items[state.sel]); }
  };

  document.addEventListener("keydown", keyHandler);
  api.onCleanup(() => document.removeEventListener("keydown", keyHandler));

  await loadConnectors();
  await buildItems();

  return { open, close, toggle, refresh: buildItems };
}

export default async function run({ api, context }) {
  const opts = context?.settings?.scriptOptions?.["founder-command-palette"] || {};
  await ensureUI(api, opts);
}

export async function onAction({ api, action }) {
  const ui = await ensureUI(api, {});
  if (action === "open") ui.open();
  if (action === "toggle") ui.toggle();
  if (action === "close") ui.close();
  return { ok: true };
}
