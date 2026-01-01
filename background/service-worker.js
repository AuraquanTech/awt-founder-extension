/**
 * Background service worker (module)
 * ==================================
 * - Holds settings/registry in chrome.storage.local
 * - Provides allowlisted APIs to content scripts via message passing
 * - Context menus + keyboard commands
 */

import { getDefaultRegistry } from "../shared/registry.js";
import {
  getSettings,
  setSettings,
  setScriptEnabled,
  getEnabledScriptsForUrl,
  saveConversation,
  listConversations,
  deleteConversation,
  updateConversationMeta,
  getConversationById,
  getConversationIdForUrl,
  getGlobalNotes,
  setGlobalNotes,
  enqueueJob,
  updateJob,
  listJobs,
  getJobs,
  bumpStat,
  getStats
} from "../shared/storage.js";

const VERSION = "2.1.0";

async function ensureInitialized() {
  const existing = await getSettings();
  const defaults = buildDefaultSettings(existing);
  if (!existing) {
    await setSettings(defaults);
    return defaults;
  }

  // merge registry updates (add new scripts)
  const merged = mergeSettings(existing, defaults);
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    await setSettings(merged);
  }
  return merged;
}

function buildDefaultSettings(existing) {
  const registry = getDefaultRegistry();
  const enabled = {};
  const approvals = {};
  const scriptOptions = {};
  for (const s of registry) {
    enabled[s.id] = s.defaultEnabled !== false; // auto-approve default scripts
    approvals[s.id] = Object.fromEntries((s.permissions || []).map((p) => [p, true]));
    scriptOptions[s.id] = s.defaultOptions || {};
  }
  return {
  version: VERSION,
  globalEnabled: true,
  registry,
  enabled,
  approvals,
  scriptOptions,
  connectors: existing?.connectors || { byId: {}, order: [] },
  ui: {
    theme: existing?.ui?.theme || "auto",
    defaultExportFormat: existing?.ui?.defaultExportFormat || "md",
  }
};
}

function mergeSettings(existing, defaults) {
  const out = { ...defaults, ...existing };
  // merge registry by id
  const byId = new Map((existing.registry || []).map((s) => [s.id, s]));
  for (const s of defaults.registry || []) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  out.registry = Array.from(byId.values());

  out.enabled = { ...(defaults.enabled || {}), ...(existing.enabled || {}) };
  out.approvals = { ...(defaults.approvals || {}), ...(existing.approvals || {}) };
  out.scriptOptions = { ...(defaults.scriptOptions || {}), ...(existing.scriptOptions || {}) };
  out.ui = { ...(defaults.ui || {}), ...(existing.ui || {}) };
  out.connectors = existing.connectors || defaults.connectors || { byId: {}, order: [] };
  if (typeof existing.globalEnabled === "boolean") out.globalEnabled = existing.globalEnabled;
  return out;
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "awt_export_md", title: "Export ChatGPT (Markdown)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "awt_export_txt", title: "Export ChatGPT (Text)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "awt_save", title: "Save conversation", contexts: ["action"] });
    chrome.contextMenus.create({ id: "awt_options", title: "Options", contexts: ["action"] });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === "awt_options") {
      await openOptions();
      return;
    }
    const type =
      info.menuItemId === "awt_export_md" ? "awt:export_current" :
      info.menuItemId === "awt_export_txt" ? "awt:export_current" :
      info.menuItemId === "awt_save" ? "awt:save_current" : null;

    const options =
      info.menuItemId === "awt_export_md" ? { format: "md" } :
      info.menuItemId === "awt_export_txt" ? { format: "txt" } :
      info.menuItemId === "awt_save" ? { autosave: false } : {};

    if (type) {
      try { await chrome.tabs.sendMessage(tab.id, { type, options }); } catch {}
    }
  });
}

async function openOptions() {
  try {
    await chrome.runtime.openOptionsPage();
  } catch {
    const url = chrome.runtime.getURL("options/options.html");
    await chrome.tabs.create({ url });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
  setupContextMenus();
  try { chrome.alarms.create("awt_job_pump", { periodInMinutes: 1 }); } catch {}
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized();
  setupContextMenus();
  try { chrome.alarms.create("awt_job_pump", { periodInMinutes: 1 }); } catch {}
});

chrome.commands.onCommand.addListener(async (command) => {
if (command === "search-conversations") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "awt:invoke_script_action", scriptId: "founder-power-search", action: "open" });
      return;
    } catch {}
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "awt:invoke_script_action", scriptId: "founder-command-palette", action: "open" });
      return;
    } catch {}
  }
  await openOptions();
  return;
}

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === "toggle-extension") {
    const res = await handleToggleGlobal();
    // no notification by default
    if (res.ok) {
      try { await chrome.tabs.sendMessage(tab.id, { type: "awt:run_now" }); } catch {}
    }
    return;
  }

  if (command === "toggle-prompts") {
    try { await chrome.tabs.sendMessage(tab.id, { type: "awt:invoke_script_action", scriptId: "founder-prompt-manager", action: "toggle" }); } catch {}
    return;
  }

  if (command === "quick-export") {
    const settings = await ensureInitialized();
    const fmt = settings.ui?.defaultExportFormat || "md";
    try { await chrome.tabs.sendMessage(tab.id, { type: "awt:export_current", options: { format: fmt } }); } catch {}
    return;
  }
});

// Message router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const settings = await ensureInitialized();

      switch (msg?.type) {
        case "awt:get_settings": {
          const stats = await getStats();
          sendResponse({ ok: true, settings, stats });
          return;
        }

        case "awt:open_options": {
          await openOptions();
          sendResponse({ ok: true });
          return;
        }

        case "awt:reset_settings": {
          const defaults = buildDefaultSettings(null);
          await setSettings(defaults);
          sendResponse({ ok: true });
          return;
        }

        case "awt:set_theme": {
          settings.ui = settings.ui || {};
          settings.ui.theme = msg.theme || "auto";
          await setSettings(settings);
          sendResponse({ ok: true });
          return;
        }

        case "awt:set_default_export_format": {
          settings.ui = settings.ui || {};
          settings.ui.defaultExportFormat = msg.format || "md";
          await setSettings(settings);
          sendResponse({ ok: true });
          return;
        }

        case "awt:toggle_global": {
          const res = await handleToggleGlobal();
          sendResponse(res);
          return;
        }

        case "awt:set_script_enabled": {
          await setScriptEnabled(msg.scriptId, msg.enabled);
          const updated = await getSettings();
          sendResponse({ ok: true, settings: updated });
          return;
        }

        case "awt:get_enabled_for_url": {
          const enabledScripts = await getEnabledScriptsForUrl(msg.url || sender?.url || "");
          sendResponse({ ok: true, enabledScripts });
          return;
        }

        case "awt:download_text": {
          const ok = await downloadText(msg.filename, msg.text, msg.mime);
          if (ok) await bumpStat("exports");
          sendResponse({ ok });
          return;
        }

        case "awt:save_conversation": {
          const conv = msg.conversation;
          const maxItems = settings.scriptOptions?.["chatgpt-conversation-manager"]?.maxSavedConversations || 80;
          await saveConversation(conv, { maxItems });
          await bumpStat("saves");
          sendResponse({ ok: true });
          return;
        }

        case "awt:list_conversations": {
          const items = await listConversations({ query: msg.query || "", limit: msg.limit || 200, filters: msg.filters || {}, sort: msg.sort || "relevance" });
          sendResponse({ ok: true, items });
          return;
        }

        case "awt:get_conversation_by_id": {
          const conversation = await getConversationById(msg.id);
          sendResponse({ ok: true, conversation });
          return;
        }

        case "awt:get_conversation_id_for_url": {
          const id = await getConversationIdForUrl(msg.url || sender?.url || "");
          sendResponse({ ok: true, id });
          return;
        }

        case "awt:get_global_notes": {
          const notes = await getGlobalNotes();
          sendResponse({ ok: true, notes });
          return;
        }

        case "awt:set_global_notes": {
          const notes = await setGlobalNotes(msg.text || "");
          sendResponse({ ok: true, notes });
          return;
        }

        case "awt:delete_conversation": {
          await deleteConversation(msg.id);
          sendResponse({ ok: true });
          return;
        }


case "awt:update_conversation_meta": {
  const updated = await updateConversationMeta(msg.id, msg.patch || {});
  sendResponse({ ok: true, conversation: updated });
  return;
}

case "awt:get_connectors": {
  sendResponse({ ok: true, connectors: settings.connectors || { byId: {}, order: [] } });
  return;
}

case "awt:set_connectors": {
  // store connectors inside settings
  settings.connectors = msg.connectors || { byId: {}, order: [] };
  await setSettings(settings);
  sendResponse({ ok: true, connectors: settings.connectors });
  return;
}

case "awt:connector_send": {
  const connectors = settings.connectors || { byId: {}, order: [] };
  const connector = connectors.byId?.[msg.connectorId];

  if (!connector) {
    sendResponse({ ok: false, error: "unknown_connector" });
    return;
  }
  if (!connector.enabled || !connector.url) {
    sendResponse({ ok: false, error: "connector_disabled" });
    return;
  }

  // host permission preflight
  const host = sanitizeUrlToHostPattern(connector.url);
  if (host) {
    try {
      const has = await chrome.permissions.contains({ origins: [host] });
      if (!has) {
        sendResponse({ ok: false, error: "missing_host_permission", origin: host });
        return;
      }
    } catch {}
  }

  // enqueue + best-effort immediate pump (alarm will retry)
  const job = await enqueueJob({
    type: "webhook",
    connectorId: msg.connectorId,
    payload: msg.payload,
    headers: msg.headers || {},
    kind: msg.kind || "json"
  });
  try { await pumpJobs(); } catch {}
  sendResponse({ ok: true, job });
  return;
}

case "awt:list_jobs": {
  const items = await listJobs({});
  sendResponse({ ok: true, items });
  return;
}

        default:
          sendResponse({ ok: false });
          return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});


chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name !== "awt_job_pump") return;
  try { await pumpJobs(); } catch {}
});

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendWebhook({ url, headers = {}, body, secret = "" }) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers
  };

  if (secret) {
    const ts = String(Date.now());
    const sig = await hmacSha256Hex(secret, ts + "." + payload);
    baseHeaders["X-AWT-Timestamp"] = ts;
    baseHeaders["X-AWT-Signature"] = `sha256=${sig}`;
  }

  const resp = await fetch(url, { method: "POST", headers: baseHeaders, body: payload, redirect: "follow" });
  const text = await resp.text().catch(() => "");
  return { ok: resp.ok, status: resp.status, text: text.slice(0, 2000) };
}

function sanitizeUrlToHostPattern(u) {
  try {
    const url = new URL(u);
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

async function pumpJobs() {
  const settings = await ensureInitialized();
  const jobs = await getJobs();

  const connectorById = settings.connectors?.byId || {};
  const order = Array.isArray(jobs.order) ? jobs.order.slice().reverse() : [];

  let processed = 0;
  for (const id of order) {
    if (processed >= 3) break;
    const j = jobs.byId?.[id];
    if (!j) continue;
    if (j.status === "done") continue;
    if (j.status === "running") continue;

    const now = Date.now();
    if (j.nextRunAt && now < j.nextRunAt) continue;

    const connector = connectorById[j.connectorId];
    if (!connector || !connector.enabled || !connector.url) {
      await updateJob(id, { status: "failed", error: "missing_connector", updatedAt: now });
      processed++;
      continue;
    }

    // Host permission check (best-effort)
    const host = sanitizeUrlToHostPattern(connector.url);
    if (host) {
      try {
        const has = await chrome.permissions.contains({ origins: [host] });
        if (!has) {
          await updateJob(id, { status: "failed", error: "missing_host_permission", updatedAt: now });
          processed++;
          continue;
        }
      } catch {}
    }

    await updateJob(id, { status: "running", attempts: (j.attempts || 0) + 1 });

    try {
      const res = await sendWebhook({
        url: connector.url,
        headers: { ...(connector.headers || {}), ...(j.headers || {}) },
        body: j.payload,
        secret: connector.secret || ""
      });

      if (res.ok) {
        await updateJob(id, { status: "done", result: { status: res.status }, error: "" });
      } else {
        const attempts = (j.attempts || 0) + 1;
        const backoff = Math.min(60_000 * attempts, 10 * 60_000); // up to 10 min
        await updateJob(id, {
          status: attempts >= 5 ? "failed" : "queued",
          error: `http_${res.status}`,
          lastResponse: res.text,
          nextRunAt: Date.now() + backoff
        });
      }
    } catch (e) {
      const attempts = (j.attempts || 0) + 1;
      const backoff = Math.min(60_000 * attempts, 10 * 60_000);
      await updateJob(id, {
        status: attempts >= 5 ? "failed" : "queued",
        error: String(e?.message || e),
        nextRunAt: Date.now() + backoff
      });
    }

    processed++;
  }
}

async function handleToggleGlobal() {
  const settings = await ensureInitialized();
  settings.globalEnabled = settings.globalEnabled === false ? true : false;
  await setSettings(settings);
  return { ok: true, globalEnabled: settings.globalEnabled };
}

async function downloadText(filename, text, mime = "text/plain") {
  try {
    const blob = new Blob([text || ""], { type: mime });
    let url = "";
    try {
      url = URL.createObjectURL(blob);
    } catch {
      // fallback to data url
      const enc = encodeURIComponent(text || "");
      url = `data:${mime};charset=utf-8,${enc}`;
    }

    const id = await chrome.downloads.download({
      url,
      filename: filename || `export-${Date.now()}.txt`,
      saveAs: false
    });

    // revoke object URL later if used
    if (url.startsWith("blob:")) setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 60_000);
    return !!id;
  } catch {
    return false;
  }
}
