/**
 * Founder: Power Search
 * =====================
 * - Cmd/Ctrl+Shift+F opens a robust saved-conversation search modal
 * - Filters: pinned, tags, code, date window
 * - Quick tagging/pin for current conversation
 * - Extract views: tasks/decisions/links/code
 *
 * Privacy: Local-only. Uses chrome.storage.local via background messages.
 */

function isModKey(e) {
  return navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}

function hasCode(text) {
  const t = String(text || "");
  return t.includes("```") || /\b(traceback|stack trace|exception)\b/i.test(t);
}

async function ensureUI(api, opts = {}) {
  api.ensureOnce("awt-ps-style", () => {
    const css = document.createElement("style");
    css.id = "awt-ps-style";
    css.textContent = `
      #awt-ps-overlay{position:fixed;inset:0;z-index:2147483646;display:none;background:rgba(0,0,0,.35);backdrop-filter: blur(4px);}
      #awt-ps-modal{position:absolute;top:8vh;left:50%;transform:translateX(-50%);width:min(980px,92vw);max-height:84vh;overflow:hidden;background:var(--awt-card,#fff);color:var(--awt-text,#111);border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 20px 70px rgba(0,0,0,.25);}
      @media (prefers-color-scheme: dark){#awt-ps-modal{--awt-card:#111827;--awt-text:#e5e7eb;border-color:rgba(255,255,255,.12)}}
      #awt-ps-head{display:flex;gap:10px;align-items:center;padding:12px 12px;border-bottom:1px solid rgba(0,0,0,.08);}
      #awt-ps-head input{flex:1;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.18);background:transparent;color:inherit;outline:none}
      #awt-ps-head .btn{padding:9px 10px;border-radius:12px;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit;cursor:pointer;font-weight:700}
      #awt-ps-head .btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
      #awt-ps-body{display:grid;grid-template-columns: 1.05fr .95fr;gap:0;min-height:520px}
      #awt-ps-left{border-right:1px solid rgba(0,0,0,.08);overflow:auto}
      #awt-ps-right{overflow:auto}
      .awt-ps-row{padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.06);cursor:pointer}
      .awt-ps-row:hover{background:rgba(0,0,0,.04)}
      .awt-ps-title{font-weight:800;line-height:1.2}
      .awt-ps-meta{opacity:.75;font-size:12px;margin-top:4px}
      .awt-ps-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
      .awt-ps-tag{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid rgba(0,0,0,.16);opacity:.9}
      .awt-ps-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid rgba(0,0,0,.08);position:sticky;top:0;background:inherit}
      .awt-ps-chip{padding:7px 10px;border-radius:999px;border:1px solid rgba(0,0,0,.16);cursor:pointer;font-size:12px}
      .awt-ps-chip.on{background:rgba(37,99,235,.12);border-color:rgba(37,99,235,.6)}
      .awt-ps-section{padding:10px 12px}
      .awt-ps-kv{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .awt-ps-kv input{padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.16);background:transparent;color:inherit}
      .awt-ps-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;font-size:12px;line-height:1.45;border:1px solid rgba(0,0,0,.12);border-radius:12px;padding:10px;background:rgba(0,0,0,.03)}
      .awt-ps-pill{padding:7px 10px;border-radius:12px;border:1px solid rgba(0,0,0,.16);cursor:pointer;font-weight:800}
      .awt-ps-pill.primary{background:#111827;color:#fff;border-color:#111827}
      @media (prefers-color-scheme: dark){
        #awt-ps-head input,.awt-ps-kv input{border-color:rgba(255,255,255,.18)}
        .awt-ps-row:hover{background:rgba(255,255,255,.06)}
        .awt-ps-tag,.awt-ps-chip,.awt-ps-pill{border-color:rgba(255,255,255,.18)}
        .awt-ps-pre{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.05)}
      }
    `;
    document.documentElement.appendChild(css);
  });

  api.ensureOnce("awt-ps-overlay", () => {
    const overlay = document.createElement("div");
    overlay.id = "awt-ps-overlay";
    overlay.innerHTML = `
      <div id="awt-ps-modal" role="dialog" aria-modal="true">
        <div id="awt-ps-head">
          <input id="awt-ps-q" placeholder="Search saved… (title, tags, content)" />
          <button id="awt-ps-close" class="btn">Esc</button>
          <button id="awt-ps-refresh" class="btn primary">Refresh</button>
        </div>
        <div id="awt-ps-body">
          <div id="awt-ps-left"></div>
          <div id="awt-ps-right"></div>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
  });

  const overlay = document.getElementById("awt-ps-overlay");
  const qEl = document.getElementById("awt-ps-q");
  const left = document.getElementById("awt-ps-left");
  const right = document.getElementById("awt-ps-right");

  const state = {
    query: "",
    filters: { pinnedOnly: false, hasCode: false, tag: "" },
    view: opts.defaultView || "snippets",
    items: [],
    selectedId: "",
  };

  const views = ["snippets", "full", "code", "tasks", "decisions", "links"];

  function headerTools() {
    return `
      <div class="awt-ps-toolbar">
        <span class="awt-ps-chip ${state.filters.pinnedOnly ? "on" : ""}" data-chip="pinned">Pinned</span>
        <span class="awt-ps-chip ${state.filters.hasCode ? "on" : ""}" data-chip="code">Has code</span>
        <span class="awt-ps-chip ${state.filters.tag ? "on" : ""}" data-chip="tag">Tag</span>
        ${views.map(v => `<span class="awt-ps-chip ${state.view===v ? "on":""}" data-view="${v}">${v}</span>`).join("")}
      </div>
    `;
  }

  function currentMetaCard() {
    const c = api.getConversation();
    const id = c?.id || "";
    const saved = state.items.find(x => x.id === id);
    const tags = Array.isArray(saved?.tags) ? saved.tags : [];
    return `
      <div class="awt-ps-section">
        <div style="font-weight:900;margin-bottom:8px">Current chat</div>
        <div class="awt-ps-meta">${escapeHtml(c?.title || "")}</div>
        <div class="awt-ps-tags">${tags.map(t => `<span class="awt-ps-tag">${escapeHtml(t)}</span>`).join("")}</div>

        <div style="margin-top:10px" class="awt-ps-kv">
          <input id="awt-ps-addtag" placeholder="Add tag (Enter)" />
          <span class="awt-ps-pill" id="awt-ps-pin">${(saved?.pinned) ? "Unpin" : "Pin"}</span>
          <span class="awt-ps-pill" id="awt-ps-save">Save</span>
          <span class="awt-ps-pill" id="awt-ps-export">Export MD</span>
        </div>

        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          ${(opts.quickTags || []).map(t => `<span class="awt-ps-chip" data-quicktag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join("")}
        </div>

        <div style="margin-top:12px" class="awt-ps-meta">Tip: Cmd/Ctrl+K opens the command palette.</div>
      </div>
    `;
  }

  async function refresh() {
    const res = await api.listConversations({
      query: state.query,
      limit: opts.maxResults || 80,
      filters: state.filters,
      sort: state.query ? "relevance" : "recent"
    });
    state.items = res?.items || [];
    renderList();
    if (!state.selectedId && state.items[0]?.id) select(state.items[0].id);
    if (state.selectedId && !state.items.some(x => x.id === state.selectedId)) {
      state.selectedId = "";
      right.innerHTML = currentMetaCard();
      bindCurrentMeta();
    }
  }

  function renderList() {
    left.innerHTML = headerTools() + state.items.map((c) => {
      const isSel = c.id === state.selectedId;
      const t = escapeHtml(c.title || "(untitled)");
      const meta = `${fmtDate(c.updatedAt || c.ts)}${c.pinned ? " • pinned" : ""}${hasCode(c.text) ? " • code" : ""}`;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      const snippet = escapeHtml(String(c.text || "").slice(0, 160)).replace(/\n/g, " ");
      return `
        <div class="awt-ps-row" data-id="${escapeHtml(c.id)}" style="${isSel ? "background:rgba(37,99,235,.10)" : ""}">
          <div class="awt-ps-title">${t}</div>
          <div class="awt-ps-meta">${escapeHtml(meta)}</div>
          ${snippet ? `<div class="awt-ps-meta">${snippet}</div>` : ""}
          <div class="awt-ps-tags">${tags.slice(0, 6).map(tag => `<span class="awt-ps-tag">${escapeHtml(tag)}</span>`).join("")}</div>
        </div>
      `;
    }).join("");
  }

  function select(id) {
    state.selectedId = id;
    const c = state.items.find(x => x.id === id);
    renderDetail(c || null);
  }

  function detailView(c) {
    if (!c) return currentMetaCard();

    const artifacts = api.extractArtifacts(c);
    const header = `
      <div class="awt-ps-section">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div style="font-weight:900">${escapeHtml(c.title || "(untitled)")}</div>
            <div class="awt-ps-meta">${escapeHtml(shortUrl(c.url || ""))} • ${escapeHtml(fmtDate(c.updatedAt || c.ts))}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <span class="awt-ps-pill" data-act="open">Open</span>
            <span class="awt-ps-pill" data-act="copy">Copy MD</span>
            <span class="awt-ps-pill primary" data-act="export">Export</span>
          </div>
        </div>
        <div class="awt-ps-tags">${(c.tags||[]).map(t => `<span class="awt-ps-tag">${escapeHtml(t)}</span>`).join("")}</div>
      </div>
    `;

    let body = "";
    if (state.view === "snippets") {
      body = `<div class="awt-ps-section"><div class="awt-ps-pre">${escapeHtml(String(c.text||"").slice(0, 2600))}</div></div>`;
    } else if (state.view === "full") {
      body = `<div class="awt-ps-section"><div class="awt-ps-pre">${escapeHtml(String(c.text||"").slice(0, 12000))}</div></div>`;
    } else if (state.view === "links") {
      body = `<div class="awt-ps-section">${(artifacts.links||[]).map(l => `<div class="awt-ps-pre">${escapeHtml(l)}</div>`).join("") || `<div class="awt-ps-meta">No links detected.</div>`}</div>`;
    } else if (state.view === "tasks") {
      body = `<div class="awt-ps-section">${(artifacts.tasks||[]).map(t => `<div class="awt-ps-pre">• ${escapeHtml(t)}</div>`).join("") || `<div class="awt-ps-meta">No tasks detected.</div>`}</div>`;
    } else if (state.view === "decisions") {
      body = `<div class="awt-ps-section">${(artifacts.decisions||[]).map(t => `<div class="awt-ps-pre">• ${escapeHtml(t)}</div>`).join("") || `<div class="awt-ps-meta">No decisions detected.</div>`}</div>`;
    } else if (state.view === "code") {
      body = `<div class="awt-ps-section">${
        (artifacts.codeBlocks||[]).slice(0, 8).map(cb => `<div style="margin-bottom:10px"><div class="awt-ps-meta">${escapeHtml(cb.lang || "code")}</div><div class="awt-ps-pre">${escapeHtml(cb.code)}</div></div>`).join("")
        || `<div class="awt-ps-meta">No code blocks detected.</div>`
      }</div>`;
    }

    return header + body;
  }

  function shortUrl(u) {
    try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; }
  }

  function bindListHandlers() {
    left.querySelectorAll(".awt-ps-row").forEach((row) => {
      row.addEventListener("click", () => select(row.dataset.id));
    });
    left.querySelectorAll("[data-chip]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const which = chip.getAttribute("data-chip");
        if (which === "pinned") state.filters.pinnedOnly = !state.filters.pinnedOnly;
        if (which === "code") state.filters.hasCode = !state.filters.hasCode;
        if (which === "tag") {
          const t = prompt("Filter by tag (exact match). Leave blank to clear.", state.filters.tag || "");
          state.filters.tag = (t || "").trim();
        }
        refresh();
      });
    });
    left.querySelectorAll("[data-view]").forEach((chip) => {
      chip.addEventListener("click", () => {
        state.view = chip.getAttribute("data-view");
        refresh();
      });
    });
  }

  function bindDetailHandlers(c) {
    if (!c) return bindCurrentMeta();

    right.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        if (act === "open") {
          if (c.url) location.href = c.url;
          return;
        }
        const md = api.formatConversation(c, "md");
        if (act === "copy") {
          await api.copyText(md);
          api.notify("Copied", "success");
          return;
        }
        if (act === "export") {
          await api.downloadText(`awt-${c.id}.md`, md, "text/markdown");
          return;
        }
      });
    });
  }

  
async function ensureSavedCurrent() {
  const c = api.getConversation();
  if (!c?.id) return false;
  // Always ensure we have a canonical record keyed by /c/<id>.
  // This avoids relying on fuzzy search behavior.
  const resp = await api.saveConversation({ ...c, autosave: true });
  return !!resp?.ok;
}

function bindCurrentMeta() {
    const add = document.getElementById("awt-ps-addtag");
    const pin = document.getElementById("awt-ps-pin");
    const save = document.getElementById("awt-ps-save");
    const exp = document.getElementById("awt-ps-export");
    const c = api.getConversation();
    const id = c?.id;

    if (add) {
      add.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
        const tag = add.value.trim();
        add.value = "";
        if (!tag || !id) return;
        await ensureSavedCurrent();
        const existing = (await api.listConversations({ query: id, limit: 1 }))?.items?.[0];
        const tags = Array.from(new Set([...(existing?.tags || []), tag]));
        await api.updateConversationMeta(id, { tags });
        api.notify(`Tagged: ${tag}`, "success");
        await refresh();
        right.innerHTML = currentMetaCard();
        bindCurrentMeta();
      });
    }

    if (pin) {
      pin.addEventListener("click", async () => {
        if (!id) return;
        await ensureSavedCurrent();
        const existing = (await api.listConversations({ query: id, limit: 1 }))?.items?.[0];
        await api.updateConversationMeta(id, { pinned: !(existing?.pinned) });
        api.notify((existing?.pinned) ? "Unpinned" : "Pinned", "success");
        await refresh();
        right.innerHTML = currentMetaCard();
        bindCurrentMeta();
      });
    }

    if (save) save.addEventListener("click", async () => {
      const c = api.getConversation();
      const resp = await api.saveConversation({ ...c, autosave: false });
      api.notify(resp?.ok ? "Saved" : "Save failed", resp?.ok ? "success" : "error");
      await refresh();
    });

    if (exp) exp.addEventListener("click", async () => {
      const conv = api.getConversation();
      const md = api.formatConversation(conv, "md");
      await api.downloadText(`awt-${conv.id}.md`, md, "text/markdown");
    });

    right.querySelectorAll("[data-quicktag]").forEach((chip) => {
      chip.addEventListener("click", async () => {
        const tag = chip.getAttribute("data-quicktag");
        if (!tag || !id) return;
        await ensureSavedCurrent();
        const existing = (await api.listConversations({ query: id, limit: 1 }))?.items?.[0];
        const tags = Array.from(new Set([...(existing?.tags || []), tag]));
        await api.updateConversationMeta(id, { tags });
        api.notify(`Tagged: ${tag}`, "success");
        await refresh();
        right.innerHTML = currentMetaCard();
        bindCurrentMeta();
      });
    });
  }

  function renderDetail(c) {
    right.innerHTML = detailView(c);
    bindDetailHandlers(c);
  }

  function open() {
    overlay.style.display = "block";
    qEl.focus();
  }

  function close() {
    overlay.style.display = "none";
  }

  function toggle() {
    if (overlay.style.display === "block") close();
    else open();
  }

  document.getElementById("awt-ps-close").onclick = close;
  document.getElementById("awt-ps-refresh").onclick = refresh;

  let t = null;
  qEl.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      state.query = qEl.value.trim();
      await refresh();
    }, 200);
  };

  right.innerHTML = currentMetaCard();
  bindCurrentMeta();

  // initial list
  await refresh();
  bindListHandlers();

  // hotkeys
  const hotkeyHandler = (e) => {
    const isInput = ["INPUT", "TEXTAREA"].includes(e.target?.tagName) || e.target?.isContentEditable;
    if (isInput && e.key !== "Escape") return;

    if (e.key === "Escape") {
      if (overlay.style.display === "block") {
        e.preventDefault();
        close();
      }
      return;
    }

    if (isModKey(e) && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      toggle();
    }
  };
  document.addEventListener("keydown", hotkeyHandler);
  api.onCleanup(() => document.removeEventListener("keydown", hotkeyHandler));

  return { open, close, toggle, refresh };
}

export default async function run({ api, context }) {
  await ensureUI(api, context?.settings?.scriptOptions?.["founder-power-search"] || {});
}

export async function onAction({ api, action }) {
  const opts = {};
  const ui = await ensureUI(api, opts);
  if (action === "open") ui.open();
  if (action === "toggle") ui.toggle();
  if (action === "refresh") ui.refresh();
  if (action === "close") ui.close();
  return { ok: true };
}
