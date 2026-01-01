/**
 * Conversation extraction + formatting (ChatGPT)
 * =============================================
 * Resilient DOM capture scoped to <main>.
 */

export function getConversationKeyFromUrl(url = location.href) {
  try {
    const u = new URL(url);
    // ChatGPT conversations: /c/<id>
    const m = u.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
    if (m?.[1]) return `c_${m[1]}`;
    // fallback: temporary key
    const tmp = `${u.pathname}${u.search}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    return `tmp_${tmp || "new"}`;
  } catch {
    return `tmp_${Date.now()}`;
  }
}

export function getConversationTitle() {
  const t = (document.title || "").trim();
  if (!t) return "ChatGPT Conversation";
  // Strip common suffixes
  return t.replace(/\s*[-–—]\s*ChatGPT\s*$/i, "").replace(/^ChatGPT\s*[-–—]\s*/i, "").trim() || "ChatGPT Conversation";
}

export function normalizeText(s) {
  return (s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractConversation({ root = null } = {}) {
  const main = root || document.querySelector("main") || document.body;
  const nodes = Array.from(main.querySelectorAll("[data-message-author-role]"));

  const messages = [];
  for (const node of nodes) {
    const role = node.getAttribute("data-message-author-role") || "unknown";
    const contentNode =
      node.querySelector("[data-message-content]") ||
      node.querySelector(".markdown") ||
      node;

    const text = normalizeText(contentNode?.innerText || contentNode?.textContent || "");
    if (!text) continue;

    messages.push({ role, text });
  }

  const url = location.href;
  const id = getConversationKeyFromUrl(url);
  const title = getConversationTitle();

  return {
    id,
    title,
    url,
    ts: new Date().toISOString(),
    messages,
    text: messages.map((m) => `[${m.role.toUpperCase()}]\n${m.text}\n`).join("\n"),
  };
}

export function formatConversation(conversation, format = "txt") {
  const c = conversation;
  if (!c) return "";

  if (format === "json") {
    return JSON.stringify(c, null, 2);
  }

  if (format === "md" || format === "markdown") {
    let md = `# ${c.title}\n\n`;
    md += `**Date:** ${new Date(c.ts).toLocaleString()}\n\n`;
    md += `**URL:** ${c.url}\n\n---\n\n`;
    for (const m of c.messages || []) {
      const icon = m.role === "user" ? "🧑" : "🤖";
      const name = m.role === "user" ? "User" : "Assistant";
      md += `## ${icon} ${name}\n\n${m.text}\n\n---\n\n`;
    }
    return md.trim() + "\n";
  }

  // txt
  let out = `${c.title}\n`;
  out += `Date: ${new Date(c.ts).toLocaleString()}\n`;
  out += `URL: ${c.url}\n`;
  out += `${"=".repeat(60)}\n\n`;
  for (const m of c.messages || []) {
    out += `[${(m.role || "unknown").toUpperCase()}]\n${m.text}\n\n`;
  }
  return out.trim() + "\n";
}

export function hashConversation(conversation) {
  const s = (conversation?.messages || []).map((m) => `${m.role}:${m.text}`).join("\n");
  // lightweight hash (FNV-1a)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
