/**
 * Founder Add-on: Notes Dock + Nav Dock
 * ====================================
 * - Right-edge notes dock (Chat + Global)
 * - Optional "All Notes" overlay
 * - Mini navigation dock (Palette + prev/next message)
 *
 * Privacy: local-only storage (chrome.storage.local via background APIs)
 */

export const meta = {
  id: "founder-notes-and-nav",
  name: "Founder: Notes + Navigation Dock",
  description: "Right-edge notes dock (chat + global) + mini nav dock (palette + prev/next message).",
  matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  defaultEnabled: true,
  permissions: ["insert_ui", "read_dom", "storage"],
};

const Z = 2147483646;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(ms, fn) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function getMain() {
  return document.querySelector("main") || document.body;
}

function messageNodes() {
  const main = getMain();
  // Use direct message container nodes, not nested markdown nodes.
  const nodes = Array.from(main.querySelectorAll("[data-message-author-role]"));
  // Filter out nested matches (rare) by ensuring closest matches itself.
  return nodes.filter((n) => n.closest("[data-message-author-role]") === n);
}

function closestMessageIndex(nodes) {
  const targetY = window.scrollY + window.innerHeight * 0.33;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const r = nodes[i].getBoundingClientRect();
    const centerY = window.scrollY + r.top + r.height / 2;
    const d = Math.abs(centerY - targetY);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function scrollToMessage(idx, nodes) {
  const n = nodes[idx];
  if (!n) return;
  try {
    n.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    // fallback
    const r = n.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - 120, behavior: "smooth" });
  }
}

function openCommandPalette(api) {
  const ov = document.getElementById("awt-cp-overlay");
  if (ov) {
    ov.style.display = "block";
    const q = document.getElementById("awt-cp-q");
    if (q) q.focus();
    return true;
  }
  api.notify("Command Palette not ready (enable Founder: Command Palette).", "warning");
  return false;
}

async function getSavedConversationNotes(api, convId) {
  if (!convId) return "";
  try {
    const res = await api.getConversationById(convId);
    if (res?.ok && res.conversation) return String(res.conversation.notes || "");
  } catch {}
  return "";
}

async function saveConversationNotes(api, conv, notesText) {
  if (!conv?.id) return;

  // Try meta update first (cheap) and fall back to save.
  try {
    const upd = await api.updateConversationMeta(conv.id, { notes: String(notesText || "") });
    if (upd?.ok) return;
  } catch {}

  try {
    await api.saveConversation({ ...conv, notes: String(notesText || ""), autosave: true });
  } catch {}
}

async function getGlobalNotesText(api) {
  const res = await api.getGlobalNotes();
  if (res?.ok) return String(res.notes?.text || "");
  return "";
}

async function setGlobalNotesText(api, text) {
  await api.setGlobalNotes(String(text || ""));
}

function notesDockTemplate() {
  return `
  <div class="awt-nd-header">
    <div class="awt-nd-title">Notes</div>
    <div class="awt-nd-actions">
      <button class="awt-nd-icon" data-nd-act="copy" title="Copy current notes">⧉</button>
      <button class="awt-nd-icon" data-nd-act="download" title="Download current notes">⤓</button>
      <button class="awt-nd-icon" data-nd-act="all" title="See all notes">All</button>
      <button class="awt-nd-icon" data-nd-act="close" title="Close">✕</button>
    </div>
  </div>

  <div class="awt-nd-tabs">
    <button class="awt-nd-tab sel" data-nd-tab="chat">Chat</button>
    <button class="awt-nd-tab" data-nd-tab="global">Global</button>
  </div>

  <div class="awt-nd-body">
    <div class="awt-nd-pane" data-nd-pane="chat">
      <textarea id="awt-nd-chat" class="awt-nd-ta" placeholder="Conversation notes…"></textarea>
      <div class="awt-nd-hint">Saved locally. Tied to /c/&lt;id&gt; and migrates from tmp → c_.</div>
    </div>
    <div class="awt-nd-pane" data-nd-pane="global" style="display:none">
      <textarea id="awt-nd-global" class="awt-nd-ta" placeholder="Global notes…"></textarea>
      <div class="awt-nd-hint">Saved locally. Not tied to any conversation.</div>
    </div>
  </div>

  <div class="awt-nd-overlay" id="awt-nd-all" style="display:none">
    <div class="awt-nd-all-card">
      <div class="awt-nd-all-header">
        <div style="font-weight:800">All Notes</div>
        <div class="awt-nd-actions">
          <button class="awt-nd-icon" data-nd-act="all_close">✕</button>
        </div>
      </div>
      <div class="awt-nd-all-controls">
        <input id="awt-nd-all-q" class="awt-nd-input" placeholder="Search notes…" />
        <button class="awt-nd-btn" data-nd-act="open_options">Options</button>
      </div>
      <div id="awt-nd-all-list" class="awt-nd-all-list"></div>
    </div>
  </div>
  `;
}

function ensureStyles(api) {
  api.ensureOnce("awt-nd-style", () => {
    const css = document.createElement("style");
    css.id = "awt-nd-style";
    css.textContent = `
      #awt-notes-tab{position:fixed;right:0;top:180px;z-index:${Z};border:1px solid rgba(255,255,255,.14);
        background:rgba(17,24,39,.88);color:#e5e7eb;border-radius:12px 0 0 12px;padding:10px 10px;
        font:800 12px ui-sans-serif,system-ui;cursor:pointer;box-shadow:0 18px 40px rgba(0,0,0,.28);
        writing-mode:vertical-rl;text-orientation:mixed;}
      @media (prefers-color-scheme: light){#awt-notes-tab{background:rgba(255,255,255,.92);color:#111827;border-color:rgba(0,0,0,.12)}}

      #awt-notes-panel{position:fixed;right:0;top:84px;height:calc(100vh - 120px);width:360px;max-width:92vw;
        z-index:${Z};border:1px solid rgba(255,255,255,.14);background:rgba(17,24,39,.92);color:#e5e7eb;
        border-radius:18px 0 0 18px;box-shadow:0 28px 60px rgba(0,0,0,.35);display:none;overflow:hidden;}
      @media (prefers-color-scheme: light){#awt-notes-panel{background:rgba(255,255,255,.95);color:#111827;border-color:rgba(0,0,0,.12)}}

      .awt-nd-header{display:flex;align-items:center;justify-content:space-between;padding:12px 12px;border-bottom:1px solid rgba(255,255,255,.12)}
      @media (prefers-color-scheme: light){.awt-nd-header{border-bottom-color:rgba(0,0,0,.10)}}
      .awt-nd-title{font:900 14px ui-sans-serif,system-ui;letter-spacing:.2px}
      .awt-nd-actions{display:flex;gap:8px;align-items:center}
      .awt-nd-icon{height:30px;min-width:30px;padding:0 10px;border-radius:12px;border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.06);color:inherit;font:800 12px ui-sans-serif,system-ui;cursor:pointer}
      @media (prefers-color-scheme: light){.awt-nd-icon{border-color:rgba(0,0,0,.12);background:rgba(0,0,0,.04)}}

      .awt-nd-tabs{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.10)}
      @media (prefers-color-scheme: light){.awt-nd-tabs{border-bottom-color:rgba(0,0,0,.08)}}
      .awt-nd-tab{flex:1;height:32px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);
        color:inherit;font:800 12px ui-sans-serif,system-ui;cursor:pointer}
      .awt-nd-tab.sel{background:rgba(16,185,129,.18);border-color:rgba(16,185,129,.28)}
      @media (prefers-color-scheme: light){.awt-nd-tab{border-color:rgba(0,0,0,.12);background:rgba(0,0,0,.04)}
        .awt-nd-tab.sel{background:rgba(16,185,129,.12);border-color:rgba(16,185,129,.24)}}

      .awt-nd-body{padding:12px;height:calc(100% - 102px)}
      .awt-nd-pane{height:100%;display:flex;flex-direction:column;gap:8px}
      .awt-nd-ta{flex:1;resize:none;width:100%;border-radius:14px;padding:12px;border:1px solid rgba(255,255,255,.12);
        background:rgba(0,0,0,.14);color:inherit;font:600 12px/1.4 ui-sans-serif,system-ui;outline:none}
      .awt-nd-ta:focus{border-color:rgba(59,130,246,.5);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
      @media (prefers-color-scheme: light){.awt-nd-ta{background:rgba(255,255,255,.7);border-color:rgba(0,0,0,.10)}}
      .awt-nd-hint{font:600 11px ui-sans-serif,system-ui;opacity:.75}

      .awt-nd-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
      .awt-nd-all-card{width:calc(100% - 24px);max-height:calc(100% - 24px);border-radius:18px;overflow:hidden;
        border:1px solid rgba(255,255,255,.14);background:rgba(17,24,39,.98);color:#e5e7eb;}
      @media (prefers-color-scheme: light){.awt-nd-all-card{background:rgba(255,255,255,.98);color:#111827;border-color:rgba(0,0,0,.12)}}
      .awt-nd-all-header{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.12)}
      @media (prefers-color-scheme: light){.awt-nd-all-header{border-bottom-color:rgba(0,0,0,.10)}}
      .awt-nd-all-controls{display:flex;gap:10px;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.10)}
      @media (prefers-color-scheme: light){.awt-nd-all-controls{border-bottom-color:rgba(0,0,0,.08)}}
      .awt-nd-input{flex:1;height:34px;border-radius:12px;padding:0 12px;border:1px solid rgba(255,255,255,.12);
        background:rgba(0,0,0,.14);color:inherit;font:700 12px ui-sans-serif,system-ui;outline:none}
      @media (prefers-color-scheme: light){.awt-nd-input{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.12)}}
      .awt-nd-btn{height:34px;border-radius:12px;padding:0 12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);
        color:inherit;font:800 12px ui-sans-serif,system-ui;cursor:pointer}
      @media (prefers-color-scheme: light){.awt-nd-btn{border-color:rgba(0,0,0,.12);background:rgba(0,0,0,.04)}}
      .awt-nd-all-list{padding:10px 12px;overflow:auto;max-height:calc(100% - 108px)}
      .awt-nd-item{padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);
        margin-bottom:10px;cursor:pointer}
      .awt-nd-item:hover{border-color:rgba(59,130,246,.35)}
      @media (prefers-color-scheme: light){.awt-nd-item{border-color:rgba(0,0,0,.10);background:rgba(0,0,0,.03)}}
      .awt-nd-item-title{font:900 12px ui-sans-serif,system-ui;margin-bottom:4px}
      .awt-nd-item-meta{font:700 11px ui-sans-serif,system-ui;opacity:.75;margin-bottom:6px}
      .awt-nd-item-preview{font:600 12px ui-sans-serif,system-ui;opacity:.9;white-space:pre-wrap;max-height:72px;overflow:hidden}

      #awt-nav-dock{position:fixed;right:18px;bottom:152px;z-index:${Z};display:flex;flex-direction:column;gap:8px;}
      .awt-nav-btn{width:44px;height:44px;border-radius:14px;border:1px solid rgba(255,255,255,.14);
        background:rgba(17,24,39,.88);color:#e5e7eb;cursor:pointer;box-shadow:0 18px 40px rgba(0,0,0,.28);
        display:flex;align-items:center;justify-content:center;font:900 16px ui-sans-serif,system-ui}
      .awt-nav-btn:hover{border-color:rgba(59,130,246,.35)}
      @media (prefers-color-scheme: light){.awt-nav-btn{background:rgba(255,255,255,.92);color:#111827;border-color:rgba(0,0,0,.12)}}
    `;
    document.documentElement.appendChild(css);
  });
}

function ensureUI(api) {
  if (document.getElementById("awt-notes-tab")) return;

  const tab = document.createElement("button");
  tab.id = "awt-notes-tab";
  tab.type = "button";
  tab.textContent = "Notes";

  const panel = document.createElement("div");
  panel.id = "awt-notes-panel";
  panel.innerHTML = notesDockTemplate();

  const nav = document.createElement("div");
  nav.id = "awt-nav-dock";
  nav.innerHTML = `
    <button class="awt-nav-btn" data-nav="palette" title="Command Palette">⚡</button>
    <button class="awt-nav-btn" data-nav="up" title="Previous message">↑</button>
    <button class="awt-nav-btn" data-nav="down" title="Next message">↓</button>
  `;

  document.body.appendChild(tab);
  document.body.appendChild(panel);
  document.body.appendChild(nav);

  const destroy = () => {
    try { tab.remove(); } catch {}
    try { panel.remove(); } catch {}
    try { nav.remove(); } catch {}
  };
  api.onCleanup(destroy);

  // ---- Dock logic ----
  const overlayAll = panel.querySelector("#awt-nd-all");
  const allList = panel.querySelector("#awt-nd-all-list");
  const allQ = panel.querySelector("#awt-nd-all-q");

  const chatTA = panel.querySelector("#awt-nd-chat");
  const globalTA = panel.querySelector("#awt-nd-global");

  let activeTab = "chat";
  let lastConvId = null;

  const openPanel = () => {
    panel.style.display = "block";
    // nudge tab when open
    tab.style.opacity = "0.65";
  };
  const closePanel = () => {
    panel.style.display = "none";
    overlayAll.style.display = "none";
    tab.style.opacity = "1";
  };
  const togglePanel = () => {
    if (panel.style.display === "block") closePanel();
    else openPanel();
  };

  tab.addEventListener("click", togglePanel);

  const setTab = (name) => {
    activeTab = name;
    panel.querySelectorAll(".awt-nd-tab").forEach((b) => b.classList.toggle("sel", b.getAttribute("data-nd-tab") === name));
    panel.querySelectorAll(".awt-nd-pane").forEach((p) => {
      p.style.display = p.getAttribute("data-nd-pane") === name ? "flex" : "none";
    });
    if (name === "chat") chatTA?.focus();
    else globalTA?.focus();
  };

  panel.querySelectorAll("[data-nd-tab]").forEach((b) => {
    b.addEventListener("click", () => setTab(b.getAttribute("data-nd-tab")));
  });

  const refreshChatNotes = async () => {
    const c = api.getConversation();
    if (!c?.id) return;
    if (c.id !== lastConvId) {
      lastConvId = c.id;
      const text = await getSavedConversationNotes(api, c.id);
      if (chatTA) chatTA.value = text;
    }
  };

  const refreshGlobalNotes = async () => {
    const t = await getGlobalNotesText(api);
    if (globalTA) globalTA.value = t;
  };

  const saveChatDebounced = debounce(900, async () => {
    try {
      const c = api.getConversation();
      if (!c?.id) return;
      await saveConversationNotes(api, c, chatTA.value);
    } catch {}
  });

  const saveGlobalDebounced = debounce(900, async () => {
    try {
      await setGlobalNotesText(api, globalTA.value);
    } catch {}
  });

  chatTA?.addEventListener("input", saveChatDebounced);
  globalTA?.addEventListener("input", saveGlobalDebounced);

  panel.querySelectorAll("[data-nd-act]").forEach((b) => {
    b.addEventListener("click", async () => {
      const act = b.getAttribute("data-nd-act");
      if (act === "copy" || act === "download") {
        const sel = panel.querySelector(".awt-nd-tab.sel")?.getAttribute("data-nd-tab") || "chat";
        const text = sel === "global" ? String(globalTA?.value || "") : String(chatTA?.value || "");
        if (!text.trim()) {
          api.notify("Nothing to copy", "info");
          return;
        }
        if (act === "copy") {
          await api.copyText(text);
          api.notify("Copied", "success");
          return;
        }
        const conv = api.getConversation();
        const safeId = (conv?.id || "chat").replace(/[^a-zA-Z0-9_\-]/g, "_");
        const filename = sel === "global" ? "awt-global-notes.txt" : `awt-${safeId}-notes.txt`;
        await api.downloadText(filename, text, "text/plain");
        api.notify("Downloaded", "success");
        return;
      }
      if (act === "close") return closePanel();
      if (act === "all") {
        overlayAll.style.display = "flex";
        // load list
        await renderAllNotes();
        allQ?.focus();
        return;
      }
      if (act === "all_close") {
        overlayAll.style.display = "none";
        return;
      }
      if (act === "open_options") {
        await api.openOptions();
      }
    });
  });

  // All notes list
  let allItems = [];
  const renderAllNotes = async () => {
    try {
      const globalText = await getGlobalNotesText(api);
      const resp = await api.listConversations({ query: "", limit: 200, sort: "recent" });
      const convs = resp?.items || [];
      const withNotes = convs
        .filter((c) => String(c.notes || "").trim().length > 0)
        .map((c) => ({
          kind: "conv",
          id: c.id,
          title: c.title || c.id,
          url: c.url,
          updatedAt: c.updatedAt || c.ts,
          notes: String(c.notes || ""),
        }));

      allItems = [
        { kind: "global", id: "global", title: "Global Notes", url: null, updatedAt: null, notes: String(globalText || "") },
        ...withNotes,
      ];

      const q = (allQ?.value || "").trim().toLowerCase();
      const filtered = !q
        ? allItems
        : allItems.filter((it) =>
            `${it.title}\n${it.notes}`.toLowerCase().includes(q)
          );

      const html = filtered
        .map((it) => {
          const preview = esc(it.notes).slice(0, 500);
          const meta = it.kind === "global" ? "" : esc(it.url || "");
          return `
            <div class="awt-nd-item" data-note-kind="${esc(it.kind)}" data-note-id="${esc(it.id)}">
              <div class="awt-nd-item-title">${esc(it.title)}</div>
              ${meta ? `<div class="awt-nd-item-meta">${meta}</div>` : ""}
              <div class="awt-nd-item-preview">${preview}</div>
            </div>
          `;
        })
        .join("\n");

      allList.innerHTML = html || `<div style="opacity:.75;font:700 12px ui-sans-serif,system-ui;padding:8px">No notes yet.</div>`;

      allList.querySelectorAll(".awt-nd-item").forEach((row) => {
        row.addEventListener("click", async () => {
          const kind = row.getAttribute("data-note-kind");
          const id = row.getAttribute("data-note-id");
          if (kind === "global") {
            overlayAll.style.display = "none";
            openPanel();
            setTab("global");
            await refreshGlobalNotes();
            return;
          }
          const it = allItems.find((x) => x.id === id);
          overlayAll.style.display = "none";
          openPanel();
          setTab("chat");
          if (it?.url) location.href = it.url;
        });
      });
    } catch (e) {
      api.notify(`Failed to load notes: ${String(e?.message || e)}`, "error");
    }
  };

  if (allQ) {
    allQ.addEventListener("input", () => renderAllNotes());
  }

  // Nav dock
  nav.querySelectorAll("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.getAttribute("data-nav");
      if (act === "palette") {
        openCommandPalette(api);
        return;
      }
      const nodes = messageNodes();
      if (!nodes.length) return;
      const cur = closestMessageIndex(nodes);
      if (act === "up") {
        scrollToMessage(Math.max(0, cur - 1), nodes);
      }
      if (act === "down") {
        scrollToMessage(Math.min(nodes.length - 1, cur + 1), nodes);
      }
    });
  });

  // Keep notes updated on navigation / route changes
  const stop = api.onRouteChange(() => {
    refreshChatNotes();
    refreshGlobalNotes();
  });
  api.onCleanup(stop);

  // Initial hydrate
  refreshChatNotes();
  refreshGlobalNotes();
}

export async function run({ api }) {
  ensureStyles(api);
  ensureUI(api);
}

export async function onAction({ api, action }) {
  if (action === "toggle_notes") {
    const panel = document.getElementById("awt-notes-panel");
    const tab = document.getElementById("awt-notes-tab");
    if (panel && tab) tab.click();
    return;
  }
  if (action === "open_palette") {
    openCommandPalette(api);
  }
}
