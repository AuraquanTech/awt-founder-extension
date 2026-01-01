/**
 * Memory Store - IndexedDB Persistence Layer
 * ============================================
 * Persists the memory graph to IndexedDB for durability across
 * browser sessions. Handles migrations, transactions, and cleanup.
 *
 * Design:
 * - Separate object stores for nodes, edges, sessions
 * - Indexed for fast queries by type, platform, timestamp
 * - Automatic sync on changes
 * - Chunked export/import for large graphs
 */

import { MemoryGraph, MemoryNode, MemoryEdge, WorkSession } from './memory-graph.js';

const DB_NAME = 'awt_memory_graph';
const DB_VERSION = 1;

// Object store names
const STORES = {
  NODES: 'nodes',
  EDGES: 'edges',
  SESSIONS: 'sessions',
  META: 'meta'
};

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

class MemoryStore {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.pendingWrites = [];
    this.writeDebounceTimer = null;
    this.WRITE_DEBOUNCE_MS = 500;
  }

  /**
   * Initialize the database
   */
  async init() {
    if (this.isInitialized) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[MemoryStore] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        console.log('[MemoryStore] Database initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this._createStores(db);
      };
    });
  }

  _createStores(db) {
    // Nodes store
    if (!db.objectStoreNames.contains(STORES.NODES)) {
      const nodeStore = db.createObjectStore(STORES.NODES, { keyPath: 'id' });
      nodeStore.createIndex('type', 'type', { unique: false });
      nodeStore.createIndex('platform', 'platform', { unique: false });
      nodeStore.createIndex('sessionId', 'sessionId', { unique: false });
      nodeStore.createIndex('createdAt', 'metadata.createdAt', { unique: false });
      nodeStore.createIndex('type_platform', ['type', 'platform'], { unique: false });
    }

    // Edges store
    if (!db.objectStoreNames.contains(STORES.EDGES)) {
      const edgeStore = db.createObjectStore(STORES.EDGES, { keyPath: 'id' });
      edgeStore.createIndex('type', 'type', { unique: false });
      edgeStore.createIndex('sourceId', 'sourceId', { unique: false });
      edgeStore.createIndex('targetId', 'targetId', { unique: false });
      edgeStore.createIndex('source_target', ['sourceId', 'targetId'], { unique: false });
    }

    // Sessions store
    if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
      const sessionStore = db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
      sessionStore.createIndex('platform', 'platform', { unique: false });
      sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
      sessionStore.createIndex('isActive', 'isActive', { unique: false });
    }

    // Meta store for global state
    if (!db.objectStoreNames.contains(STORES.META)) {
      db.createObjectStore(STORES.META, { keyPath: 'key' });
    }

    console.log('[MemoryStore] Object stores created');
  }

  // ============================================================================
  // TRANSACTION HELPERS
  // ============================================================================

  _getStore(storeName, mode = 'readonly') {
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  _getMultiStore(storeNames, mode = 'readonly') {
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction(storeNames, mode);
    return storeNames.reduce((acc, name) => {
      acc[name] = tx.objectStore(name);
      return acc;
    }, {});
  }

  // ============================================================================
  // NODE OPERATIONS
  // ============================================================================

  async saveNode(node) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES, 'readwrite');
      const request = store.put(node.toJSON ? node.toJSON() : node);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveNodes(nodes) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES, 'readwrite');
      const tx = store.transaction;
      let completed = 0;

      for (const node of nodes) {
        const data = node.toJSON ? node.toJSON() : node;
        const request = store.put(data);
        request.onsuccess = () => {
          completed++;
          if (completed === nodes.length) resolve(completed);
        };
        request.onerror = () => reject(request.error);
      }

      if (nodes.length === 0) resolve(0);
    });
  }

  async getNode(nodeId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES);
      const request = store.get(nodeId);
      request.onsuccess = () => {
        if (request.result) {
          resolve(MemoryNode.fromJSON(request.result));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getNodesByType(type) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES);
      const index = store.index('type');
      const request = index.getAll(type);
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryNode.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getNodesByPlatform(platform) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES);
      const index = store.index('platform');
      const request = index.getAll(platform);
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryNode.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getRecentNodes(limit = 50, withinMs = 48 * 60 * 60 * 1000) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES);
      const index = store.index('createdAt');
      const cutoff = Date.now() - withinMs;

      const range = IDBKeyRange.lowerBound(cutoff);
      const request = index.openCursor(range, 'prev');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(MemoryNode.fromJSON(cursor.value));
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNode(nodeId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES, 'readwrite');
      const request = store.delete(nodeId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllNodes() {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryNode.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // EDGE OPERATIONS
  // ============================================================================

  async saveEdge(edge) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES, 'readwrite');
      const request = store.put(edge.toJSON ? edge.toJSON() : edge);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveEdges(edges) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES, 'readwrite');
      let completed = 0;

      for (const edge of edges) {
        const data = edge.toJSON ? edge.toJSON() : edge;
        const request = store.put(data);
        request.onsuccess = () => {
          completed++;
          if (completed === edges.length) resolve(completed);
        };
        request.onerror = () => reject(request.error);
      }

      if (edges.length === 0) resolve(0);
    });
  }

  async getEdge(edgeId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES);
      const request = store.get(edgeId);
      request.onsuccess = () => {
        if (request.result) {
          resolve(MemoryEdge.fromJSON(request.result));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getEdgesBySource(sourceId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES);
      const index = store.index('sourceId');
      const request = index.getAll(sourceId);
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryEdge.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getEdgesByTarget(targetId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES);
      const index = store.index('targetId');
      const request = index.getAll(targetId);
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryEdge.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteEdge(edgeId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES, 'readwrite');
      const request = store.delete(edgeId);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllEdges() {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.EDGES);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve((request.result || []).map(data => MemoryEdge.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  async saveSession(session) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.SESSIONS, 'readwrite');
      const request = store.put(session.toJSON ? session.toJSON() : session);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getSession(sessionId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.SESSIONS);
      const request = store.get(sessionId);
      request.onsuccess = () => {
        if (request.result) {
          resolve(WorkSession.fromJSON(request.result));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getRecentSessions(limit = 20) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.SESSIONS);
      const index = store.index('startedAt');
      const request = index.openCursor(null, 'prev');
      const results = [];

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          results.push(WorkSession.fromJSON(cursor.value));
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getActiveSessions() {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.SESSIONS);
      const index = store.index('isActive');
      const request = index.getAll(true);
      request.onsuccess = () => {
        resolve((request.result || []).map(data => WorkSession.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSessions() {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.SESSIONS);
      const request = store.getAll();
      request.onsuccess = () => {
        resolve((request.result || []).map(data => WorkSession.fromJSON(data)));
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // META OPERATIONS
  // ============================================================================

  async getMeta(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.META);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  }

  async setMeta(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.META, 'readwrite');
      const request = store.put({ key, value, updatedAt: Date.now() });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // FULL GRAPH OPERATIONS
  // ============================================================================

  /**
   * Save entire graph to IndexedDB
   */
  async saveGraph(graph) {
    await this.init();

    const nodes = Array.from(graph.nodes.values());
    const edges = Array.from(graph.edges.values());
    const sessions = Array.from(graph.sessions.values());

    await Promise.all([
      this.saveNodes(nodes),
      this.saveEdges(edges),
      ...sessions.map(s => this.saveSession(s))
    ]);

    await this.setMeta('stats', graph.stats);
    await this.setMeta('lastSaved', Date.now());

    console.log(`[MemoryStore] Saved graph: ${nodes.length} nodes, ${edges.length} edges, ${sessions.length} sessions`);
  }

  /**
   * Load entire graph from IndexedDB
   */
  async loadGraph() {
    await this.init();

    const [nodes, edges, sessions, stats] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges(),
      this.getAllSessions(),
      this.getMeta('stats')
    ]);

    // Reconstruct the graph
    const graphData = {
      nodes: nodes.map(n => n.toJSON ? n.toJSON() : n),
      edges: edges.map(e => e.toJSON ? e.toJSON() : e),
      sessions: sessions.map(s => s.toJSON ? s.toJSON() : s),
      stats: stats || undefined
    };

    const graph = MemoryGraph.fromJSON(graphData);

    console.log(`[MemoryStore] Loaded graph: ${nodes.length} nodes, ${edges.length} edges, ${sessions.length} sessions`);

    return graph;
  }

  /**
   * Debounced save - batches multiple saves
   */
  scheduleSave(graph) {
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
    }

    this.writeDebounceTimer = setTimeout(async () => {
      try {
        await this.saveGraph(graph);
      } catch (error) {
        console.error('[MemoryStore] Scheduled save failed:', error);
      }
    }, this.WRITE_DEBOUNCE_MS);
  }

  // ============================================================================
  // CLEANUP OPERATIONS
  // ============================================================================

  /**
   * Delete old nodes beyond retention period
   */
  async pruneOldNodes(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    await this.init();
    const cutoff = Date.now() - maxAgeMs;

    return new Promise((resolve, reject) => {
      const store = this._getStore(STORES.NODES, 'readwrite');
      const index = store.index('createdAt');
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);
      let deleted = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          console.log(`[MemoryStore] Pruned ${deleted} old nodes`);
          resolve(deleted);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete orphaned edges (edges pointing to non-existent nodes)
   */
  async pruneOrphanedEdges() {
    await this.init();

    const [allNodes, allEdges] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges()
    ]);

    const nodeIds = new Set(allNodes.map(n => n.id));
    const orphanedEdges = allEdges.filter(e =>
      !nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)
    );

    for (const edge of orphanedEdges) {
      await this.deleteEdge(edge.id);
    }

    console.log(`[MemoryStore] Pruned ${orphanedEdges.length} orphaned edges`);
    return orphanedEdges.length;
  }

  /**
   * Compact database by removing low-relevance nodes
   */
  async compact(minRelevance = 0.05) {
    await this.init();
    const now = Date.now();

    const allNodes = await this.getAllNodes();
    const toDelete = allNodes.filter(node => {
      const age = now - node.metadata.createdAt;
      const minAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      return age > minAge && node.getRelevanceScore(now) < minRelevance;
    });

    for (const node of toDelete) {
      await this.deleteNode(node.id);
    }

    const orphanedEdges = await this.pruneOrphanedEdges();

    console.log(`[MemoryStore] Compacted: removed ${toDelete.length} nodes, ${orphanedEdges} edges`);
    return { nodes: toDelete.length, edges: orphanedEdges };
  }

  // ============================================================================
  // EXPORT/IMPORT
  // ============================================================================

  /**
   * Export graph to JSON string
   */
  async exportToJSON() {
    const graph = await this.loadGraph();
    return JSON.stringify(graph.toJSON(), null, 2);
  }

  /**
   * Import graph from JSON string
   */
  async importFromJSON(jsonString, merge = false) {
    const data = JSON.parse(jsonString);

    if (!merge) {
      await this.clear();
    }

    const graph = MemoryGraph.fromJSON(data);
    await this.saveGraph(graph);

    return graph;
  }

  /**
   * Clear all data
   */
  async clear() {
    await this.init();

    const storeNames = [STORES.NODES, STORES.EDGES, STORES.SESSIONS, STORES.META];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeNames, 'readwrite');

      tx.oncomplete = () => {
        console.log('[MemoryStore] All data cleared');
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);

      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
    });
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  async getStorageStats() {
    await this.init();

    const [nodes, edges, sessions] = await Promise.all([
      this.getAllNodes(),
      this.getAllEdges(),
      this.getAllSessions()
    ]);

    // Estimate storage size
    const nodeBytes = JSON.stringify(nodes.map(n => n.toJSON())).length;
    const edgeBytes = JSON.stringify(edges.map(e => e.toJSON())).length;
    const sessionBytes = JSON.stringify(sessions.map(s => s.toJSON())).length;

    return {
      nodes: {
        count: nodes.length,
        sizeBytes: nodeBytes
      },
      edges: {
        count: edges.length,
        sizeBytes: edgeBytes
      },
      sessions: {
        count: sessions.length,
        sizeBytes: sessionBytes
      },
      total: {
        count: nodes.length + edges.length + sessions.length,
        sizeBytes: nodeBytes + edgeBytes + sessionBytes,
        sizeMB: ((nodeBytes + edgeBytes + sessionBytes) / 1024 / 1024).toFixed(2)
      }
    };
  }
}

// Export singleton
export const memoryStore = new MemoryStore();
