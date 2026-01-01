/**
 * Memory System - Unified API
 * ============================
 * Main entry point for the memory graph architecture.
 * Provides a unified interface for all memory operations.
 *
 * Usage:
 *   import { memory } from './memory/index.js';
 *
 *   // Initialize
 *   await memory.init();
 *
 *   // Extract context from text
 *   memory.learn(conversationText);
 *
 *   // Get context for injection
 *   const context = memory.getContext();
 *
 *   // Query the graph
 *   const errors = memory.query({ type: 'error', withinHours: 4 });
 */

import { MemoryGraph, memoryGraph, NodeType, EdgeType, MemoryNode, MemoryEdge, WorkSession } from './memory-graph.js';
import { memoryStore } from './memory-store.js';
import { MemoryExtractor, memoryExtractor } from './memory-extractor.js';
import { MemoryContext, memoryContext, ContextStrategy } from './memory-context.js';
import { memorySync } from './memory-sync.js';

// ============================================================================
// UNIFIED MEMORY API
// ============================================================================

class Memory {
  constructor() {
    this.graph = memoryGraph;
    this.store = memoryStore;
    this.extractor = memoryExtractor;
    this.context = memoryContext;
    this.sync = memorySync;

    this.isInitialized = false;
    this.platform = null;

    // Bind methods
    this.learn = this.learn.bind(this);
    this.getContext = this.getContext.bind(this);
    this.query = this.query.bind(this);
  }

  /**
   * Initialize the memory system
   */
  async init(options = {}) {
    if (this.isInitialized) return;

    const { platform = null, autoSync = true, loadFromStore = true } = options;

    this.platform = platform || this._detectPlatform();

    try {
      // Initialize storage
      await this.store.init();

      // Load persisted graph
      if (loadFromStore) {
        const loaded = await this.store.loadGraph();
        if (loaded && loaded.nodes.size > 0) {
          // Merge loaded graph with singleton
          this._mergeGraph(loaded);
          console.log(`[Memory] Loaded ${loaded.nodes.size} nodes from storage`);
        }
      }

      // Initialize sync
      if (autoSync) {
        await this.sync.init(this.graph);
      }

      // Start a new session
      this.graph.startSession({
        platform: this.platform,
        url: typeof window !== 'undefined' ? window.location.href : null
      });

      this.isInitialized = true;
      console.log(`[Memory] Initialized on platform: ${this.platform}`);

      return this;
    } catch (error) {
      console.error('[Memory] Initialization failed:', error);
      this.isInitialized = true; // Continue without persistence
      return this;
    }
  }

  /**
   * Learn from text - extract entities and populate graph
   */
  learn(text, metadata = {}) {
    if (!text || text.length < 20) return null;

    const extraction = this.extractor.extract(text, {
      ...metadata,
      platform: this.platform
    });

    // Broadcast changes for sync
    if (extraction && this.sync.isInitialized) {
      for (const node of extraction.nodes) {
        this.sync.broadcastNodeAdded(node);
      }
      for (const edge of extraction.edges) {
        this.sync.broadcastEdgeAdded(edge);
      }
    }

    return extraction;
  }

  /**
   * Get context for injection
   */
  getContext(options = {}) {
    return this.context.generate({
      platform: this.platform,
      ...options
    });
  }

  /**
   * Get minimal context (for variable auto-fill)
   */
  getMinimalContext() {
    return this.context.generate({
      strategy: ContextStrategy.MINIMAL,
      platform: this.platform
    });
  }

  /**
   * Map context to template variables
   */
  mapVariables(variableNames) {
    return this.context.mapToVariables(variableNames);
  }

  /**
   * Query the memory graph
   */
  query(criteria = {}) {
    return this.graph.query(criteria);
  }

  /**
   * Add a node directly
   */
  addNode(type, content, metadata = {}) {
    const node = this.graph.addNode(type, content, {
      ...metadata,
      platform: this.platform
    });

    if (this.sync.isInitialized) {
      this.sync.broadcastNodeAdded(node);
    }

    return node;
  }

  /**
   * Add a relationship
   */
  addEdge(sourceId, targetId, type, metadata = {}) {
    const edge = this.graph.addEdge(sourceId, targetId, type, metadata);

    if (edge && this.sync.isInitialized) {
      this.sync.broadcastEdgeAdded(edge);
    }

    return edge;
  }

  /**
   * Remove a node
   */
  removeNode(nodeId) {
    const success = this.graph.removeNode(nodeId);

    if (success && this.sync.isInitialized) {
      this.sync.broadcastNodeRemoved(nodeId);
    }

    return success;
  }

  /**
   * Start a new work session
   */
  startSession(metadata = {}) {
    // End current session first
    if (this.graph.activeSession) {
      this.endSession();
    }

    const session = this.graph.startSession({
      platform: this.platform,
      url: typeof window !== 'undefined' ? window.location.href : null,
      ...metadata
    });

    if (this.sync.isInitialized) {
      this.sync.broadcastSessionStarted(session);
    }

    return session;
  }

  /**
   * End the current session
   */
  endSession() {
    const session = this.graph.activeSession;
    if (session) {
      this.graph.endSession();

      if (this.sync.isInitialized) {
        this.sync.broadcastSessionEnded(session.id);
      }
    }

    return session;
  }

  /**
   * Get current session
   */
  get currentSession() {
    return this.graph.activeSession;
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit = 10) {
    return this.graph.getRecentSessions(limit);
  }

  /**
   * Save to persistent storage
   */
  async save() {
    try {
      await this.store.saveGraph(this.graph);
      return true;
    } catch (error) {
      console.error('[Memory] Save failed:', error);
      return false;
    }
  }

  /**
   * Export graph to JSON
   */
  async exportJSON() {
    return this.store.exportToJSON();
  }

  /**
   * Import graph from JSON
   */
  async importJSON(jsonString, merge = false) {
    const imported = await this.store.importFromJSON(jsonString, merge);

    if (imported) {
      this._mergeGraph(imported);
    }

    return imported;
  }

  /**
   * Clear all memory
   */
  async clear() {
    this.graph.nodes.clear();
    this.graph.edges.clear();
    this.graph.sessions.clear();
    this.graph.nodesByType.clear();
    this.graph.edgesByType.clear();
    this.graph.contentIndex.clear();
    this.graph.outgoing.clear();
    this.graph.incoming.clear();
    this.graph.activeSession = null;

    await this.store.clear();

    return true;
  }

  /**
   * Run maintenance (prune old data)
   */
  async maintenance() {
    // Apply decay
    this.graph.applyDecay();

    // Prune low-relevance nodes
    const pruned = this.graph.prune();

    // Compact storage
    const compacted = await this.store.compact();

    return {
      decayApplied: true,
      nodesPruned: pruned,
      storageCompacted: compacted
    };
  }

  /**
   * Get system statistics
   */
  async getStats() {
    const graphStats = this.graph.getStats();
    const storageStats = await this.store.getStorageStats();
    const syncStatus = this.sync.getStatus();
    const extractorStats = this.extractor.getStats();

    return {
      graph: graphStats,
      storage: storageStats,
      sync: syncStatus,
      extractor: extractorStats,
      platform: this.platform,
      isInitialized: this.isInitialized
    };
  }

  // ============================================================================
  // CONVENIENCE METHODS
  // ============================================================================

  /**
   * Get debug context for errors
   */
  getDebugContext() {
    return this.context.generateDebugContext();
  }

  /**
   * Get context for continuing a session
   */
  getContinuationContext(sessionId) {
    return this.context.generateSessionContinuationContext(sessionId);
  }

  /**
   * Get cross-platform context
   */
  getCrossPlatformContext() {
    return this.context.generateCrossPlatformContext();
  }

  /**
   * Quick query: get primary language
   */
  getPrimaryLanguage() {
    const langs = this.query({
      type: NodeType.LANGUAGE,
      limit: 1
    });
    return langs[0]?.content || null;
  }

  /**
   * Quick query: get primary framework
   */
  getPrimaryFramework() {
    const fws = this.query({
      type: NodeType.FRAMEWORK,
      limit: 1
    });
    return fws[0]?.content || null;
  }

  /**
   * Quick query: get recent errors
   */
  getRecentErrors(limit = 5) {
    return this.query({
      type: NodeType.ERROR,
      withinHours: 24,
      limit
    });
  }

  /**
   * Quick query: get current goal
   */
  getCurrentGoal() {
    const goals = this.query({
      type: NodeType.GOAL,
      limit: 1
    });
    return goals[0]?.content || null;
  }

  // ============================================================================
  // INTERNAL METHODS
  // ============================================================================

  _detectPlatform() {
    if (typeof window === 'undefined') return 'unknown';

    const host = window.location?.hostname || '';
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('perplexity.ai')) return 'perplexity';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('poe.com')) return 'poe';
    if (host.includes('copilot.microsoft.com')) return 'copilot';
    if (host.includes('bing.com')) return 'bing';
    if (host.includes('you.com')) return 'you';
    if (host.includes('huggingface.co')) return 'huggingface';
    if (host.includes('grok.x.ai') || host.includes('x.com')) return 'grok';
    return 'unknown';
  }

  _mergeGraph(sourceGraph) {
    // Merge nodes
    for (const [id, node] of sourceGraph.nodes) {
      if (!this.graph.nodes.has(id)) {
        this.graph.nodes.set(id, node);

        // Update indexes
        const hash = this.graph._hashContent(node.type, node.content);
        this.graph.contentIndex.set(hash, id);

        if (!this.graph.nodesByType.has(node.type)) {
          this.graph.nodesByType.set(node.type, new Set());
        }
        this.graph.nodesByType.get(node.type).add(id);

        this.graph.outgoing.set(id, new Set());
        this.graph.incoming.set(id, new Set());
      }
    }

    // Merge edges
    for (const [id, edge] of sourceGraph.edges) {
      if (!this.graph.edges.has(id)) {
        this.graph.edges.set(id, edge);

        this.graph.outgoing.get(edge.sourceId)?.add(id);
        this.graph.incoming.get(edge.targetId)?.add(id);

        if (edge.bidirectional) {
          this.graph.outgoing.get(edge.targetId)?.add(id);
          this.graph.incoming.get(edge.sourceId)?.add(id);
        }

        if (!this.graph.edgesByType.has(edge.type)) {
          this.graph.edgesByType.set(edge.type, new Set());
        }
        this.graph.edgesByType.get(edge.type).add(id);
      }
    }

    // Merge sessions
    for (const [id, session] of sourceGraph.sessions) {
      if (!this.graph.sessions.has(id)) {
        this.graph.sessions.set(id, session);
      }
    }

    // Update stats
    this.graph.stats.totalNodes = this.graph.nodes.size;
    this.graph.stats.totalEdges = this.graph.edges.size;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Main memory instance
export const memory = new Memory();

// Re-export components for advanced usage
export {
  // Graph
  MemoryGraph,
  memoryGraph,
  NodeType,
  EdgeType,
  MemoryNode,
  MemoryEdge,
  WorkSession,

  // Store
  memoryStore,

  // Extractor
  MemoryExtractor,
  memoryExtractor,

  // Context
  MemoryContext,
  memoryContext,
  ContextStrategy,

  // Sync
  memorySync
};

// Default export
export default memory;
