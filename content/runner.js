/**
 * Script Runner (content module)
 * ==============================
 * Loads enabled scripts for the current URL and executes them with a scoped safe API.
 */

import { createSafeApi } from "./safe-api.js";
import { extractConversation, formatConversation, hashConversation, getConversationKeyFromUrl } from "./conversation.js";

const MODULE_CACHE = new Map(); // entry -> module
const RUNTIME_BY_SCRIPT = new Map(); // scriptId -> { cleanups: [], lastHash: string }
let lastUrl = location.href;
let runTimer = null;
let running = false;

async function getSettingsSnapshot() {
  const resp = await chrome.runtime.sendMessage({ type: "awt:get_settings" });
  return resp?.ok ? resp.settings : null;
}

async function getEnabledScripts() {
  const url = location.href;
  const resp = await chrome.runtime.sendMessage({ type: "awt:get_enabled_for_url", url });
  if (!resp?.ok) return [];
  return resp.enabledScripts || [];
}

async function loadModule(entry) {
  if (MODULE_CACHE.has(entry)) return MODULE_CACHE.get(entry);
  const url = chrome.runtime.getURL(entry);
  const mod = await import(url);
  MODULE_CACHE.set(entry, mod);
  return mod;
}


function cleanupAll() {
  for (const scriptId of Array.from(RUNTIME_BY_SCRIPT.keys())) {
    cleanupScript(scriptId);
    RUNTIME_BY_SCRIPT.delete(scriptId);
  }
}

function cleanupScript(scriptId) {
  const rt = RUNTIME_BY_SCRIPT.get(scriptId);
  if (!rt?.cleanups?.length) return;
  for (const fn of rt.cleanups) {
    try { fn(); } catch {}
  }
  rt.cleanups = [];
}

async function runScripts({ trigger = "startup" } = {}) {
  if (running) return;
  running = true;
  try {
    const enabled = await getEnabledScripts();
    if (!enabled.length) { cleanupAll(); return; }

    const settings = await getSettingsSnapshot();

    for (const scriptMeta of enabled) {
      const scriptId = scriptMeta.id;
      cleanupScript(scriptId);

      const rt = { cleanups: [], lastHash: RUNTIME_BY_SCRIPT.get(scriptId)?.lastHash || "" };
      RUNTIME_BY_SCRIPT.set(scriptId, rt);

      const api = createSafeApi({ scriptId, permissions: scriptMeta.permissions || [], runtime: rt });

      try {
        const mod = await loadModule(scriptMeta.entry);
        const runner = mod?.default || mod?.run;
        if (typeof runner !== "function") continue;

        const context = {
          trigger,
          url: location.href,
          key: getConversationKeyFromUrl(location.href),
          settings,
          scriptMeta,
        };

        const ret = await runner({ api, context });
        // allow returning a cleanup function
        if (typeof ret === "function") rt.cleanups.push(ret);
      } catch {
        // keep quiet
      }
    }
  } finally {
    running = false;
  }
}

function runDebounced(trigger) {
  clearTimeout(runTimer);
  runTimer = setTimeout(() => runScripts({ trigger }), 250);
}

async function exportCurrent({ format = "txt", filename = null } = {}) {
  const conv = extractConversation({});
  const fmt = format === "markdown" ? "md" : format;
  const text = formatConversation(conv, fmt);
  const ext = fmt === "md" ? "md" : fmt === "json" ? "json" : "txt";
  const safeName = filename || `${conv.id}-${Date.now()}.${ext}`;
  const resp = await chrome.runtime.sendMessage({ type: "awt:download_text", filename: safeName, text, mime: fmt === "json" ? "application/json" : fmt === "md" ? "text/markdown" : "text/plain" });
  return resp?.ok;
}

async function copyCurrent({ format = "txt" } = {}) {
  const conv = extractConversation({});
  const fmt = format === "markdown" ? "md" : format;
  const text = formatConversation(conv, fmt);
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
    } catch { return false; }
  }
}

async function saveCurrent({ autosave = false } = {}) {
  const conv = extractConversation({});
  // attach hash for change detection
  conv.hash = hashConversation(conv);
  conv.autosave = !!autosave;
  const resp = await chrome.runtime.sendMessage({ type: "awt:save_conversation", conversation: conv });
  return resp?.ok;
}

export function attachRunner() {
  // hook route change once (through API install)
  const api = createSafeApi({ scriptId: "awt-runner", permissions: ["read_dom"] });
  api.onRouteChange((url) => {
    if (url === lastUrl) return;
    lastUrl = url;
    runDebounced("route");
  });

  // first run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => runDebounced("domcontentloaded"), { once: true });
  } else {
    runDebounced("startup");
  }

  return {
    runNow: () => runDebounced("manual"),
    handleMessage: async (msg) => {
      if (!msg?.type) return;
      if (msg.type === "awt:run_now") {
        runDebounced("manual");
        return { ok: true };
      }
      if (msg.type === "awt:export_current") {
        const ok = await exportCurrent(msg.options || {});
        return { ok };
      }
      if (msg.type === "awt:copy_current") {
        const ok = await copyCurrent(msg.options || {});
        return { ok };
      }
      if (msg.type === "awt:save_current") {
        const ok = await saveCurrent(msg.options || {});
        return { ok };
      }
      if (msg.type === "awt:invoke_script_action") {
        const { scriptId, action, payload } = msg;
        try {
          const enabled = await getEnabledScripts();
          const meta = enabled.find((s) => s.id === scriptId);
          if (!meta) return { ok: false, error: "script_not_enabled" };
          const mod = await loadModule(meta.entry);
          const fn = mod?.onAction || mod?.action;
          if (typeof fn !== "function") return { ok: false, error: "no_action_handler" };
          const rt = RUNTIME_BY_SCRIPT.get(scriptId) || { cleanups: [] };
          const api = createSafeApi({ scriptId, permissions: meta.permissions || [], runtime: rt });
          const res = await fn({ api, action, payload, context: { url: location.href } });
          return { ok: true, result: res };
        } catch (e) {
          return { ok: false, error: String(e?.message || e) };
        }
      }
    }
  };
}

// Content bootstrap
// ----------------
// The MV3 content-script entrypoint imports this module and calls
// bootContentRunner(). Some earlier builds referenced a missing export,
// leaving popup/context-menu actions with no receiver.
export function bootContentRunner() {
  // Singleton per tab
  if (window.__awt_content_runner__?.booted) return window.__awt_content_runner__;

  const runner = attachRunner();

  const onMessage = (msg, sender, sendResponse) => {
    // Only handle our messages.
    if (!msg?.type || !String(msg.type).startsWith("awt:")) return;

    (async () => {
      try {
        const res = await runner.handleMessage?.(msg);
        if (typeof sendResponse === "function") sendResponse(res || { ok: true });
      } catch (e) {
        if (typeof sendResponse === "function") sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();

    // keep channel open for async response
    return true;
  };

  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {
    // ignore
  }

  const api = createSafeApi({ scriptId: "awt-runner", permissions: ["read_dom", "insert_ui", "storage", "clipboard", "download", "network"] });
  const cleanups = [];
  cleanups.push(() => { try { chrome.runtime.onMessage.removeListener(onMessage); } catch {} });

  const state = {
    booted: true,
    runner,
    destroy: () => {
      for (const fn of cleanups.splice(0)) {
        try { fn(); } catch {}
      }
      try { runner?.cleanup?.(); } catch {}
      window.__awt_content_runner__ = { booted: false };
    }
  };

  window.__awt_content_runner__ = state;
  return state;
}
