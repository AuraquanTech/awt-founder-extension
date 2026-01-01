/**
 * Memory Bridge - Integration Layer
 * ===================================
 * Bridges the Memory Graph system with the existing Prompt Manager
 * and Context Extractor. Provides seamless migration path.
 *
 * This module:
 * - Watches conversation changes and feeds the memory system
 * - Provides backward-compatible API for existing code
 * - Handles DOM observation for auto-extraction
 * - Manages context injection lifecycle
 */

import { memory, NodeType, ContextStrategy } from './index.js';

// ============================================================================
// DOM OBSERVER - Watches conversations for changes
// ============================================================================

class ConversationObserver {
  constructor(onNewContent) {
    this.onNewContent = onNewContent;
    this.observer = null;
    this.lastContent = '';
    this.debounceTimer = null;
    this.DEBOUNCE_MS = 1000;
  }

  start() {
    if (this.observer) return;

    // Find conversation container based on platform
    const container = this._findContainer();
    if (!container) {
      console.log('[ConversationObserver] Container not found, retrying...');
      setTimeout(() => this.start(), 2000);
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      // Debounce rapid changes
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const content = this._extractContent();
        if (content !== this.lastContent && content.length > this.lastContent.length) {
          const newContent = content.slice(this.lastContent.length);
          if (newContent.trim().length > 50) {
            this.onNewContent(newContent);
          }
          this.lastContent = content;
        }
      }, this.DEBOUNCE_MS);
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Initial extraction
    this.lastContent = this._extractContent();
    if (this.lastContent.length > 50) {
      this.onNewContent(this.lastContent);
    }

    console.log('[ConversationObserver] Started');
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  _findContainer() {
    const selectors = [
      // ChatGPT
      'main',
      '[role="main"]',
      // Claude
      '.conversation-container',
      '[data-testid="conversation"]',
      // Generic
      '.chat-container',
      '.messages-container',
      '#conversation',
      'article'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    return document.body;
  }

  _extractContent() {
    const selectors = [
      // ChatGPT
      '[data-message-author-role] .markdown',
      '[data-message-author-role] .whitespace-pre-wrap',
      // Claude
      '.font-claude-message',
      '.prose',
      // Generic
      '.message-content',
      '.response-content',
      '.markdown-body'
    ];

    let text = '';
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          text += el.textContent + '\n\n';
        });
        if (text.length > 100) break;
      } catch (e) {}
    }

    return text;
  }
}

// ============================================================================
// MEMORY BRIDGE CLASS
// ============================================================================

class MemoryBridge {
  constructor() {
    this.observer = null;
    this.isActive = false;
    this.extractionCount = 0;

    // Backward compatibility with old contextExtractor API
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 5000;
  }

  /**
   * Initialize the bridge (async)
   */
  async init() {
    if (this.isActive) return;

    // Initialize memory system
    await memory.init();

    // Start conversation observer
    this.observer = new ConversationObserver((content) => {
      this._onNewContent(content);
    });

    if (typeof document !== 'undefined') {
      // Start observing after DOM is ready
      if (document.readyState === 'complete') {
        this.observer.start();
      } else {
        window.addEventListener('load', () => this.observer.start());
      }
    }

    this.isActive = true;
    console.log('[MemoryBridge] Initialized');

    return this;
  }

  /**
   * Shutdown the bridge
   */
  shutdown() {
    if (this.observer) {
      this.observer.stop();
    }
    this.isActive = false;
  }

  /**
   * Handle new conversation content
   */
  _onNewContent(content) {
    const extraction = memory.learn(content);
    if (extraction) {
      this.extractionCount++;
      console.log(`[MemoryBridge] Extraction #${this.extractionCount}: ${extraction.nodes.length} entities`);
    }
  }

  // ============================================================================
  // BACKWARD COMPATIBLE API (matches old contextExtractor)
  // ============================================================================

  /**
   * Extract context from current conversation
   * @returns {Object} Context object matching old API
   */
  extract() {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cache;
    }

    // Get content from DOM
    const text = this._getConversationText();
    if (!text || text.length < 20) return null;

    // Learn from text
    memory.learn(text);

    // Generate context in old format
    const minimal = memory.getMinimalContext();
    const metadata = minimal.metadata || {};

    // Build backward-compatible context object
    const context = {
      // Primary values for auto-fill
      language: metadata.language || null,
      languageConfidence: 0.8,
      framework: metadata.framework || null,
      frameworkConfidence: 0.8,

      // Code
      code: this._getLastCodeBlock(text),
      codeLanguage: metadata.language || null,

      // Errors
      error: metadata.error || null,
      errorContext: null,

      // Topics & Goals
      topic: metadata.topics?.[0] || null,
      goal: metadata.goal || null,

      // Entities
      files: [],
      functions: [],
      urls: [],
      classes: [],

      // All detected (query for full lists)
      allLanguages: memory.query({ type: NodeType.LANGUAGE, limit: 3 })
        .map(n => ({ language: n.content, confidence: n.confidence || 0.8 })),
      allFrameworks: memory.query({ type: NodeType.FRAMEWORK, limit: 3 })
        .map(n => ({ framework: n.content, language: n.metadata?.language, confidence: n.confidence || 0.8 })),
      allErrors: memory.query({ type: NodeType.ERROR, withinHours: 4, limit: 3 })
        .map(n => ({ type: n.metadata?.errorType, message: n.content, context: n.metadata?.context })),
      allTopics: memory.query({ type: NodeType.TOPIC, limit: 3 })
        .map(n => ({ topic: n.content, confidence: n.confidence || 0.7 })),
      allGoals: memory.query({ type: NodeType.GOAL, limit: 3 })
        .map(n => n.content),
      allCodeBlocks: [],

      // Metadata
      extractedAt: now,
      conversationLength: text.length
    };

    // Fill entity arrays
    context.files = memory.query({ type: NodeType.FILE, limit: 10 }).map(n => n.content);
    context.functions = memory.query({ type: NodeType.FUNCTION, limit: 10 }).map(n => n.content);
    context.urls = memory.query({ type: NodeType.URL, limit: 10 }).map(n => n.content);
    context.classes = memory.query({ type: NodeType.CLASS, limit: 10 }).map(n => n.content);

    this.cache = context;
    this.cacheTime = now;

    return context;
  }

  /**
   * Map variables to context values (old API)
   */
  mapVariablesToContext(variables, context) {
    if (!context) {
      context = this.extract();
    }
    if (!context) return {};

    // Use new memory system for mapping
    return memory.mapVariables(variables);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Get conversation text from DOM
   */
  _getConversationText() {
    if (this.observer) {
      return this.observer._extractContent();
    }

    const selectors = [
      '[data-message-author-role] .markdown',
      '[data-message-author-role] .whitespace-pre-wrap',
      '.font-claude-message',
      '.prose',
      '.markdown-body',
      '[class*="message"]',
      '[class*="Message"]'
    ];

    let text = '';
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          text += el.textContent + '\n\n';
        });
        if (text.length > 100) break;
      } catch (e) {}
    }
    return text;
  }

  /**
   * Extract last code block from text
   */
  _getLastCodeBlock(text) {
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let lastBlock = null;
    let match;
    while ((match = regex.exec(text)) !== null) {
      lastBlock = match[2].trim();
    }
    return lastBlock;
  }

  // ============================================================================
  // NEW ENHANCED API
  // ============================================================================

  /**
   * Get rich context for injection
   */
  getContext(options = {}) {
    return memory.getContext(options);
  }

  /**
   * Get context formatted for system prompt
   */
  getSystemContext() {
    return memory.getContext({
      strategy: ContextStrategy.SYSTEM
    });
  }

  /**
   * Get debug context for error fixing
   */
  getDebugContext() {
    return memory.getDebugContext();
  }

  /**
   * Get cross-platform context
   */
  getCrossPlatformContext() {
    return memory.getCrossPlatformContext();
  }

  /**
   * Start a new work session
   */
  startSession(metadata = {}) {
    return memory.startSession(metadata);
  }

  /**
   * End current session
   */
  endSession() {
    return memory.endSession();
  }

  /**
   * Get current session info
   */
  get currentSession() {
    return memory.currentSession;
  }

  /**
   * Query the memory graph
   */
  query(criteria) {
    return memory.query(criteria);
  }

  /**
   * Get statistics
   */
  async getStats() {
    return memory.getStats();
  }

  /**
   * Export memory data
   */
  async export() {
    return memory.exportJSON();
  }

  /**
   * Import memory data
   */
  async import(jsonString, merge = false) {
    return memory.importJSON(jsonString, merge);
  }

  /**
   * Clear all memory
   */
  async clear() {
    return memory.clear();
  }

  /**
   * Run maintenance
   */
  async maintenance() {
    return memory.maintenance();
  }
}

// ============================================================================
// SINGLETON & BACKWARD COMPAT EXPORTS
// ============================================================================

// Create singleton instance
export const memoryBridge = new MemoryBridge();

// Backward compatible export matching old contextExtractor
export const contextExtractor = {
  extract: () => memoryBridge.extract(),
  mapVariablesToContext: (vars, ctx) => memoryBridge.mapVariablesToContext(vars, ctx),
  clearCache: () => memoryBridge.clearCache(),
  getConversationText: () => memoryBridge._getConversationText(),

  // Enhanced methods
  init: () => memoryBridge.init(),
  getContext: (opts) => memoryBridge.getContext(opts),
  getSystemContext: () => memoryBridge.getSystemContext(),
  getDebugContext: () => memoryBridge.getDebugContext(),
  query: (criteria) => memoryBridge.query(criteria),
  getStats: () => memoryBridge.getStats()
};

// Default export
export default memoryBridge;
