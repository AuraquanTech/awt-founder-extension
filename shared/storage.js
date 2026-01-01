/**
 * Storage helpers (chrome.storage.local)
 * =====================================
 * - Settings: awt_settings
 * - Conversations: awt_conversations
 * - Stats: awt_stats
 *
 * Privacy-first: local only (no sync).
 */

const SETTINGS_KEY = "awt_settings";
const CONV_KEY = "awt_conversations";
const STATS_KEY = "awt_stats";
const NOTES_KEY = "awt_notes";

export async function getSettings() {
  const res = await chrome.storage.local.get([SETTINGS_KEY]);
  return res?.[SETTINGS_KEY] || null;
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getStats() {
  const res = await chrome.storage.local.get([STATS_KEY]);
  return res?.[STATS_KEY] || { exports: 0, saves: 0 };
}

export async function bumpStat(field) {
  const stats = await getStats();
  stats[field] = (stats[field] || 0) + 1;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats;
}

export async function setScriptEnabled(scriptId, enabled) {
  const settings =
    (await getSettings()) || { registry: [], enabled: {}, approvals: {}, scriptOptions: {}, ui: {}, globalEnabled: true };
  settings.enabled = settings.enabled || {};
  settings.enabled[scriptId] = !!enabled;
  await setSettings(settings);
  return settings;
}

export function urlMatches(url, patterns) {
  // minimal match: supports patterns like https://chatgpt.com/*
  try {
    const u = new URL(url);
    const candidate = `${u.protocol}//${u.host}${u.pathname}`;
    return (patterns || []).some((p) => {
      if (!p.endsWith("/*")) return candidate.startsWith(p);
      return candidate.startsWith(p.slice(0, -1));
    });
  } catch {
    return false;
  }
}

export async function getEnabledScriptsForUrl(url) {
  const settings = await getSettings();
  if (!settings?.registry?.length || settings.globalEnabled === false) return [];
  const enabledMap = settings.enabled || {};
  return settings.registry.filter((s) => enabledMap[s.id] && urlMatches(url, s.matches || []));
}

/**
 * Conversation store
 * ------------------
 * Structure:
 * {
 *   byId: { [id]: conversation },
 *   order: [id...],
 *   urlToId: { [normalizedUrl]: id }
 * }
 */
export async function getConversationStore() {
  const res = await chrome.storage.local.get([CONV_KEY]);
  return res?.[CONV_KEY] || { byId: {}, order: [], urlToId: {} };
}

// ---- Global notes -------------------------------------------------------

export async function getNotesStore() {
  const res = await chrome.storage.local.get([NOTES_KEY]);
  return res?.[NOTES_KEY] || { global: { text: "", updatedAt: 0 } };
}

export async function setNotesStore(store) {
  await chrome.storage.local.set({ [NOTES_KEY]: store });
}

export async function getGlobalNotes() {
  const ns = await getNotesStore();
  return ns?.global || { text: "", updatedAt: 0 };
}

export async function setGlobalNotes(text) {
  const ns = await getNotesStore();
  ns.global = { text: String(text || ""), updatedAt: Date.now() };
  await setNotesStore(ns);
  return ns.global;
}

// ---- Direct conversation lookup ----------------------------------------

export async function getConversationById(id) {
  const store = await getConversationStore();
  return store.byId?.[id] || null;
}

export async function getConversationIdForUrl(url) {
  const store = await getConversationStore();
  try {
    const u = new URL(url);
    const normalized = `${u.origin}${u.pathname}`;
    return store.urlToId?.[normalized] || null;
  } catch {
    return null;
  }
}

function approxSize(obj) {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return 0;
  }
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(u || "");
  }
}

function stableIdFromUrl(u) {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
    if (m?.[1]) return `c_${m[1]}`;
  } catch {}
  return null;
}

export async function saveConversation(conversation, { maxItems = 80, maxBytes = 8_000_000 } = {}) {
  const store = await getConversationStore();
  const normalizedUrl = normalizeUrl(conversation?.url);

  const stable = stableIdFromUrl(conversation?.url);
  const incomingId = conversation?.id;
  if (!incomingId) throw new Error("Missing conversation.id");

  // Canonical ID:
  // - if stable exists, prefer stable
  // - else, prefer incoming
  let canonicalId = stable || incomingId;

  // If we previously mapped the URL to a temp ID, migrate to stable.
  const prevForUrl = store.urlToId?.[normalizedUrl];
  if (prevForUrl && prevForUrl !== canonicalId && stable) {
    // migrate previous to stable
    if (store.byId?.[prevForUrl] && !store.byId?.[canonicalId]) {
      store.byId[canonicalId] = store.byId[prevForUrl];
    }
    delete store.byId[prevForUrl];
    store.order = (store.order || []).filter((x) => x !== prevForUrl);
  }

  // If incoming ID is tmp_ but stable exists, also migrate that record.
  if (incomingId !== canonicalId && store.byId?.[incomingId]) {
    if (!store.byId?.[canonicalId]) store.byId[canonicalId] = store.byId[incomingId];
    delete store.byId[incomingId];
    store.order = (store.order || []).filter((x) => x !== incomingId);
  }

  // Save canonical conversation (ensure id is canonical)
// Merge with previous to preserve metadata (tags/pinned/notes) across autosaves.
const prev = store.byId?.[canonicalId] || {};
const now = Date.now();

const toSave = { ...prev, ...conversation, id: canonicalId };

// Preserve metadata unless explicitly overwritten
if (!Array.isArray(conversation?.tags) && Array.isArray(prev?.tags)) toSave.tags = prev.tags;
if (typeof conversation?.pinned === "undefined" && typeof prev?.pinned !== "undefined") toSave.pinned = prev.pinned;
if (typeof conversation?.notes === "undefined" && typeof prev?.notes !== "undefined") toSave.notes = prev.notes;

// Normalize metadata
if (!Array.isArray(toSave.tags)) toSave.tags = [];
toSave.pinned = !!toSave.pinned;

// Timestamps
toSave.createdAt = prev.createdAt || conversation.createdAt || now;
toSave.updatedAt = now;

store.byId[canonicalId] = toSave;

  // URL map
  if (normalizedUrl) {
    store.urlToId = store.urlToId || {};
    store.urlToId[normalizedUrl] = canonicalId;
  }

  // move id to front
  store.order = (store.order || []).filter((x) => x !== canonicalId);
  store.order.unshift(canonicalId);

  // enforce caps by count + bytes
  while (store.order.length > maxItems) {
    const drop = store.order.pop();
    if (drop) delete store.byId[drop];
  }
  while (approxSize(store) > maxBytes && store.order.length > 1) {
    const drop = store.order.pop();
    if (drop) delete store.byId[drop];
  }

  await chrome.storage.local.set({ [CONV_KEY]: store });
  return store;
}

export async function listConversations({ query = "", limit = 200, filters = {}, sort = "relevance" } = {}) {
  const store = await getConversationStore();
  const qRaw = (query || "").trim();
  const q = qRaw.toLowerCase();

  const stop = new Set(["the","a","an","and","or","to","of","in","on","for","with","is","are","was","were","be","as","at","by","from"]);
  const tokens = q.split(/[^a-z0-9_]+/i).filter(Boolean).filter(t => !stop.has(t));

  const wantPinnedOnly = !!filters.pinnedOnly;
  const wantHasCode = !!filters.hasCode;
  const wantTag = (filters.tag || "").toLowerCase().trim();
  const wantTags = Array.isArray(filters.tags) ? filters.tags.map(t => String(t).toLowerCase()) : null;
  const since = typeof filters.since === "number" ? filters.since : null;
  const until = typeof filters.until === "number" ? filters.until : null;

  function hasCode(c) {
    const t = String(c?.text || "");
    return t.includes("```") || /\b(stack trace|traceback|exception)\b/i.test(t);
  }

  function scoreConversation(c) {
    if (!qRaw) return 0;

    const title = String(c.title || "").toLowerCase();
    const url = String(c.url || "").toLowerCase();
    const text = String(c.text || "").toLowerCase();
    const tags = Array.isArray(c.tags) ? c.tags.map(t => String(t).toLowerCase()) : [];

    let score = 0;

    // phrase bonus
    if (q && title.includes(q)) score += 40;
    if (q && text.includes(q)) score += 10;

    // token scoring
    for (const t of tokens) {
      if (title.includes(t)) score += 18;
      if (tags.some(x => x.includes(t))) score += 14;
      if (url.includes(t)) score += 4;
      if (text.includes(t)) score += 4;

      // prefix/fuzzy-ish (word startswith)
      if (t.length >= 3) {
        const reWord = new RegExp(`\\b${t}`, "i");
        if (reWord.test(title)) score += 6;
        if (reWord.test(text)) score += 2;
      }
    }

    // recency boost (last 14 days gets up to +20%)
    const updatedAt = Number(c.updatedAt || c.ts || 0);
    const ageMs = Date.now() - updatedAt;
    const twoWeeks = 14 * 24 * 3600 * 1000;
    const boost = Math.max(0, Math.min(0.2, (twoWeeks - ageMs) / twoWeeks * 0.2));
    score = score * (1 + boost);

    // pinned slight boost
    if (c.pinned) score += 5;

    return score;
  }

  const items = [];
  for (const id of store.order || []) {
    const c = store.byId[id];
    if (!c) continue;

    // Filters
    if (wantPinnedOnly && !c.pinned) continue;
    if (wantHasCode && !hasCode(c)) continue;

    const updatedAt = Number(c.updatedAt || c.ts || 0);
    if (since && updatedAt && updatedAt < since) continue;
    if (until && updatedAt && updatedAt > until) continue;

    const ctags = Array.isArray(c.tags) ? c.tags.map(t => String(t).toLowerCase()) : [];
    if (wantTag && !ctags.includes(wantTag)) continue;
    if (wantTags && wantTags.length && !wantTags.every(t => ctags.includes(t))) continue;

    // Search match
    if (!qRaw) {
      items.push({ ...c, _score: 0 });
      if (items.length >= limit) break;
      continue;
    }

    const hay = `${c.title || ""}\n${c.url || ""}\n${(c.text || "").slice(0, 8000)}`.toLowerCase();
    if (!hay.includes(q) && tokens.length) {
      // require at least one token hit
      const any = tokens.some(t => hay.includes(t));
      if (!any) continue;
    }

    const s = scoreConversation(c);
    items.push({ ...c, _score: s });
  }

  // Sorting
  if (!qRaw || sort === "recent") {
    items.sort((a, b) => {
      if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return Number(b.updatedAt || b.ts || 0) - Number(a.updatedAt || a.ts || 0);
    });
  } else {
    items.sort((a, b) => {
      const ds = (b._score || 0) - (a._score || 0);
      if (ds) return ds;
      if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return Number(b.updatedAt || b.ts || 0) - Number(a.updatedAt || a.ts || 0);
    });
  }

  // trim + strip _score
  return items.slice(0, limit).map(({ _score, ...rest }) => rest);
}


export async function deleteConversation(id) {
  const store = await getConversationStore();
  if (store.byId?.[id]) delete store.byId[id];
  store.order = (store.order || []).filter((x) => x !== id);

  // clean urlToId
  if (store.urlToId) {
    for (const [u, v] of Object.entries(store.urlToId)) {
      if (v === id) delete store.urlToId[u];
    }
  }

  await chrome.storage.local.set({ [CONV_KEY]: store });
  return store;
}


/**
 * Update metadata for an existing conversation without resaving the full payload.
 * Useful for tags/pin/notes.
 */
export async function updateConversationMeta(id, patch = {}) {
  const store = await getConversationStore();
  const c = store.byId?.[id];
  if (!c) return null;

  const next = { ...c, ...patch };
  if ("tags" in patch) next.tags = Array.isArray(patch.tags) ? patch.tags : [];
  if ("pinned" in patch) next.pinned = !!patch.pinned;
  next.updatedAt = Date.now();

  store.byId[id] = next;
  // move to front if pinned change or user touched it
  store.order = (store.order || []).filter((x) => x !== id);
  store.order.unshift(id);

  await chrome.storage.local.set({ [CONV_KEY]: store });
  return next;
}

// ---- Connector jobs (reliable sends) ------------------------------------

const JOBS_KEY = "awt_jobs";

export async function getJobs() {
  const res = await chrome.storage.local.get([JOBS_KEY]);
  return res?.[JOBS_KEY] || { byId: {}, order: [] };
}

export async function setJobs(jobs) {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

export async function enqueueJob(job) {
  const jobs = await getJobs();
  const id = job.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const j = {
    id,
    type: job.type || "webhook",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    status: "queued", // queued|running|done|failed
    ...job,
  };
  jobs.byId[id] = j;
  jobs.order = (jobs.order || []).filter((x) => x !== id);
  jobs.order.unshift(id);
  await setJobs(jobs);
  return j;
}

export async function updateJob(id, patch = {}) {
  const jobs = await getJobs();
  const j = jobs.byId?.[id];
  if (!j) return null;
  jobs.byId[id] = { ...j, ...patch, updatedAt: Date.now() };
  await setJobs(jobs);
  return jobs.byId[id];
}

export async function removeJob(id) {
  const jobs = await getJobs();
  if (jobs.byId?.[id]) delete jobs.byId[id];
  jobs.order = (jobs.order || []).filter((x) => x !== id);
  await setJobs(jobs);
  return jobs;
}

export async function listJobs({ limit = 200 } = {}) {
  const jobs = await getJobs();
  const out = [];
  for (const id of jobs.order || []) {
    const j = jobs.byId[id];
    if (!j) continue;
    out.push(j);
    if (out.length >= limit) break;
  }
  return out;
}
