/**
 * Script registry (packaged defaults)
 * ==================================
 * Clean-room scripts: packaged scripts only. No remote code.
 *
 * Convention:
 * - entry: ES module path within the extension
 * - defaultEnabled: whether the feature is ON after fresh install
 * - defaultOptions: per-script config stored in settings.scriptOptions[scriptId]
 */

export function getDefaultRegistry() {
  return [
    {
      id: "chatgpt-export-button",
      name: "ChatGPT: Export button",
      description: "Adds a small floating export button on ChatGPT chats (TXT/MD/JSON).",
      icon: "⬇️",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "download"],
      entry: "scripts/chatgpt/export-button.js",
      defaultEnabled: true,
      defaultOptions: {
        defaultFormat: "txt",
        hotkeys: true
      }
    },
    {
      id: "chatgpt-conversation-manager",
      name: "ChatGPT: Conversation manager",
      description: "Autosave + searchable saved list + export/copy panel.",
      icon: "💾",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage", "clipboard", "download"],
      entry: "scripts/chatgpt/conversation-manager.js",
      defaultEnabled: true,
      defaultOptions: {
        autosave: true,
        autosaveDebounceMs: 1200,
        maxSavedConversations: 120
      }
    },

    // Founder Power Pack (add-on bundle)
    {
      id: "founder-power-search",
      name: "Founder: Power Search",
      description: "High-signal search with filters (pinned/tags/code/date) + quick tagging + extracts (tasks/decisions/links/code).",
      icon: "🔎",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage", "clipboard", "download"],
      entry: "scripts/founder/power-search.js",
      defaultEnabled: true,
      defaultOptions: {
        hotkey: "mod+shift+f",
        defaultView: "snippets", // snippets|full|code|tasks|decisions|links
        recencyBoost: true,
        showPinnedFirst: true,
        quickTags: ["Roadmap", "Sales", "Ops", "Eng", "Bugs", "Legal"],
        maxResults: 80
      }
    },
    {
      id: "founder-command-palette",
      name: "Founder: Command palette",
      description: "Cmd/Ctrl+K palette for Save/Export/Copy/Send + jump to saved convos.",
      icon: "⌘",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage", "clipboard", "download", "network"],
      entry: "scripts/founder/command-palette.js",
      defaultEnabled: true,
      defaultOptions: {
        hotkey: "mod+k",
        placeholder: "Type a command or search saved…",
        includeConversationSearch: true,
        includeConnectorActions: true,
        maxResults: 18
      }
    },
    {
      id: "founder-connectors",
      name: "Founder: Automation connectors",
      description: "Send conversation artifacts (MD/JSON/tasks/decisions/links/code) to n8n/Zapier/Make webhooks. Local-only config + allowlist.",
      icon: "🔗",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage", "clipboard", "download", "network"],
      entry: "scripts/founder/connectors.js",
      defaultEnabled: true,
      defaultOptions: {
        // inert until connectors are configured in Options
        autoSendOnManualSave: false,
        autoSendOnAutosave: false,
        defaultConnectorId: "",
        defaultPayload: "tasks", // tasks|decisions|links|md|json|code
        includeCurrentUrl: true
      }
    },
    {
      id: "founder-notes-and-nav",
      name: "Founder: Notes + Navigation Dock",
      description: "Right-edge notes dock (chat + global) + mini nav dock (palette + prev/next message).",
      icon: "🗒️",
      matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage"],
      entry: "scripts/founder/notes-and-nav.js",
      defaultEnabled: true,
      defaultOptions: {
        startOpen: false,
        widthPx: 360,
        dockOffsetBottom: 126
      }
    },
    {
      id: "founder-prompt-manager",
      name: "Founder: Prompt Manager",
      description: "Cross-platform prompt library with templates, layered builder, workflows, and smart insertion.",
      icon: "📝",
      matches: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
        "https://perplexity.ai/*",
        "https://www.perplexity.ai/*",
        "https://gemini.google.com/*",
        "https://poe.com/*",
        "https://copilot.microsoft.com/*",
        "https://www.bing.com/chat*",
        "https://you.com/*",
        "https://huggingface.co/chat*",
        "https://grok.x.ai/*",
        "https://x.com/i/grok*"
      ],
      runAt: "document_idle",
      permissions: ["read_dom", "insert_ui", "storage", "clipboard"],
      entry: "scripts/founder/prompt-manager.js",
      defaultEnabled: true,
      defaultOptions: {
        hotkey: "mod+shift+p",
        autoSendEnabled: false,
        defaultView: "all",
        showToggleButton: true
      }
    }
  ];
}
