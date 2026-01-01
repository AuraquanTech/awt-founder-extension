/**
 * Safe API for packaged scripts
 * =============================
 * Intentionally small and allowlisted. Scripts do not touch chrome APIs directly.
 */

import { extractConversation, formatConversation, hashConversation } from "./conversation.js";

const ROUTE_EVT = "awt:route-change";

function installRouteHookOnce() {
  if (window.__awt_route_hook_installed__) return;
  window.__awt_route_hook_installed__ = true;

  const dispatch = () => window.dispatchEvent(new CustomEvent(ROUTE_EVT));
  window.addEventListener("popstate", dispatch);

  const _push = history.pushState;
  const _replace = history.replaceState;

  history.pushState = function (...args) {
    const ret = _push.apply(this, args);
    dispatch();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = _replace.apply(this, args);
    dispatch();
    return ret;
  };
}

export function createSafeApi({ scriptId = "unknown", permissions = [], runtime = null } = {}) {
  installRouteHookOnce();

  const hasPerm = (p) => permissions.includes(p);

  // ensureOnce(id, fn?)
  // - legacy: ensureOnce(id) -> boolean
  // - modern: ensureOnce(id, () => { ...create UI... })
  const ensureOnce = (id, fn) => {
    if (!id) return false;
    if (document.getElementById(id)) return false;
    if (typeof fn === "function") {
      try { fn(); } catch {}
    }
    return true;
  };

  const q = (sel, root = document) => (root || document).querySelector(sel);
  const qa = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

  const onRouteChange = (cb) => {
    const handler = () => cb?.(location.href);
    window.addEventListener(ROUTE_EVT, handler);
    return () => window.removeEventListener(ROUTE_EVT, handler);
  };

  // downloadText(filename, text, mime)
  // (compat) downloadText(text, filename, mime) also supported.
  const downloadText = async (a, b, c = "text/plain") => {
    if (!hasPerm("download")) return;
    let filename = a;
    let text = b;
    let mime = c;

    // compat: (text, filename)
    if (typeof a === "string" && typeof b === "string") {
      const looksLikeFilename = /\.(md|txt|json)$/i.test(b) || b.length < 120;
      const looksLikeContent = a.includes("\n") || a.length > 240;
      if (looksLikeFilename && looksLikeContent) {
        filename = b;
        text = a;
      }
    }

    const resp = await chrome.runtime.sendMessage({ type: "awt:download_text", filename, text, mime });
    if (resp?.ok) return;

    // fallback: in-page download (may require user gesture)
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || `download-${Date.now()}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      // ignore
    }
  };

  const copyText = async (text) => {
    if (!hasPerm("clipboard")) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.documentElement.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch {
        return false;
      }
    }
  };

  const getConversation = () => {
    const c = extractConversation({});
    c.hash = hashConversation(c);
    return c;
  };

  const format = (conv, fmt) => formatConversation(conv, fmt);

  // compat alias used by Founder scripts
  const formatConversationCompat = (conv, fmt) => formatConversation(conv, fmt);

  const saveConversation = async (conversation, _opts = {}) => {
    if (!hasPerm("storage")) return { ok: false, error: "missing_permission" };
    return await chrome.runtime.sendMessage({ type: "awt:save_conversation", conversation });
  };

  const listConversations = async (query = "") => {
    if (!hasPerm("storage")) return { ok: false, error: "missing_permission" };
    // support both listConversations("foo") and listConversations({query, limit, filters, sort})
    if (typeof query === "object" && query) {
      return await chrome.runtime.sendMessage({
        type: "awt:list_conversations",
        query: query.query || "",
        limit: query.limit,
        filters: query.filters,
        sort: query.sort,
      });
    }
    return await chrome.runtime.sendMessage({ type: "awt:list_conversations", query });
  };

  // lightweight notifications (no external deps)
  const notify = (message, type = "info") => {
    try {
      if (!document.getElementById("awt-toast-style")) {
        const css = document.createElement("style");
        css.id = "awt-toast-style";
        css.textContent = `
          .awt-toast{position:fixed;right:18px;top:18px;z-index:2147483647;padding:10px 12px;border-radius:12px;
            font:600 12px ui-sans-serif,system-ui;box-shadow:0 10px 24px rgba(0,0,0,.18);
            border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.95);color:#111827;}
          @media (prefers-color-scheme: dark){.awt-toast{background:rgba(17,24,39,.96);border-color:rgba(255,255,255,.12);color:#e5e7eb;}}
          .awt-toast.success{border-color:rgba(16,185,129,.5)}
          .awt-toast.warning{border-color:rgba(245,158,11,.5)}
          .awt-toast.error{border-color:rgba(239,68,68,.55)}
        `;
        document.documentElement.appendChild(css);
      }
      const el = document.createElement("div");
      el.className = `awt-toast ${type}`;
      el.textContent = String(message || "");
      document.body.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch {} }, 2200);
    } catch {
      // ignore
    }
  };

  const onCleanup = (fn) => {
    if (typeof fn !== "function") return;
    runtime?.cleanups?.push(fn);
  };

  
const updateConversationMeta = async (id, patch = {}) => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:update_conversation_meta", id, patch });
};

const getConversationById = async (id) => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:get_conversation_by_id", id });
};

const getConversationIdForUrl = async (url) => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:get_conversation_id_for_url", url });
};

const getGlobalNotes = async () => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:get_global_notes" });
};

const setGlobalNotes = async (text) => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:set_global_notes", text: String(text || "") });
};

const getConnectors = async () => {
  if (!hasPerm("storage")) return { ok: false };
  return await chrome.runtime.sendMessage({ type: "awt:get_connectors" });
};

const sendToConnector = async ({ connectorId, payload, kind = "json", headers = {} } = {}) => {
  if (!hasPerm("network")) return { ok: false, error: "missing_permission_network" };
  return await chrome.runtime.sendMessage({ type: "awt:connector_send", connectorId, payload, kind, headers });
};


const openOptions = async () => {
  return await chrome.runtime.sendMessage({ type: "awt:open_options" });
};

const extractArtifacts = (conversation = null) => {
  const c = conversation || getConversation();
  const text = String(c?.text || "");
  const lines = text.split(/\r?\n/);

  // links
  const links = [];
  const linkRe = /(https?:\/\/[^\s)\]]+)/g;
  for (const line of lines) {
    let m;
    while ((m = linkRe.exec(line)) !== null) {
      links.push(m[1]);
    }
  }

  // code blocks
  const codeBlocks = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let fm;
  while ((fm = fenceRe.exec(text)) !== null) {
    codeBlocks.push({ lang: (fm[1] || "").trim(), code: (fm[2] || "").trim() });
  }

  // tasks / decisions via lightweight heuristics
  const tasks = [];
  const decisions = [];
  const pushBullets = (arr, startIdx) => {
    for (let i = startIdx; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*#+\s+/.test(ln)) break; // next header ends section
      const m = ln.match(/^\s*[-*]\s+(.*)$/);
      if (m && m[1] && m[1].trim()) arr.push(m[1].trim());
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (/^(todo|todos|action items|actions):?$/i.test(ln) || /^#+\s*(todo|action items|actions)\b/i.test(ln)) {
      pushBullets(tasks, i + 1);
    }
    if (/^(decisions?):?$/i.test(ln) || /^#+\s*decisions?\b/i.test(ln)) {
      pushBullets(decisions, i + 1);
    }
    // inline TODO/Decision
    const t1 = ln.match(/^(?:todo|action):\s*(.+)$/i);
    if (t1?.[1]) tasks.push(t1[1].trim());
    const d1 = ln.match(/^decision:\s*(.+)$/i);
    if (d1?.[1]) decisions.push(d1[1].trim());
    // checkbox
    const cb = ln.match(/^[-*]\s*\[\s*\]\s*(.+)$/);
    if (cb?.[1]) tasks.push(cb[1].trim());
  }

  // de-dupe
  const uniq = (a) => Array.from(new Set(a)).slice(0, 200);
  return {
    links: uniq(links),
    codeBlocks,
    tasks: uniq(tasks),
    decisions: uniq(decisions),
  };
};

return {
    scriptId,
    permissions,
    hasPerm,
    ensureOnce,
    q,
    qa,
    onRouteChange,
    downloadText,
    copyText,
    getConversation,
    format,
    formatConversation: formatConversationCompat,
    saveConversation,
    listConversations,
    updateConversationMeta,
    getConversationById,
    getConversationIdForUrl,
    getGlobalNotes,
    setGlobalNotes,
    getConnectors,
    sendToConnector,
    extractArtifacts,
    openOptions,
    notify,
    onCleanup,
  };
}
