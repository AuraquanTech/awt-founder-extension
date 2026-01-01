/**
 * Founder Add-on: Prompt Manager
 * ===============================
 * Cross-platform prompt library with:
 * - Right-side sliding panel (300px)
 * - Toggle button above main chat input
 * - Fuzzy search with scoring
 * - Categories, tags, favorites, recents
 * - Layered prompt builder with drag/drop
 * - Variable auto-fill modal
 * - Workflow chains (MVP)
 * - Keyboard shortcuts (Ctrl+Shift+P)
 * - Import/export JSON
 *
 * Platforms: ChatGPT, Claude, Perplexity, Gemini, Poe, Copilot, Bing, You.com, HF Chat, Grok
 * Privacy: Local-only storage (chrome.storage.local)
 */

import { contextExtractor } from "./context-extractor.js";

export const meta = {
  id: "founder-prompt-manager",
  name: "Founder: Prompt Manager",
  description: "Cross-platform prompt library with templates, layered builder, workflows, and smart insertion.",
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
  defaultEnabled: true,
  permissions: ["insert_ui", "read_dom", "storage", "clipboard"]
};

// ============================================================================
// CONSTANTS
// ============================================================================

const Z_PANEL = 2147483640;
const Z_TOGGLE = 2147483639;
const Z_MODAL = 2147483645;
const PANEL_WIDTH = 300;
const STORAGE_KEY = "awt_prompts_v1";
const RECENTS_KEY = "awt_prompts_recents_v1";
const FAVORITES_KEY = "awt_prompts_favorites_v1";
const WORKFLOWS_KEY = "awt_prompts_workflows_v1";
const MAX_RECENTS = 20;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

function uuid() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact match bonus
  if (t === q) return 100;
  if (t.includes(q)) return 80 + (q.length / t.length) * 15;

  // Word-start matching
  const words = t.split(/\s+/);
  let wordScore = 0;
  for (const w of words) {
    if (w.startsWith(q)) wordScore += 30;
    else if (w.includes(q)) wordScore += 15;
  }
  if (wordScore > 0) return wordScore;

  // Fuzzy character matching
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 2 + consecutive;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  return qi === q.length ? score : 0;
}

// ============================================================================
// PLATFORM DETECTION & INPUT SELECTORS
// ============================================================================

function detectPlatform() {
  const host = location.hostname;
  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) return "chatgpt";
  if (host.includes("claude.ai")) return "claude";
  if (host.includes("perplexity.ai")) return "perplexity";
  if (host.includes("gemini.google.com")) return "gemini";
  if (host.includes("poe.com")) return "poe";
  if (host.includes("copilot.microsoft.com")) return "copilot";
  if (host.includes("bing.com")) return "bing";
  if (host.includes("you.com")) return "you";
  if (host.includes("huggingface.co")) return "huggingface";
  if (host.includes("grok.x.ai") || host.includes("x.com")) return "grok";
  return "unknown";
}

function getInputSelector() {
  const platform = detectPlatform();
  const selectors = {
    chatgpt: "#prompt-textarea, textarea[data-id='root']",
    claude: "[contenteditable='true'].ProseMirror, div[contenteditable='true']",
    perplexity: "textarea[placeholder*='Ask']",
    gemini: "rich-textarea .ql-editor, .text-input-field textarea",
    poe: "textarea[class*='ChatMessageInputView']",
    copilot: "textarea#userInput, textarea[aria-label*='chat']",
    bing: "textarea#searchbox, textarea[aria-label*='chat']",
    you: "textarea[placeholder*='Ask']",
    huggingface: "textarea[placeholder*='Type']",
    grok: "textarea[placeholder*='Ask'], div[contenteditable='true']",
    unknown: "textarea, [contenteditable='true']"
  };
  return selectors[platform] || selectors.unknown;
}

function getMainInput() {
  const selector = getInputSelector();
  const candidates = Array.from(document.querySelectorAll(selector));
  // Prefer visible, non-hidden inputs
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return candidates[0] || null;
}

function getSendButton() {
  const platform = detectPlatform();
  const selectors = {
    chatgpt: "button[data-testid='send-button'], button[aria-label*='Send']",
    claude: "button[aria-label*='Send'], button.send-button",
    perplexity: "button[aria-label*='Submit'], button[aria-label*='Send']",
    gemini: "button[aria-label*='Send']",
    poe: "button[class*='SendButton']",
    copilot: "button[aria-label*='Submit']",
    bing: "button[aria-label*='Submit']",
    you: "button[aria-label*='Send']",
    huggingface: "button[type='submit']",
    grok: "button[aria-label*='Send']",
    unknown: "button[type='submit'], button[aria-label*='Send']"
  };
  const selector = selectors[platform] || selectors.unknown;
  return document.querySelector(selector);
}

function insertIntoInput(text, autoSend = false) {
  const input = getMainInput();
  if (!input) return false;

  const isContentEditable = input.getAttribute("contenteditable") === "true";

  if (isContentEditable) {
    // For contenteditable (Claude, etc.)
    input.focus();
    input.innerHTML = "";
    const textNode = document.createTextNode(text);
    input.appendChild(textNode);
    // Trigger input event
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  } else {
    // For textarea
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (autoSend) {
    setTimeout(() => {
      const sendBtn = getSendButton();
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
    }, 100);
  }

  return true;
}

// ============================================================================
// STORAGE LAYER
// ============================================================================

async function getPromptStore() {
  try {
    const res = await chrome.storage.local.get([STORAGE_KEY]);
    return res?.[STORAGE_KEY] || { prompts: [], version: 1 };
  } catch {
    return { prompts: [], version: 1 };
  }
}

async function setPromptStore(store) {
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

async function getRecents() {
  try {
    const res = await chrome.storage.local.get([RECENTS_KEY]);
    return res?.[RECENTS_KEY] || [];
  } catch {
    return [];
  }
}

async function addToRecents(promptId) {
  const recents = await getRecents();
  const filtered = recents.filter(id => id !== promptId);
  filtered.unshift(promptId);
  const trimmed = filtered.slice(0, MAX_RECENTS);
  await chrome.storage.local.set({ [RECENTS_KEY]: trimmed });
}

async function getFavorites() {
  try {
    const res = await chrome.storage.local.get([FAVORITES_KEY]);
    return res?.[FAVORITES_KEY] || [];
  } catch {
    return [];
  }
}

async function setFavorites(favorites) {
  await chrome.storage.local.set({ [FAVORITES_KEY]: favorites });
}

async function toggleFavorite(promptId) {
  const favorites = await getFavorites();
  const idx = favorites.indexOf(promptId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push(promptId);
  }
  await setFavorites(favorites);
  return favorites;
}

async function getWorkflows() {
  try {
    const res = await chrome.storage.local.get([WORKFLOWS_KEY]);
    return res?.[WORKFLOWS_KEY] || [];
  } catch {
    return [];
  }
}

async function setWorkflows(workflows) {
  await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
}

// ============================================================================
// DEFAULT TEMPLATES
// ============================================================================

function getDefaultTemplates() {
  return [
    // Writing
    { id: "tpl_write_1", name: "Improve Writing", category: "Writing", tags: ["improve", "edit"], content: "Please improve the following text for clarity, grammar, and style while maintaining the original meaning:\n\n{{text}}", variables: ["text"], type: "single" },
    { id: "tpl_write_2", name: "Summarize", category: "Writing", tags: ["summary", "condense"], content: "Please provide a concise summary of the following:\n\n{{content}}", variables: ["content"], type: "single" },
    { id: "tpl_write_3", name: "Expand on Topic", category: "Writing", tags: ["expand", "elaborate"], content: "Please expand on the following topic with more detail and examples:\n\n{{topic}}", variables: ["topic"], type: "single" },
    { id: "tpl_write_4", name: "Change Tone", category: "Writing", tags: ["tone", "style"], content: "Please rewrite the following text in a {{tone}} tone:\n\n{{text}}", variables: ["tone", "text"], type: "single" },
    { id: "tpl_write_5", name: "Blog Post Outline", category: "Writing", tags: ["blog", "outline"], content: "Create a detailed outline for a blog post about:\n\nTopic: {{topic}}\nTarget audience: {{audience}}\nDesired length: {{length}}", variables: ["topic", "audience", "length"], type: "single" },

    // Coding
    { id: "tpl_code_1", name: "Code Review", category: "Coding", tags: ["review", "improve"], content: "Please review the following code for bugs, performance issues, and best practices:\n\n```{{language}}\n{{code}}\n```", variables: ["language", "code"], type: "single" },
    { id: "tpl_code_2", name: "Explain Code", category: "Coding", tags: ["explain", "learn"], content: "Please explain what this code does, line by line:\n\n```{{language}}\n{{code}}\n```", variables: ["language", "code"], type: "single" },
    { id: "tpl_code_3", name: "Convert Code", category: "Coding", tags: ["convert", "translate"], content: "Convert the following {{fromLang}} code to {{toLang}}:\n\n```{{fromLang}}\n{{code}}\n```", variables: ["fromLang", "toLang", "code"], type: "single" },
    { id: "tpl_code_4", name: "Debug Code", category: "Coding", tags: ["debug", "fix"], content: "This code has a bug. Please identify and fix it:\n\nError message: {{error}}\n\n```{{language}}\n{{code}}\n```", variables: ["error", "language", "code"], type: "single" },
    { id: "tpl_code_5", name: "Write Unit Tests", category: "Coding", tags: ["test", "testing"], content: "Write comprehensive unit tests for the following function using {{framework}}:\n\n```{{language}}\n{{code}}\n```", variables: ["framework", "language", "code"], type: "single" },
    { id: "tpl_code_6", name: "Optimize Performance", category: "Coding", tags: ["optimize", "performance"], content: "Optimize this code for better performance:\n\n```{{language}}\n{{code}}\n```\n\nFocus on: {{focus}}", variables: ["language", "code", "focus"], type: "single" },

    // Business
    { id: "tpl_biz_1", name: "Email Draft", category: "Business", tags: ["email", "communication"], content: "Draft a professional email:\n\nTo: {{recipient}}\nSubject: {{subject}}\nPurpose: {{purpose}}\nTone: {{tone}}", variables: ["recipient", "subject", "purpose", "tone"], type: "single" },
    { id: "tpl_biz_2", name: "Meeting Agenda", category: "Business", tags: ["meeting", "agenda"], content: "Create a meeting agenda:\n\nMeeting purpose: {{purpose}}\nDuration: {{duration}}\nAttendees: {{attendees}}\nKey topics to cover: {{topics}}", variables: ["purpose", "duration", "attendees", "topics"], type: "single" },
    { id: "tpl_biz_3", name: "SWOT Analysis", category: "Business", tags: ["analysis", "strategy"], content: "Perform a SWOT analysis for:\n\nCompany/Product: {{subject}}\nIndustry: {{industry}}\nContext: {{context}}", variables: ["subject", "industry", "context"], type: "single" },
    { id: "tpl_biz_4", name: "Project Brief", category: "Business", tags: ["project", "brief"], content: "Create a project brief:\n\nProject name: {{name}}\nObjective: {{objective}}\nScope: {{scope}}\nTimeline: {{timeline}}\nStakeholders: {{stakeholders}}", variables: ["name", "objective", "scope", "timeline", "stakeholders"], type: "single" },

    // Creative
    { id: "tpl_creative_1", name: "Story Idea Generator", category: "Creative", tags: ["story", "fiction"], content: "Generate a unique story idea with:\n\nGenre: {{genre}}\nSetting: {{setting}}\nMain conflict: {{conflict}}", variables: ["genre", "setting", "conflict"], type: "single" },
    { id: "tpl_creative_2", name: "Character Creator", category: "Creative", tags: ["character", "fiction"], content: "Create a detailed character profile:\n\nRole: {{role}}\nAge range: {{age}}\nPersonality traits: {{traits}}\nBackground: {{background}}", variables: ["role", "age", "traits", "background"], type: "single" },
    { id: "tpl_creative_3", name: "Brainstorm Ideas", category: "Creative", tags: ["brainstorm", "ideas"], content: "Brainstorm 10 creative ideas for:\n\nTopic: {{topic}}\nConstraints: {{constraints}}\nTarget audience: {{audience}}", variables: ["topic", "constraints", "audience"], type: "single" },

    // Research
    { id: "tpl_research_1", name: "Research Summary", category: "Research", tags: ["research", "summary"], content: "Research and summarize:\n\nTopic: {{topic}}\nDepth: {{depth}}\nFocus areas: {{focus}}\nFormat: {{format}}", variables: ["topic", "depth", "focus", "format"], type: "single" },
    { id: "tpl_research_2", name: "Compare Options", category: "Research", tags: ["compare", "analysis"], content: "Compare and contrast the following options:\n\nOptions: {{options}}\nCriteria: {{criteria}}\nContext: {{context}}", variables: ["options", "criteria", "context"], type: "single" },
    { id: "tpl_research_3", name: "Fact Check", category: "Research", tags: ["facts", "verify"], content: "Please fact-check the following claims and provide sources:\n\n{{claims}}", variables: ["claims"], type: "single" },

    // Productivity
    { id: "tpl_prod_1", name: "Task Breakdown", category: "Productivity", tags: ["tasks", "planning"], content: "Break down this goal into actionable tasks:\n\nGoal: {{goal}}\nTimeframe: {{timeframe}}\nResources available: {{resources}}", variables: ["goal", "timeframe", "resources"], type: "single" },
    { id: "tpl_prod_2", name: "Decision Matrix", category: "Productivity", tags: ["decision", "analysis"], content: "Help me decide between options:\n\nDecision: {{decision}}\nOptions: {{options}}\nImportant factors: {{factors}}\nConstraints: {{constraints}}", variables: ["decision", "options", "factors", "constraints"], type: "single" },

    // Smart Context Templates (showcase auto-fill feature)
    { id: "tpl_smart_1", name: "⚡ Fix My Error", category: "Smart Context", tags: ["error", "debug", "auto"], content: "I'm getting this error in my {{language}} code:\n\nError: {{error}}\n\nHere's the code:\n```{{language}}\n{{code}}\n```\n\nPlease explain what's wrong and how to fix it.", variables: ["language", "error", "code"], type: "single" },
    { id: "tpl_smart_2", name: "⚡ Review My Code", category: "Smart Context", tags: ["review", "auto"], content: "Please review this {{language}} code using {{framework}}:\n\n```{{language}}\n{{code}}\n```\n\nFocus on best practices, potential bugs, and performance.", variables: ["language", "framework", "code"], type: "single" },
    { id: "tpl_smart_3", name: "⚡ Continue This Feature", category: "Smart Context", tags: ["continue", "goal", "auto"], content: "I'm working on: {{goal}}\n\nHere's what I have so far:\n```{{language}}\n{{code}}\n```\n\nPlease help me complete this implementation.", variables: ["goal", "language", "code"], type: "single" },
    { id: "tpl_smart_4", name: "⚡ Explain This Code", category: "Smart Context", tags: ["explain", "learn", "auto"], content: "Explain this {{language}} code step by step:\n\n```{{language}}\n{{code}}\n```\n\nI'm particularly interested in understanding {{topic}}.", variables: ["language", "code", "topic"], type: "single" },

    // Layered Templates
    { id: "tpl_layer_1", name: "Layered: Expert Analysis", category: "Layered", tags: ["expert", "layered"], type: "layered", layers: [
      { id: "l1", content: "You are an expert {{expertise}} with {{years}} years of experience.", order: 0 },
      { id: "l2", content: "Analyze the following from your expert perspective:", order: 1 },
      { id: "l3", content: "{{content}}", order: 2 },
      { id: "l4", content: "Provide actionable recommendations.", order: 3 }
    ], variables: ["expertise", "years", "content"] },
    { id: "tpl_layer_2", name: "Layered: Step-by-Step Guide", category: "Layered", tags: ["guide", "tutorial", "layered"], type: "layered", layers: [
      { id: "l1", content: "Create a comprehensive step-by-step guide for:", order: 0 },
      { id: "l2", content: "Topic: {{topic}}", order: 1 },
      { id: "l3", content: "Target audience: {{audience}} (skill level: {{level}})", order: 2 },
      { id: "l4", content: "Include: prerequisites, detailed steps, tips, and common mistakes to avoid.", order: 3 }
    ], variables: ["topic", "audience", "level"] }
  ];
}

async function seedTemplatesIfNeeded() {
  const store = await getPromptStore();
  if (store.prompts && store.prompts.length > 0) return store;

  const defaults = getDefaultTemplates();
  store.prompts = defaults;
  store.seeded = true;
  await setPromptStore(store);
  return store;
}

// ============================================================================
// STYLES
// ============================================================================

function getStyles() {
  return `
    :root {
      --awt-pm-bg: rgba(17, 24, 39, 0.96);
      --awt-pm-border: rgba(255, 255, 255, 0.12);
      --awt-pm-text: #e5e7eb;
      --awt-pm-text-muted: rgba(229, 231, 235, 0.7);
      --awt-pm-accent: #10b981;
      --awt-pm-accent-hover: #059669;
      --awt-pm-input-bg: rgba(0, 0, 0, 0.3);
      --awt-pm-card-bg: rgba(255, 255, 255, 0.05);
      --awt-pm-card-hover: rgba(255, 255, 255, 0.08);
    }

    @media (prefers-color-scheme: light) {
      :root {
        --awt-pm-bg: rgba(255, 255, 255, 0.98);
        --awt-pm-border: rgba(0, 0, 0, 0.1);
        --awt-pm-text: #111827;
        --awt-pm-text-muted: rgba(17, 24, 39, 0.6);
        --awt-pm-input-bg: rgba(0, 0, 0, 0.04);
        --awt-pm-card-bg: rgba(0, 0, 0, 0.03);
        --awt-pm-card-hover: rgba(0, 0, 0, 0.06);
      }
    }

    /* Toggle Button */
    #awt-pm-toggle {
      position: fixed;
      z-index: ${Z_TOGGLE};
      background: var(--awt-pm-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 10px;
      padding: 6px 12px;
      color: var(--awt-pm-text);
      font: 700 12px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    #awt-pm-toggle:hover {
      border-color: var(--awt-pm-accent);
      transform: translateY(-1px);
    }

    #awt-pm-toggle.active {
      background: var(--awt-pm-accent);
      border-color: var(--awt-pm-accent);
      color: white;
    }

    /* Panel */
    #awt-pm-panel {
      position: fixed;
      right: -${PANEL_WIDTH + 10}px;
      top: 60px;
      width: ${PANEL_WIDTH}px;
      height: calc(100vh - 80px);
      max-height: calc(100vh - 80px);
      z-index: ${Z_PANEL};
      background: var(--awt-pm-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 16px 0 0 16px;
      box-shadow: -8px 0 40px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      transition: right 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }

    #awt-pm-panel.open {
      right: 0;
    }

    /* Header */
    .awt-pm-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      border-bottom: 1px solid var(--awt-pm-border);
      flex-shrink: 0;
    }

    .awt-pm-title {
      font: 800 14px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .awt-pm-header-actions {
      display: flex;
      gap: 4px;
    }

    .awt-pm-icon-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-card-bg);
      color: var(--awt-pm-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.15s;
    }

    .awt-pm-icon-btn:hover {
      background: var(--awt-pm-card-hover);
      border-color: var(--awt-pm-accent);
    }

    /* Search */
    .awt-pm-search {
      padding: 8px 12px;
      border-bottom: 1px solid var(--awt-pm-border);
      flex-shrink: 0;
    }

    .awt-pm-search-input {
      width: 100%;
      height: 34px;
      border-radius: 10px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-input-bg);
      color: var(--awt-pm-text);
      padding: 0 10px;
      font: 600 12px ui-sans-serif, system-ui, sans-serif;
      outline: none;
    }

    .awt-pm-search-input:focus {
      border-color: var(--awt-pm-accent);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
    }

    .awt-pm-search-input::placeholder {
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
    }

    /* Smart Context - Additional styles for auto-fill UI */
    .awt-pm-context-clear {
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.1);
      color: #10b981;
      font: 600 10px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      transition: all 0.15s ease;
    }

    .awt-pm-context-clear:hover {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
    }

    .awt-pm-var-clear {
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 10px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: 6px;
      opacity: 0.7;
      transition: all 0.15s ease;
    }

    .awt-pm-var-clear:hover {
      opacity: 1;
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.4);
      color: #ef4444;
    }

    .awt-pm-var-auto-filled {
      border-left: 3px solid #10b981;
      padding-left: 12px;
      background: linear-gradient(90deg, rgba(16, 185, 129, 0.05), transparent);
    }

    .awt-pm-auto-input {
      border-color: rgba(16, 185, 129, 0.4) !important;
      background: rgba(16, 185, 129, 0.05) !important;
    }

    .awt-pm-auto-input:focus {
      border-color: #10b981 !important;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15) !important;
    }

    /* Tabs */
    .awt-pm-tabs {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--awt-pm-border);
      flex-shrink: 0;
      overflow-x: auto;
    }

    .awt-pm-tab {
      flex: 1;
      min-width: 0;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-card-bg);
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      font: 700 10px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      white-space: nowrap;
      padding: 0 6px;
      transition: all 0.15s;
    }

    .awt-pm-tab.active {
      background: var(--awt-pm-accent);
      border-color: var(--awt-pm-accent);
      color: white;
    }

    .awt-pm-tab:hover:not(.active) {
      border-color: var(--awt-pm-accent);
    }

    /* Category Filter */
    .awt-pm-categories {
      display: flex;
      gap: 4px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--awt-pm-border);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: none;
    }

    .awt-pm-categories::-webkit-scrollbar {
      display: none;
    }

    .awt-pm-cat-chip {
      height: 24px;
      padding: 0 10px;
      border-radius: 12px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-card-bg);
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      font: 600 10px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }

    .awt-pm-cat-chip.active {
      background: rgba(16, 185, 129, 0.15);
      border-color: var(--awt-pm-accent);
      color: var(--awt-pm-accent);
    }

    /* Content Area */
    .awt-pm-content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .awt-pm-content::-webkit-scrollbar {
      width: 6px;
    }

    .awt-pm-content::-webkit-scrollbar-thumb {
      background: var(--awt-pm-border);
      border-radius: 3px;
    }

    /* Prompt Card */
    .awt-pm-card {
      background: var(--awt-pm-card-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .awt-pm-card:hover {
      background: var(--awt-pm-card-hover);
      border-color: var(--awt-pm-accent);
      transform: translateX(-2px);
    }

    .awt-pm-card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .awt-pm-card-name {
      font: 700 12px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .awt-pm-card-fav {
      font-size: 12px;
      cursor: pointer;
      opacity: 0.5;
      transition: opacity 0.15s;
    }

    .awt-pm-card-fav:hover,
    .awt-pm-card-fav.active {
      opacity: 1;
    }

    .awt-pm-card-preview {
      font: 500 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.4;
    }

    .awt-pm-card-meta {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      flex-wrap: wrap;
    }

    .awt-pm-tag {
      height: 18px;
      padding: 0 6px;
      border-radius: 9px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
    }

    .awt-pm-type-badge {
      height: 18px;
      padding: 0 6px;
      border-radius: 9px;
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
    }

    .awt-pm-type-badge.layered {
      background: rgba(168, 85, 247, 0.15);
      color: #a855f7;
    }

    .awt-pm-type-badge.workflow {
      background: rgba(249, 115, 22, 0.15);
      color: #f97316;
    }

    /* Empty State */
    .awt-pm-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
    }

    .awt-pm-empty-icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .awt-pm-empty-text {
      font: 600 12px ui-sans-serif, system-ui, sans-serif;
    }

    /* Footer Actions */
    .awt-pm-footer {
      padding: 8px 12px;
      border-top: 1px solid var(--awt-pm-border);
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .awt-pm-footer-btn {
      flex: 1;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-card-bg);
      color: var(--awt-pm-text);
      font: 700 11px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s;
    }

    .awt-pm-footer-btn:hover {
      background: var(--awt-pm-card-hover);
      border-color: var(--awt-pm-accent);
    }

    .awt-pm-footer-btn.primary {
      background: var(--awt-pm-accent);
      border-color: var(--awt-pm-accent);
      color: white;
    }

    .awt-pm-footer-btn.primary:hover {
      background: var(--awt-pm-accent-hover);
    }

    /* Modal Overlay */
    .awt-pm-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: ${Z_MODAL};
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s;
    }

    .awt-pm-modal-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .awt-pm-modal {
      width: 90%;
      max-width: 480px;
      max-height: 80vh;
      background: var(--awt-pm-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 16px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s;
    }

    .awt-pm-modal-overlay.open .awt-pm-modal {
      transform: scale(1);
    }

    .awt-pm-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--awt-pm-border);
    }

    .awt-pm-modal-title {
      font: 800 14px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-modal-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .awt-pm-modal-footer {
      padding: 12px 16px;
      border-top: 1px solid var(--awt-pm-border);
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    /* Variable Input */
    .awt-pm-var-group {
      margin-bottom: 14px;
    }

    .awt-pm-var-label {
      font: 700 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .awt-pm-var-label code {
      background: var(--awt-pm-card-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: var(--awt-pm-accent);
    }

    .awt-pm-var-input {
      width: 100%;
      min-height: 36px;
      border-radius: 8px;
      border: 1px solid var(--awt-pm-border);
      background: var(--awt-pm-input-bg);
      color: var(--awt-pm-text);
      padding: 8px 10px;
      font: 500 12px ui-sans-serif, system-ui, sans-serif;
      outline: none;
      resize: vertical;
    }

    .awt-pm-var-input:focus {
      border-color: var(--awt-pm-accent);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
    }

    /* Preview */
    .awt-pm-preview {
      background: var(--awt-pm-input-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 10px;
      padding: 12px;
      margin-top: 12px;
      max-height: 200px;
      overflow-y: auto;
    }

    .awt-pm-preview-label {
      font: 700 10px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .awt-pm-preview-content {
      font: 500 12px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
      white-space: pre-wrap;
      line-height: 1.5;
    }

    /* Layered Builder */
    .awt-pm-layers {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .awt-pm-layer {
      background: var(--awt-pm-card-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 8px;
      padding: 8px;
      cursor: grab;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .awt-pm-layer:active {
      cursor: grabbing;
    }

    .awt-pm-layer.dragging {
      opacity: 0.5;
      border-style: dashed;
    }

    .awt-pm-layer-handle {
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      font-size: 12px;
      cursor: grab;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .awt-pm-layer-content {
      flex: 1;
      font: 500 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
      line-height: 1.4;
    }

    .awt-pm-layer-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .awt-pm-layer-btn {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
    }

    .awt-pm-layer-btn:hover {
      background: var(--awt-pm-card-hover);
      color: var(--awt-pm-text);
    }

    /* Checkbox */
    .awt-pm-checkbox {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font: 600 12px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-checkbox input {
      width: 16px;
      height: 16px;
      accent-color: var(--awt-pm-accent);
    }

    /* Workflow Chain */
    .awt-pm-workflow-step {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      background: var(--awt-pm-card-bg);
      border: 1px solid var(--awt-pm-border);
      border-radius: 8px;
      margin-bottom: 6px;
    }

    .awt-pm-workflow-num {
      width: 24px;
      height: 24px;
      border-radius: 12px;
      background: var(--awt-pm-accent);
      color: white;
      font: 700 11px ui-sans-serif, system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .awt-pm-workflow-name {
      flex: 1;
      font: 600 12px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    /* Keyboard hint */
    .awt-pm-kbd {
      display: inline-flex;
      align-items: center;
      padding: 2px 5px;
      border-radius: 4px;
      background: var(--awt-pm-card-bg);
      border: 1px solid var(--awt-pm-border);
      font: 600 9px ui-monospace, monospace;
      color: var(--awt-pm-text-muted);
    }

    /* Smart Context - Auto-detected badges */
    .awt-pm-auto-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(16, 185, 129, 0.4);
      font: 700 9px ui-sans-serif, system-ui, sans-serif;
      color: #10b981;
      margin-left: 8px;
      animation: awt-pm-pulse 2s ease-in-out;
    }

    .awt-pm-auto-badge .sparkle {
      font-size: 10px;
    }

    .awt-pm-confidence {
      width: 40px;
      height: 4px;
      background: var(--awt-pm-border);
      border-radius: 2px;
      overflow: hidden;
      margin-left: 4px;
    }

    .awt-pm-confidence-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981, #3b82f6);
      border-radius: 2px;
      transition: width 0.3s ease;
    }

    .awt-pm-var-input.auto-filled {
      border-color: rgba(16, 185, 129, 0.5);
      background: linear-gradient(135deg, var(--awt-pm-input-bg), rgba(16, 185, 129, 0.05));
    }

    .awt-pm-context-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(59, 130, 246, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      font: 600 11px ui-sans-serif, system-ui, sans-serif;
      color: var(--awt-pm-text);
    }

    .awt-pm-context-banner .icon {
      font-size: 16px;
    }

    .awt-pm-context-banner .text {
      flex: 1;
    }

    .awt-pm-context-banner .count {
      background: var(--awt-pm-accent);
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 800;
    }

    @keyframes awt-pm-pulse {
      0% { opacity: 0; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.02); }
      100% { opacity: 1; transform: scale(1); }
    }

    .awt-pm-clear-btn {
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid var(--awt-pm-border);
      background: transparent;
      color: var(--awt-pm-text-muted);
      font: 600 9px ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
      margin-left: auto;
    }
  `;
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

function ensureStyles(api) {
  api.ensureOnce("awt-pm-styles", () => {
    const style = document.createElement("style");
    style.id = "awt-pm-styles";
    style.textContent = getStyles();
    document.head.appendChild(style);
  });
}

function createToggleButton() {
  const btn = document.createElement("button");
  btn.id = "awt-pm-toggle";
  btn.type = "button";
  btn.innerHTML = `<span>📝</span> Prompts`;
  return btn;
}

function createPanel() {
  const panel = document.createElement("div");
  panel.id = "awt-pm-panel";
  panel.innerHTML = `
    <div class="awt-pm-header">
      <div class="awt-pm-title">
        <span>📝</span> Prompt Manager
      </div>
      <div class="awt-pm-header-actions">
        <button class="awt-pm-icon-btn" data-action="create" title="Create New">+</button>
        <button class="awt-pm-icon-btn" data-action="import" title="Import">⬆</button>
        <button class="awt-pm-icon-btn" data-action="export" title="Export">⬇</button>
        <button class="awt-pm-icon-btn" data-action="close" title="Close">✕</button>
      </div>
    </div>

    <div class="awt-pm-search">
      <input type="text" class="awt-pm-search-input" placeholder="Search prompts... (Ctrl+Shift+P)" id="awt-pm-search">
    </div>

    <div class="awt-pm-tabs">
      <button class="awt-pm-tab active" data-tab="all">All</button>
      <button class="awt-pm-tab" data-tab="favorites">★</button>
      <button class="awt-pm-tab" data-tab="recents">Recent</button>
      <button class="awt-pm-tab" data-tab="workflows">Flows</button>
    </div>

    <div class="awt-pm-categories" id="awt-pm-categories"></div>

    <div class="awt-pm-content" id="awt-pm-content"></div>

    <div class="awt-pm-footer">
      <button class="awt-pm-footer-btn" data-action="builder">
        <span>🔧</span> Builder
      </button>
      <button class="awt-pm-footer-btn" data-action="workflow">
        <span>⚡</span> Workflow
      </button>
    </div>
  `;
  return panel;
}

function createModalOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "awt-pm-modal-overlay";
  overlay.id = "awt-pm-modal-overlay";
  overlay.innerHTML = `
    <div class="awt-pm-modal" id="awt-pm-modal">
      <div class="awt-pm-modal-header">
        <div class="awt-pm-modal-title" id="awt-pm-modal-title">Modal</div>
        <button class="awt-pm-icon-btn" data-action="close-modal">✕</button>
      </div>
      <div class="awt-pm-modal-body" id="awt-pm-modal-body"></div>
      <div class="awt-pm-modal-footer" id="awt-pm-modal-footer"></div>
    </div>
  `;
  return overlay;
}

// ============================================================================
// MAIN CONTROLLER
// ============================================================================

class PromptManager {
  constructor(api) {
    this.api = api;
    this.isOpen = false;
    this.currentTab = "all";
    this.currentCategory = "all";
    this.searchQuery = "";
    this.prompts = [];
    this.favorites = [];
    this.recents = [];
    this.workflows = [];
    this.draggedLayer = null;
  }

  async init() {
    ensureStyles(this.api);

    // Create UI elements
    this.toggle = createToggleButton();
    this.panel = createPanel();
    this.modalOverlay = createModalOverlay();

    document.body.appendChild(this.toggle);
    document.body.appendChild(this.panel);
    document.body.appendChild(this.modalOverlay);

    // Load data
    await this.loadData();

    // Position toggle button
    this.positionToggle();

    // Bind events
    this.bindEvents();

    // Render initial content
    this.renderCategories();
    this.renderContent();

    // Observe for input position changes
    this.observeInput();
  }

  async loadData() {
    const store = await seedTemplatesIfNeeded();
    this.prompts = store.prompts || [];
    this.favorites = await getFavorites();
    this.recents = await getRecents();
    this.workflows = await getWorkflows();
  }

  positionToggle() {
    const input = getMainInput();
    if (!input) {
      // Fallback position
      this.toggle.style.right = "20px";
      this.toggle.style.bottom = "120px";
      return;
    }

    const rect = input.getBoundingClientRect();
    const inputTop = rect.top + window.scrollY;

    // Position above and to the right of the input
    this.toggle.style.right = "20px";
    this.toggle.style.bottom = `${window.innerHeight - inputTop + 10}px`;
  }

  observeInput() {
    // Reposition toggle when window resizes or DOM changes
    const reposition = debounce(200, () => this.positionToggle());

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition);

    // MutationObserver for SPA navigation
    const observer = new MutationObserver(reposition);
    observer.observe(document.body, { childList: true, subtree: true });

    this.api.onCleanup(() => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition);
      observer.disconnect();
    });

    // Also reposition on route change
    this.api.onRouteChange(() => {
      setTimeout(() => this.positionToggle(), 500);
    });
  }

  bindEvents() {
    // Toggle button
    this.toggle.addEventListener("click", () => this.togglePanel());

    // Panel header actions
    this.panel.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.action;
        this.handleAction(action);
      });
    });

    // Tabs
    this.panel.querySelectorAll("[data-tab]").forEach(tab => {
      tab.addEventListener("click", (e) => {
        this.setTab(e.currentTarget.dataset.tab);
      });
    });

    // Search
    const searchInput = this.panel.querySelector("#awt-pm-search");
    searchInput.addEventListener("input", debounce(150, (e) => {
      this.searchQuery = e.target.value;
      this.renderContent();
    }));

    // Modal close
    this.modalOverlay.addEventListener("click", (e) => {
      if (e.target === this.modalOverlay) this.closeModal();
    });

    this.modalOverlay.querySelector("[data-action='close-modal']").addEventListener("click", () => {
      this.closeModal();
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Ctrl+Shift+P to toggle
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        this.togglePanel();
        if (this.isOpen) {
          setTimeout(() => searchInput.focus(), 100);
        }
      }

      // Escape to close
      if (e.key === "Escape") {
        if (this.modalOverlay.classList.contains("open")) {
          this.closeModal();
        } else if (this.isOpen) {
          this.closePanel();
        }
      }
    });
  }

  togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  openPanel() {
    this.isOpen = true;
    this.panel.classList.add("open");
    this.toggle.classList.add("active");

    // Set right inset for other UI elements
    document.documentElement.style.setProperty("--awt-right-inset", `${PANEL_WIDTH}px`);
  }

  closePanel() {
    this.isOpen = false;
    this.panel.classList.remove("open");
    this.toggle.classList.remove("active");

    document.documentElement.style.setProperty("--awt-right-inset", "0px");
  }

  setTab(tab) {
    this.currentTab = tab;
    this.panel.querySelectorAll("[data-tab]").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });
    this.renderContent();
  }

  handleAction(action) {
    switch (action) {
      case "close":
        this.closePanel();
        break;
      case "create":
        this.showCreateModal();
        break;
      case "import":
        this.showImportModal();
        break;
      case "export":
        this.exportPrompts();
        break;
      case "builder":
        this.showBuilderModal();
        break;
      case "workflow":
        this.showWorkflowModal();
        break;
    }
  }

  getCategories() {
    const cats = new Set(["All"]);
    for (const p of this.prompts) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats);
  }

  renderCategories() {
    const container = this.panel.querySelector("#awt-pm-categories");
    const cats = this.getCategories();

    container.innerHTML = cats.map(cat => `
      <button class="awt-pm-cat-chip ${cat.toLowerCase() === this.currentCategory ? "active" : ""}"
              data-category="${esc(cat.toLowerCase())}">
        ${esc(cat)}
      </button>
    `).join("");

    container.querySelectorAll(".awt-pm-cat-chip").forEach(chip => {
      chip.addEventListener("click", (e) => {
        this.currentCategory = e.currentTarget.dataset.category;
        container.querySelectorAll(".awt-pm-cat-chip").forEach(c => {
          c.classList.toggle("active", c.dataset.category === this.currentCategory);
        });
        this.renderContent();
      });
    });
  }

  getFilteredPrompts() {
    let results = [...this.prompts];

    // Filter by tab
    if (this.currentTab === "favorites") {
      results = results.filter(p => this.favorites.includes(p.id));
    } else if (this.currentTab === "recents") {
      const recentSet = new Set(this.recents);
      results = results.filter(p => recentSet.has(p.id));
      // Sort by recents order
      results.sort((a, b) => this.recents.indexOf(a.id) - this.recents.indexOf(b.id));
    } else if (this.currentTab === "workflows") {
      return this.workflows;
    }

    // Filter by category
    if (this.currentCategory !== "all") {
      results = results.filter(p =>
        (p.category || "").toLowerCase() === this.currentCategory
      );
    }

    // Filter by search
    if (this.searchQuery) {
      results = results.map(p => {
        const text = `${p.name} ${p.category || ""} ${(p.tags || []).join(" ")} ${p.content || ""}`;
        const score = fuzzyScore(this.searchQuery, text);
        return { ...p, _score: score };
      }).filter(p => p._score > 0).sort((a, b) => b._score - a._score);
    }

    return results;
  }

  renderContent() {
    const container = this.panel.querySelector("#awt-pm-content");
    const prompts = this.getFilteredPrompts();

    if (prompts.length === 0) {
      container.innerHTML = `
        <div class="awt-pm-empty">
          <div class="awt-pm-empty-icon">📭</div>
          <div class="awt-pm-empty-text">
            ${this.currentTab === "workflows" ? "No workflows yet" :
              this.currentTab === "favorites" ? "No favorites yet" :
              this.currentTab === "recents" ? "No recent prompts" :
              this.searchQuery ? "No matches found" : "No prompts yet"}
          </div>
        </div>
      `;
      return;
    }

    if (this.currentTab === "workflows") {
      container.innerHTML = prompts.map(w => `
        <div class="awt-pm-card" data-workflow-id="${esc(w.id)}">
          <div class="awt-pm-card-header">
            <div class="awt-pm-card-name">${esc(w.name)}</div>
          </div>
          <div class="awt-pm-card-preview">${w.steps?.length || 0} steps</div>
          <div class="awt-pm-card-meta">
            <span class="awt-pm-type-badge workflow">Workflow</span>
          </div>
        </div>
      `).join("");

      container.querySelectorAll("[data-workflow-id]").forEach(card => {
        card.addEventListener("click", () => {
          const id = card.dataset.workflowId;
          const workflow = this.workflows.find(w => w.id === id);
          if (workflow) this.runWorkflow(workflow);
        });
      });
      return;
    }

    container.innerHTML = prompts.map(p => {
      const isFav = this.favorites.includes(p.id);
      const preview = p.type === "layered"
        ? p.layers?.map(l => l.content).join(" ").slice(0, 100)
        : (p.content || "").slice(0, 100);

      return `
        <div class="awt-pm-card" data-prompt-id="${esc(p.id)}">
          <div class="awt-pm-card-header">
            <div class="awt-pm-card-name">${esc(p.name)}</div>
            <span class="awt-pm-card-fav ${isFav ? "active" : ""}" data-fav-id="${esc(p.id)}">
              ${isFav ? "★" : "☆"}
            </span>
          </div>
          <div class="awt-pm-card-preview">${esc(preview)}...</div>
          <div class="awt-pm-card-meta">
            ${p.type === "layered" ? '<span class="awt-pm-type-badge layered">Layered</span>' : ""}
            ${(p.tags || []).slice(0, 2).map(t => `<span class="awt-pm-tag">${esc(t)}</span>`).join("")}
          </div>
        </div>
      `;
    }).join("");

    // Bind card clicks
    container.querySelectorAll("[data-prompt-id]").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.classList.contains("awt-pm-card-fav")) return;
        const id = card.dataset.promptId;
        const prompt = this.prompts.find(p => p.id === id);
        if (prompt) this.usePrompt(prompt);
      });
    });

    // Bind favorite clicks
    container.querySelectorAll("[data-fav-id]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.favId;
        this.favorites = await toggleFavorite(id);
        btn.textContent = this.favorites.includes(id) ? "★" : "☆";
        btn.classList.toggle("active", this.favorites.includes(id));
      });
    });
  }

  async usePrompt(prompt) {
    // Add to recents
    await addToRecents(prompt.id);
    this.recents = await getRecents();

    // Check for variables
    const variables = prompt.variables || [];
    if (prompt.type === "layered") {
      // Extract variables from all layers
      const layerContent = prompt.layers?.map(l => l.content).join("\n") || "";
      const matches = layerContent.match(/\{\{(\w+)\}\}/g) || [];
      variables.push(...matches.map(m => m.slice(2, -2)));
    }

    const uniqueVars = [...new Set(variables)];

    if (uniqueVars.length > 0) {
      this.showVariableModal(prompt, uniqueVars);
    } else {
      // No variables, insert directly
      const content = prompt.type === "layered"
        ? prompt.layers?.map(l => l.content).join("\n\n")
        : prompt.content;
      this.insertPrompt(content);
    }
  }

  showVariableModal(prompt, variables) {
    const title = document.getElementById("awt-pm-modal-title");
    const body = document.getElementById("awt-pm-modal-body");
    const footer = document.getElementById("awt-pm-modal-footer");

    title.textContent = "Fill Variables";

    // =========================================================================
    // SMART CONTEXT INJECTION - The Killer Feature!
    // =========================================================================
    // Extract context from the current conversation (with error handling)
    let context = null;
    let autoMappings = {};
    let autoFilledCount = 0;

    try {
      context = contextExtractor.extract();
      autoMappings = contextExtractor.mapVariablesToContext(variables, context);
      autoFilledCount = Object.keys(autoMappings).length;
    } catch (err) {
      console.warn("[Prompt Manager] Smart Context extraction failed:", err);
      // Graceful degradation - continue without auto-fill
    }

    // Build context banner if we detected anything useful
    const contextBanner = autoFilledCount > 0 ? `
      <div class="awt-pm-context-banner">
        <span class="awt-pm-context-icon">✨</span>
        <span class="awt-pm-context-text">Smart Context detected ${autoFilledCount} variable${autoFilledCount > 1 ? 's' : ''} from your conversation!</span>
        <button class="awt-pm-context-clear" id="awt-pm-clear-all-auto">Clear All</button>
      </div>
    ` : '';

    // Build variable groups with auto-fill support
    const varGroupsHtml = variables.map(v => {
      const autoValue = autoMappings[v];
      const isAutoFilled = autoValue !== undefined && autoValue !== '';
      const badgeHtml = isAutoFilled ? `<span class="awt-pm-auto-badge">✨ auto-detected</span>` : '';
      const clearBtnHtml = isAutoFilled ? `<button class="awt-pm-var-clear" data-clear-var="${esc(v)}" title="Clear auto-fill">✕</button>` : '';

      return `
        <div class="awt-pm-var-group ${isAutoFilled ? 'awt-pm-var-auto-filled' : ''}">
          <label class="awt-pm-var-label">
            <code>{{${esc(v)}}}</code>
            ${badgeHtml}
            ${clearBtnHtml}
          </label>
          <textarea class="awt-pm-var-input ${isAutoFilled ? 'awt-pm-auto-input' : ''}" data-var="${esc(v)}" data-auto-filled="${isAutoFilled}" rows="2" placeholder="Enter value for ${esc(v)}...">${isAutoFilled ? esc(autoValue) : ''}</textarea>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      ${contextBanner}
      <div class="awt-pm-var-groups">
        ${varGroupsHtml}
      </div>
      <div class="awt-pm-preview">
        <div class="awt-pm-preview-label">Preview</div>
        <div class="awt-pm-preview-content" id="awt-pm-var-preview"></div>
      </div>
      <label class="awt-pm-checkbox" style="margin-top: 12px;">
        <input type="checkbox" id="awt-pm-autosend">
        Auto-send after insert
      </label>
    `;

    footer.innerHTML = `
      <button class="awt-pm-footer-btn" data-action="close-modal">Cancel</button>
      <button class="awt-pm-footer-btn primary" id="awt-pm-insert-btn">Insert</button>
    `;

    // Handle "Clear All" button for auto-fills
    const clearAllBtn = document.getElementById("awt-pm-clear-all-auto");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        body.querySelectorAll("[data-auto-filled='true']").forEach(input => {
          input.value = '';
          input.dataset.autoFilled = 'false';
          input.classList.remove('awt-pm-auto-input');
          const group = input.closest('.awt-pm-var-group');
          if (group) {
            group.classList.remove('awt-pm-var-auto-filled');
            const badge = group.querySelector('.awt-pm-auto-badge');
            const clearBtn = group.querySelector('.awt-pm-var-clear');
            if (badge) badge.remove();
            if (clearBtn) clearBtn.remove();
          }
        });
        // Remove banner
        const banner = body.querySelector('.awt-pm-context-banner');
        if (banner) banner.remove();
        updatePreview();
        this.api.notify("Auto-fills cleared", "info");
      });
    }

    // Handle individual clear buttons
    body.querySelectorAll(".awt-pm-var-clear").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const varName = btn.dataset.clearVar;
        const input = body.querySelector(`[data-var="${varName}"]`);
        if (input) {
          input.value = '';
          input.dataset.autoFilled = 'false';
          input.classList.remove('awt-pm-auto-input');
          const group = input.closest('.awt-pm-var-group');
          if (group) {
            group.classList.remove('awt-pm-var-auto-filled');
            const badge = group.querySelector('.awt-pm-auto-badge');
            if (badge) badge.remove();
          }
          btn.remove();
          updatePreview();
        }
      });
    });

    // Live preview
    const updatePreview = () => {
      let content = prompt.type === "layered"
        ? prompt.layers?.map(l => l.content).join("\n\n")
        : prompt.content;

      body.querySelectorAll("[data-var]").forEach(input => {
        const varName = input.dataset.var;
        const value = input.value || `{{${varName}}}`;
        content = content.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), value);
      });

      document.getElementById("awt-pm-var-preview").textContent = content;
    };

    body.querySelectorAll("[data-var]").forEach(input => {
      input.addEventListener("input", updatePreview);
    });

    updatePreview();

    // Insert button
    document.getElementById("awt-pm-insert-btn").addEventListener("click", () => {
      let content = prompt.type === "layered"
        ? prompt.layers?.map(l => l.content).join("\n\n")
        : prompt.content;

      body.querySelectorAll("[data-var]").forEach(input => {
        const varName = input.dataset.var;
        const value = input.value;
        content = content.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), value);
      });

      const autoSend = document.getElementById("awt-pm-autosend")?.checked || false;
      this.insertPrompt(content, autoSend);
      this.closeModal();
    });

    this.openModal();

    // Show notification about auto-fills
    if (autoFilledCount > 0) {
      this.api.notify(`✨ ${autoFilledCount} variable${autoFilledCount > 1 ? 's' : ''} auto-filled from conversation!`, "success");
    }

    // Focus first NON-auto-filled input, or first input if all are filled
    setTimeout(() => {
      const firstEmpty = body.querySelector("[data-var][data-auto-filled='false']") || body.querySelector("[data-var]");
      firstEmpty?.focus();
    }, 100);
  }

  insertPrompt(content, autoSend = false) {
    const success = insertIntoInput(content, autoSend);
    if (success) {
      this.api.notify("Prompt inserted!", "success");
      this.closePanel();
    } else {
      this.api.notify("Could not find input field", "error");
    }
  }

  showCreateModal() {
    const title = document.getElementById("awt-pm-modal-title");
    const body = document.getElementById("awt-pm-modal-body");
    const footer = document.getElementById("awt-pm-modal-footer");

    title.textContent = "Create Prompt";

    body.innerHTML = `
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Name</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-new-name" placeholder="My Custom Prompt">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Category</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-new-category" placeholder="Writing, Coding, Business...">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Tags (comma-separated)</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-new-tags" placeholder="improve, edit, format">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Content</label>
        <textarea class="awt-pm-var-input" id="awt-pm-new-content" rows="6" placeholder="Your prompt content here. Use {{variable}} for variables."></textarea>
      </div>
      <div style="font-size: 11px; color: var(--awt-pm-text-muted); margin-top: 8px;">
        Tip: Use <code style="background: var(--awt-pm-card-bg); padding: 2px 4px; border-radius: 3px;">{{variableName}}</code> syntax for variables that will be filled when using the prompt.
      </div>
    `;

    footer.innerHTML = `
      <button class="awt-pm-footer-btn" data-action="close-modal">Cancel</button>
      <button class="awt-pm-footer-btn primary" id="awt-pm-save-new">Save</button>
    `;

    document.getElementById("awt-pm-save-new").addEventListener("click", async () => {
      const name = document.getElementById("awt-pm-new-name").value.trim();
      const category = document.getElementById("awt-pm-new-category").value.trim();
      const tagsRaw = document.getElementById("awt-pm-new-tags").value;
      const content = document.getElementById("awt-pm-new-content").value;

      if (!name) {
        this.api.notify("Name is required", "warning");
        return;
      }

      if (!content) {
        this.api.notify("Content is required", "warning");
        return;
      }

      // Extract variables
      const matches = content.match(/\{\{(\w+)\}\}/g) || [];
      const variables = [...new Set(matches.map(m => m.slice(2, -2)))];

      const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);

      const newPrompt = {
        id: uuid(),
        name,
        category: category || "Custom",
        tags,
        content,
        variables,
        type: "single",
        createdAt: Date.now()
      };

      this.prompts.push(newPrompt);
      await setPromptStore({ prompts: this.prompts, version: 1 });

      this.renderCategories();
      this.renderContent();
      this.closeModal();
      this.api.notify("Prompt created!", "success");
    });

    this.openModal();
  }

  showBuilderModal() {
    const title = document.getElementById("awt-pm-modal-title");
    const body = document.getElementById("awt-pm-modal-body");
    const footer = document.getElementById("awt-pm-modal-footer");

    title.textContent = "Layered Prompt Builder";

    const layers = [
      { id: uuid(), content: "You are an expert...", order: 0 },
      { id: uuid(), content: "Given the following context:", order: 1 },
      { id: uuid(), content: "{{input}}", order: 2 },
      { id: uuid(), content: "Please provide a detailed response.", order: 3 }
    ];

    const renderLayers = () => {
      return layers.sort((a, b) => a.order - b.order).map((l, i) => `
        <div class="awt-pm-layer" data-layer-id="${l.id}" draggable="true">
          <div class="awt-pm-layer-handle">⋮⋮</div>
          <div class="awt-pm-layer-content" contenteditable="true">${esc(l.content)}</div>
          <div class="awt-pm-layer-actions">
            <button class="awt-pm-layer-btn" data-layer-action="delete" title="Delete">✕</button>
          </div>
        </div>
      `).join("");
    };

    body.innerHTML = `
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Prompt Name</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-builder-name" placeholder="My Layered Prompt">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Category</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-builder-category" placeholder="Layered">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Layers (drag to reorder)</label>
        <div class="awt-pm-layers" id="awt-pm-layers-container">
          ${renderLayers()}
        </div>
        <button class="awt-pm-footer-btn" style="margin-top: 8px;" id="awt-pm-add-layer">+ Add Layer</button>
      </div>
    `;

    footer.innerHTML = `
      <button class="awt-pm-footer-btn" data-action="close-modal">Cancel</button>
      <button class="awt-pm-footer-btn primary" id="awt-pm-save-layered">Save Prompt</button>
    `;

    const layersContainer = document.getElementById("awt-pm-layers-container");

    // Drag and drop
    let draggedEl = null;

    layersContainer.addEventListener("dragstart", (e) => {
      if (e.target.classList.contains("awt-pm-layer")) {
        draggedEl = e.target;
        e.target.classList.add("dragging");
      }
    });

    layersContainer.addEventListener("dragend", (e) => {
      if (e.target.classList.contains("awt-pm-layer")) {
        e.target.classList.remove("dragging");
        draggedEl = null;

        // Update order
        const layerEls = layersContainer.querySelectorAll(".awt-pm-layer");
        layerEls.forEach((el, i) => {
          const layer = layers.find(l => l.id === el.dataset.layerId);
          if (layer) layer.order = i;
        });
      }
    });

    layersContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      const afterElement = getDragAfterElement(layersContainer, e.clientY);
      if (afterElement == null) {
        layersContainer.appendChild(draggedEl);
      } else {
        layersContainer.insertBefore(draggedEl, afterElement);
      }
    });

    function getDragAfterElement(container, y) {
      const elements = [...container.querySelectorAll(".awt-pm-layer:not(.dragging)")];
      return elements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: child };
        }
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // Delete layer
    layersContainer.addEventListener("click", (e) => {
      if (e.target.dataset.layerAction === "delete") {
        const layerEl = e.target.closest(".awt-pm-layer");
        const id = layerEl.dataset.layerId;
        const idx = layers.findIndex(l => l.id === id);
        if (idx >= 0) {
          layers.splice(idx, 1);
          layerEl.remove();
        }
      }
    });

    // Update layer content on blur
    layersContainer.addEventListener("blur", (e) => {
      if (e.target.classList.contains("awt-pm-layer-content")) {
        const layerEl = e.target.closest(".awt-pm-layer");
        const id = layerEl.dataset.layerId;
        const layer = layers.find(l => l.id === id);
        if (layer) layer.content = e.target.textContent;
      }
    }, true);

    // Add layer
    document.getElementById("awt-pm-add-layer").addEventListener("click", () => {
      const newLayer = { id: uuid(), content: "New layer...", order: layers.length };
      layers.push(newLayer);

      const layerHtml = `
        <div class="awt-pm-layer" data-layer-id="${newLayer.id}" draggable="true">
          <div class="awt-pm-layer-handle">⋮⋮</div>
          <div class="awt-pm-layer-content" contenteditable="true">${esc(newLayer.content)}</div>
          <div class="awt-pm-layer-actions">
            <button class="awt-pm-layer-btn" data-layer-action="delete" title="Delete">✕</button>
          </div>
        </div>
      `;
      layersContainer.insertAdjacentHTML("beforeend", layerHtml);
    });

    // Save
    document.getElementById("awt-pm-save-layered").addEventListener("click", async () => {
      const name = document.getElementById("awt-pm-builder-name").value.trim();
      const category = document.getElementById("awt-pm-builder-category").value.trim() || "Layered";

      if (!name) {
        this.api.notify("Name is required", "warning");
        return;
      }

      // Get current layer contents
      layersContainer.querySelectorAll(".awt-pm-layer").forEach((el, i) => {
        const id = el.dataset.layerId;
        const layer = layers.find(l => l.id === id);
        if (layer) {
          layer.content = el.querySelector(".awt-pm-layer-content").textContent;
          layer.order = i;
        }
      });

      // Extract variables
      const allContent = layers.map(l => l.content).join(" ");
      const matches = allContent.match(/\{\{(\w+)\}\}/g) || [];
      const variables = [...new Set(matches.map(m => m.slice(2, -2)))];

      const newPrompt = {
        id: uuid(),
        name,
        category,
        tags: ["layered"],
        type: "layered",
        layers: layers.sort((a, b) => a.order - b.order),
        variables,
        createdAt: Date.now()
      };

      this.prompts.push(newPrompt);
      await setPromptStore({ prompts: this.prompts, version: 1 });

      this.renderCategories();
      this.renderContent();
      this.closeModal();
      this.api.notify("Layered prompt created!", "success");
    });

    this.openModal();
  }

  showWorkflowModal() {
    const title = document.getElementById("awt-pm-modal-title");
    const body = document.getElementById("awt-pm-modal-body");
    const footer = document.getElementById("awt-pm-modal-footer");

    title.textContent = "Create Workflow Chain";

    body.innerHTML = `
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Workflow Name</label>
        <input type="text" class="awt-pm-var-input" id="awt-pm-workflow-name" placeholder="My Workflow">
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Select Prompts (in order)</label>
        <div id="awt-pm-workflow-steps"></div>
      </div>
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Add Step</label>
        <select class="awt-pm-var-input" id="awt-pm-workflow-select" style="height: 36px;">
          <option value="">Select a prompt...</option>
          ${this.prompts.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}
        </select>
        <button class="awt-pm-footer-btn" style="margin-top: 8px;" id="awt-pm-add-step">+ Add Step</button>
      </div>
    `;

    footer.innerHTML = `
      <button class="awt-pm-footer-btn" data-action="close-modal">Cancel</button>
      <button class="awt-pm-footer-btn primary" id="awt-pm-save-workflow">Save Workflow</button>
    `;

    const steps = [];
    const stepsContainer = document.getElementById("awt-pm-workflow-steps");

    const renderSteps = () => {
      if (steps.length === 0) {
        stepsContainer.innerHTML = '<div style="color: var(--awt-pm-text-muted); font-size: 11px;">No steps added yet</div>';
        return;
      }

      stepsContainer.innerHTML = steps.map((s, i) => {
        const prompt = this.prompts.find(p => p.id === s.promptId);
        return `
          <div class="awt-pm-workflow-step">
            <div class="awt-pm-workflow-num">${i + 1}</div>
            <div class="awt-pm-workflow-name">${esc(prompt?.name || "Unknown")}</div>
            <button class="awt-pm-layer-btn" data-remove-step="${i}">✕</button>
          </div>
        `;
      }).join("");

      stepsContainer.querySelectorAll("[data-remove-step]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.removeStep);
          steps.splice(idx, 1);
          renderSteps();
        });
      });
    };

    renderSteps();

    document.getElementById("awt-pm-add-step").addEventListener("click", () => {
      const select = document.getElementById("awt-pm-workflow-select");
      const promptId = select.value;
      if (!promptId) return;

      steps.push({ promptId, order: steps.length });
      select.value = "";
      renderSteps();
    });

    document.getElementById("awt-pm-save-workflow").addEventListener("click", async () => {
      const name = document.getElementById("awt-pm-workflow-name").value.trim();

      if (!name) {
        this.api.notify("Name is required", "warning");
        return;
      }

      if (steps.length === 0) {
        this.api.notify("Add at least one step", "warning");
        return;
      }

      const workflow = {
        id: uuid(),
        name,
        steps,
        createdAt: Date.now()
      };

      this.workflows.push(workflow);
      await setWorkflows(this.workflows);

      this.renderContent();
      this.closeModal();
      this.api.notify("Workflow created!", "success");
    });

    this.openModal();
  }

  async runWorkflow(workflow) {
    this.closePanel();
    this.api.notify(`Starting workflow: ${workflow.name}`, "info");

    // Run each step sequentially
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const prompt = this.prompts.find(p => p.id === step.promptId);

      if (!prompt) continue;

      // Wait for user to manually proceed between steps
      this.api.notify(`Step ${i + 1}/${workflow.steps.length}: ${prompt.name}`, "info");

      await this.usePrompt(prompt);

      // In MVP, just insert the first prompt
      // Full workflow would require waiting for responses
      break;
    }
  }

  showImportModal() {
    const title = document.getElementById("awt-pm-modal-title");
    const body = document.getElementById("awt-pm-modal-body");
    const footer = document.getElementById("awt-pm-modal-footer");

    title.textContent = "Import Prompts";

    body.innerHTML = `
      <div class="awt-pm-var-group">
        <label class="awt-pm-var-label">Paste JSON or drop a file</label>
        <textarea class="awt-pm-var-input" id="awt-pm-import-data" rows="10" placeholder='[{"name": "My Prompt", "content": "..."}]'></textarea>
      </div>
      <div style="font-size: 11px; color: var(--awt-pm-text-muted);">
        Expected format: Array of prompt objects with name, content, category, tags.
      </div>
    `;

    footer.innerHTML = `
      <button class="awt-pm-footer-btn" data-action="close-modal">Cancel</button>
      <button class="awt-pm-footer-btn primary" id="awt-pm-do-import">Import</button>
    `;

    document.getElementById("awt-pm-do-import").addEventListener("click", async () => {
      const raw = document.getElementById("awt-pm-import-data").value.trim();

      try {
        const data = JSON.parse(raw);
        const prompts = Array.isArray(data) ? data : [data];

        let imported = 0;
        for (const p of prompts) {
          if (!p.name || !p.content) continue;

          this.prompts.push({
            id: p.id || uuid(),
            name: p.name,
            category: p.category || "Imported",
            tags: p.tags || [],
            content: p.content,
            variables: p.variables || [],
            type: p.type || "single",
            layers: p.layers,
            createdAt: Date.now()
          });
          imported++;
        }

        await setPromptStore({ prompts: this.prompts, version: 1 });

        this.renderCategories();
        this.renderContent();
        this.closeModal();
        this.api.notify(`Imported ${imported} prompt(s)!`, "success");
      } catch (e) {
        this.api.notify("Invalid JSON format", "error");
      }
    });

    this.openModal();
  }

  async exportPrompts() {
    const data = JSON.stringify(this.prompts, null, 2);
    const filename = `prompts-export-${Date.now()}.json`;

    await this.api.downloadText(filename, data, "application/json");
    this.api.notify("Prompts exported!", "success");
  }

  openModal() {
    this.modalOverlay.classList.add("open");
  }

  closeModal() {
    this.modalOverlay.classList.remove("open");
  }

  destroy() {
    this.toggle?.remove();
    this.panel?.remove();
    this.modalOverlay?.remove();
    document.documentElement.style.removeProperty("--awt-right-inset");
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let instance = null;

export async function run({ api, context }) {
  if (instance) {
    instance.destroy();
    instance = null;
  }

  instance = new PromptManager(api);
  await instance.init();

  return () => {
    instance?.destroy();
    instance = null;
  };
}

export async function onAction({ api, action, payload }) {
  if (action === "toggle") {
    instance?.togglePanel();
    return { ok: true };
  }

  if (action === "open") {
    instance?.openPanel();
    return { ok: true };
  }

  if (action === "close") {
    instance?.closePanel();
    return { ok: true };
  }

  return { ok: false, error: "unknown_action" };
}
