import { getDefaultRegistry } from "../shared/registry.js";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}


async function sendAction(scriptId, action, payload) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "no_active_tab" };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "awt:invoke_script_action", scriptId, action, payload });
  } catch {
    return { ok: false, error: "no_receiver" };
  }
}

async function sendToActive(type, options) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "no_active_tab" };
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, options });
  } catch {
    return { ok: false, error: "no_receiver" };
  }
}

async function fetchSettings() {
  return await chrome.runtime.sendMessage({ type: "awt:get_settings" });
}

function setThemeAttr(theme) {
  document.documentElement.setAttribute("data-theme", theme || "auto");
}

function el(id) { return document.getElementById(id); }

function renderFeatures(settings) {
  const list = el("feature-list");
  list.innerHTML = "";

  const enabled = settings.enabled || {};
  const registry = settings.registry || [];
  for (const s of registry) {
    const item = document.createElement("div");
    item.className = "feature-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.dataset.scriptId = s.id;

    const status = enabled[s.id] ? "enabled" : "disabled";

    item.innerHTML = `
      <div class="feature-icon">${s.icon || "✨"}</div>
      <div class="feature-info">
        <div class="feature-name"></div>
        <div class="feature-desc"></div>
      </div>
      <div class="feature-status ${status}">${enabled[s.id] ? "ON" : "OFF"}</div>
    `;

    item.querySelector(".feature-name").textContent = s.name || s.id;
    item.querySelector(".feature-desc").textContent = s.description || "";

    const toggle = async () => {
      const now = !enabled[s.id];
      await chrome.runtime.sendMessage({ type: "awt:set_script_enabled", scriptId: s.id, enabled: now });
      await sendToActive("awt:run_now");
      const refreshed = await fetchSettings();
      if (refreshed?.ok) {
        updateUI(refreshed.settings, refreshed.stats);
      }
    };

    item.addEventListener("click", toggle);
    item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") toggle(); });

    list.appendChild(item);
  }
}

function updateUI(settings, stats) {
  el("version").textContent = `v${settings.version || "2.0.0"}`;
  const theme = settings.ui?.theme || "auto";
  setThemeAttr(theme);

  const registry = settings.registry || [];
  const enabled = settings.enabled || {};
  el("stat-enabled").textContent = String(registry.filter(s => enabled[s.id]).length);

  el("stat-exports").textContent = String(stats?.exports || 0);
  el("stat-saved").textContent = String(stats?.saves || 0);

  el("status-dot").className = `status-dot ${settings.globalEnabled === false ? "" : "active"}`;
  el("status-text").textContent = settings.globalEnabled === false ? "Disabled" : "Active";

  renderFeatures(settings);

  // theme buttons active state
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

async function main() {
  const resp = await fetchSettings();
  if (!resp?.ok) return;
  updateUI(resp.settings, resp.stats);

  // actions
  el("act-export-txt").addEventListener("click", () => sendToActive("awt:export_current", { format: "txt" }));
  el("act-export-md").addEventListener("click", () => sendToActive("awt:export_current", { format: "md" }));
  el("act-export-json").addEventListener("click", () => sendToActive("awt:export_current", { format: "json" }));
  el("act-save").addEventListener("click", () => sendToActive("awt:save_current", { autosave: false }));
  el("act-copy-md").addEventListener("click", () => sendToActive("awt:copy_current", { format: "md" }));
  el("act-run-now").addEventListener("click", () => sendToActive("awt:run_now"));
  el("act-open-palette")?.addEventListener("click", () => sendAction("founder-command-palette", "open"));
  el("act-open-search")?.addEventListener("click", () => sendAction("founder-power-search", "open"));
  el("act-send-tasks")?.addEventListener("click", () => sendAction("founder-connectors", "send", { payload: "tasks" }));

  // options
  el("open-options").addEventListener("click", () => chrome.runtime.sendMessage({ type: "awt:open_options" }));
  el("link-github").addEventListener("click", (e) => { e.preventDefault(); chrome.tabs.create({ url: "https://github.com/superpower-chatgpt-2.0" }); });

  // theme controls
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.theme;
      await chrome.runtime.sendMessage({ type: "awt:set_theme", theme });
      const updated = await fetchSettings();
      if (updated?.ok) updateUI(updated.settings, updated.stats);
    });
  });
}

main();
