/**
 * Founder: Automation Connectors
 * =============================
 * Provides script actions for sending artifacts to configured webhooks.
 *
 * Configuration happens in Options → "Automation connectors".
 */

function pickDefaultConnector(connectors, options = {}) {
  const byId = connectors?.byId || {};
  const order = connectors?.order || [];
  const preferred = options.defaultConnectorId && byId[options.defaultConnectorId]?.enabled ? byId[options.defaultConnectorId] : null;
  if (preferred) return preferred;
  for (const id of order) {
    const c = byId[id];
    if (c?.enabled) return c;
  }
  return null;
}

function buildPayload(api, payloadType, convo, includeUrl = true) {
  const c = convo || api.getConversation();
  const meta = {
    id: c?.id || "",
    title: c?.title || "",
    ts: Date.now(),
    ...(includeUrl ? { url: c?.url || "" } : {})
  };
  const arts = api.extractArtifacts(c);

  switch (payloadType) {
    case "tasks":
      return { type: "tasks", meta, tasks: arts.tasks, decisions: arts.decisions, links: arts.links };
    case "decisions":
      return { type: "decisions", meta, decisions: arts.decisions, tasks: arts.tasks };
    case "links":
      return { type: "links", meta, links: arts.links };
    case "code":
      return { type: "code", meta, codeBlocks: arts.codeBlocks.slice(0, 12) };
    case "md":
      return { type: "markdown", meta, markdown: api.formatConversation(c, "md") };
    case "json":
    default:
      return { type: "conversation", meta, conversation: c };
  }
}

async function doSend({ api, payloadType, connectorId, options }) {
  const convo = api.getConversation();
  const payload = buildPayload(api, payloadType, convo, options?.includeCurrentUrl !== false);

  // prefer explicit connectorId, else configured default
  const cRes = await api.getConnectors();
  const connectors = cRes?.connectors || { byId: {}, order: [] };
  const target = connectorId ? connectors.byId?.[connectorId] : pickDefaultConnector(connectors, options);

  if (!target?.id) {
    api.notify("No enabled connector. Configure one in Options.", "warning");
    await api.openOptions();
    return { ok: false, error: "no_connector" };
  }

  const res = await api.sendToConnector({ connectorId: target.id, payload, kind: "json" });
  if (res?.ok) {
    api.notify(`Queued to ${target.name || target.id}`, "success");
  } else {
    if (res?.error === "missing_host_permission") {
      api.notify("Missing domain permission. Open Options → Grant domain.", "warning");
      await api.openOptions();
    } else {
      api.notify("Send failed", "error");
    }
  }
  return res;
}

export default async function run() {
  // no persistent UI needed; command palette + popup drive actions.
  return;
}

export async function onAction({ api, action, payload, context }) {
  const settings = (await chrome.runtime.sendMessage({ type: "awt:get_settings" }))?.settings || {};
  const options = settings?.scriptOptions?.["founder-connectors"] || {};
  if (action === "send") {
    const pt = payload?.payload || options.defaultPayload || "tasks";
    const connectorId = payload?.connectorId || options.defaultConnectorId || "";
    return await doSend({ api, payloadType: pt, connectorId, options });
  }
  if (action === "sendTasks") return await doSend({ api, payloadType: "tasks", connectorId: "", options });
  if (action === "sendMarkdown") return await doSend({ api, payloadType: "md", connectorId: "", options });
  if (action === "options") { await api.openOptions(); return { ok: true }; }
  return { ok: false, error: "unknown_action" };
}
