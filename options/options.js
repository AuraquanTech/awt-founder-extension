async function send(type, payload) {
  return await chrome.runtime.sendMessage({ type, ...(payload || {}) });
}

function el(id) { return document.getElementById(id); }

function formatMd(c) {
  let md = `# ${c.title || c.id}\n\n`;
  md += `**Date:** ${new Date(c.ts || Date.now()).toLocaleString()}\n\n`;
  if (c.url) md += `**URL:** ${c.url}\n\n`;
  md += `---\n\n`;

  if (Array.isArray(c.messages)) {
    for (const m of c.messages) {
      const icon = m.role === "user" ? "🧑" : "🤖";
      const name = m.role === "user" ? "User" : "Assistant";
      md += `## ${icon} ${name}\n\n${m.text || ""}\n\n---\n\n`;
    }
  } else if (c.text) {
    md += `${c.text}\n`;
  }
  return md.trim() + "\n";
}

async function rerunActiveTab() {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { type: "awt:run_now" }); } catch {}
  }
}

function renderScripts(settings) {
  const root = el("scripts");
  root.innerHTML = "";

  const enabled = settings.enabled || {};
  for (const s of settings.registry || []) {
    const row = document.createElement("div");
    row.className = "script";
    row.innerHTML = `
      <div class="name"></div>
      <div class="desc"></div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button data-id="${s.id}" class="btn-toggle"></button>
        <button data-id="${s.id}" class="btn-run">Run now</button>
      </div>
    `;
    row.querySelector(".name").textContent = s.name || s.id;
    row.querySelector(".desc").textContent = s.description || "";

    const btnToggle = row.querySelector(".btn-toggle");
    const btnRun = row.querySelector(".btn-run");

    const updateBtn = () => { btnToggle.textContent = enabled[s.id] ? "Disable" : "Enable"; };
    updateBtn();

    btnToggle.addEventListener("click", async () => {
      enabled[s.id] = !enabled[s.id];
      await send("awt:set_script_enabled", { scriptId: s.id, enabled: enabled[s.id] });
      updateBtn();
      await rerunActiveTab();
    });

    btnRun.addEventListener("click", rerunActiveTab);

    root.appendChild(row);
  }
}

function renderConvs(items) {
  const root = el("convs");
  root.innerHTML = "";
  if (!items.length) {
    root.textContent = "No saved conversations.";
    return;
  }
  for (const c of items) {
    const div = document.createElement("div");
    div.className = "script";
    div.innerHTML = `
      <div class="name"></div>
      <div class="desc"></div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-open">Open</button>
        <button class="btn-export">Export MD</button>
        <button class="btn-del">Delete</button>
      </div>
    `;
    div.querySelector(".name").textContent = c.title || c.id;
    div.querySelector(".desc").textContent = (c.text || "").replace(/\s+/g, " ").slice(0, 160);

    div.querySelector(".btn-open").addEventListener("click", () => { if (c.url) chrome.tabs.create({ url: c.url }); });
    div.querySelector(".btn-export").addEventListener("click", async () => {
      const md = formatMd(c);
      await send("awt:download_text", { filename: `${c.id}-${Date.now()}.md`, text: md, mime: "text/markdown" });
    });
    div.querySelector(".btn-del").addEventListener("click", async () => {
      await send("awt:delete_conversation", { id: c.id });
      const refreshed = await send("awt:list_conversations", { query: el("q").value || "" });
      renderConvs(refreshed.items || []);
    });

    root.appendChild(div);
  }
}


function parseHeaders(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const ln = line.trim();
    if (!ln) continue;
    const m = ln.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim();
    if (k) out[k] = v;
  }
  return out;
}

function originPattern(url) {
  try {
    const u = new URL(url);
    return `${u.origin}/*`;
  } catch {
    return "";
  }
}

async function requestHostPermission(url) {
  const pat = originPattern(url);
  if (!pat) return { ok: false, error: "invalid_url" };
  try {
    const has = await chrome.permissions.contains({ origins: [pat] });
    if (has) return { ok: true, already: true, pattern: pat };
    const granted = await chrome.permissions.request({ origins: [pat] });
    return { ok: !!granted, granted: !!granted, pattern: pat };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), pattern: pat };
  }
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return String(u || "");
  }
}

async function renderConnectors(connectors) {
  const root = el("connectors");
  if (!root) return;
  root.innerHTML = "";

  const order = connectors?.order || [];
  const byId = connectors?.byId || {};

  if (!order.length) {
    root.innerHTML = `<div class="sub">No connectors yet. Add one above.</div>`;
    return;
  }

  for (const id of order) {
    const c = byId[id];
    if (!c) continue;

    const row = document.createElement("div");
    row.className = "row";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "10px";
    row.style.padding = "10px";
    row.style.border = "1px solid #e5e7eb";
    row.style.borderRadius = "12px";
    row.style.marginTop = "10px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.gap = "4px";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.textContent = `${c.name || id}`;
    const meta = document.createElement("div");
    meta.className = "sub";
    meta.textContent = `${shortUrl(c.url)} • ${c.enabled ? "enabled" : "disabled"} • ${id}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.flexWrap = "wrap";
    right.style.justifyContent = "flex-end";

    const btnGrant = document.createElement("button");
    btnGrant.textContent = "Grant domain";
    btnGrant.addEventListener("click", async () => {
      const res = await requestHostPermission(c.url);
      alert(res.ok ? `Permission OK for ${res.pattern}` : `Permission failed: ${res.error || "denied"}`);
    });

    const btnToggle = document.createElement("button");
    btnToggle.textContent = c.enabled ? "Disable" : "Enable";
    btnToggle.addEventListener("click", async () => {
      c.enabled = !c.enabled;
      c.updatedAt = Date.now();
      connectors.byId[id] = c;
      await send("awt:set_connectors", { connectors });
      await renderConnectors(connectors);
    });

    const btnFill = document.createElement("button");
    btnFill.textContent = "Edit";
    btnFill.addEventListener("click", () => {
      el("conn_name").value = c.name || "";
      el("conn_url").value = c.url || "";
      el("conn_secret").value = c.secret || "";
      el("conn_headers").value = Object.entries(c.headers || {}).map(([k,v]) => `${k}: ${v}`).join("\n");
      root.dataset.editing = id;
      el("conn_add").textContent = "Update";
    });

    const btnDel = document.createElement("button");
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", async () => {
      if (!confirm(`Delete connector '${c.name || id}'?`)) return;
      delete connectors.byId[id];
      connectors.order = connectors.order.filter(x => x !== id);
      await send("awt:set_connectors", { connectors });
      await renderConnectors(connectors);
    });

    right.appendChild(btnGrant);
    right.appendChild(btnToggle);
    right.appendChild(btnFill);
    right.appendChild(btnDel);

    row.appendChild(left);
    row.appendChild(right);
    root.appendChild(row);
  }
}

async function renderJobs() {
  const root = el("jobs");
  if (!root) return;
  const res = await send("awt:list_jobs", {});
  const items = res?.items || [];
  if (!items.length) {
    root.textContent = "No sends yet.";
    return;
  }
  root.innerHTML = "";
  for (const j of items.slice(0, 12)) {
    const div = document.createElement("div");
    div.textContent = `${new Date(j.updatedAt || j.createdAt).toLocaleString()} • ${j.status} • ${j.connectorId || ""} • ${(j.error || "").slice(0,60)}`;
    root.appendChild(div);
  }
}

async function main() {
  const base = await send("awt:get_settings", {});
  if (!base?.ok) return;

  const settings = base.settings;

  el("theme").value = settings.ui?.theme || "auto";
  el("defaultExportFormat").value = settings.ui?.defaultExportFormat || "md";

  renderScripts(settings);

  // Connectors
  let connectors = (settings.connectors || (await send("awt:get_connectors", {})).connectors) || { byId: {}, order: [] };
  await renderConnectors(connectors);
  await renderJobs();

  const convs = await send("awt:list_conversations", { query: "" });
  renderConvs(convs.items || []);

  el("q").addEventListener("input", async (e) => {
    const res = await send("awt:list_conversations", { query: e.target.value || "" });
    renderConvs(res.items || []);
  });


// Connector add/update
if (el("conn_add")) {
  el("conn_add").addEventListener("click", async () => {
    const name = el("conn_name").value.trim();
    const url = el("conn_url").value.trim();
    const secret = el("conn_secret").value.trim();
    const headers = parseHeaders(el("conn_headers").value);

    if (!name || !url) {
      alert("Connector name + URL are required.");
      return;
    }

    const editing = el("connectors").dataset.editing || "";
    const id = editing || `conn_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30)}_${Date.now().toString(36)}`;

    const perm = await requestHostPermission(url);
    const enabled = !!perm.ok;

    connectors.byId[id] = {
      id,
      name,
      url,
      secret,
      headers,
      enabled,
      createdAt: connectors.byId[id]?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    connectors.order = (connectors.order || []).filter(x => x !== id);
    connectors.order.unshift(id);

    await send("awt:set_connectors", { connectors });
    el("connectors").dataset.editing = "";
    el("conn_add").textContent = "Add / Update";

    await renderConnectors(connectors);
    await renderJobs();
    alert(enabled ? "Connector saved + enabled." : "Connector saved. Permission was denied, so it's disabled.");
  });
}

if (el("conn_test")) {
  el("conn_test").addEventListener("click", async () => {
    const url = el("conn_url").value.trim();
    const name = el("conn_name").value.trim() || "Test";
    if (!url) return alert("Enter a webhook URL above.");
    const perm = await requestHostPermission(url);
    if (!perm.ok) return alert("Permission denied. Can't test.");

    // create ephemeral connector in memory (not saved unless you click Add/Update)
    const payload = { ok: true, type: "awt_test", name, ts: Date.now() };
    // pick matching connector if exists
    const existingId = (connectors.order || []).find(id => connectors.byId[id]?.url === url) || "";
    const res = await send("awt:connector_send", { connectorId: existingId || (connectors.order[0] || ""), payload, kind: "json" });

    await renderJobs();
    alert(res?.ok ? "Test enqueued (see Recent sends)." : `Test failed: ${res?.error || "unknown"}`);
  });
}

  el("theme").addEventListener("change", async (e) => {
    await send("awt:set_theme", { theme: e.target.value });
  });

  el("defaultExportFormat").addEventListener("change", async (e) => {
    await send("awt:set_default_export_format", { format: e.target.value });
  });

  const updateGlobalBtn = () => {
    el("toggle-global").textContent = settings.globalEnabled === false ? "Enable extension" : "Disable extension";
  };
  updateGlobalBtn();

  el("toggle-global").addEventListener("click", async () => {
    const res = await send("awt:toggle_global", {});
    if (res?.ok) {
      settings.globalEnabled = res.globalEnabled;
      updateGlobalBtn();
      await rerunActiveTab();
    }
  });

  el("reset").addEventListener("click", async () => {
    await send("awt:reset_settings", {});
    location.reload();
  });
}

main();
