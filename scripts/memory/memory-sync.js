/**
 * Memory Sync - Cross-Tab Synchronization
 * =========================================
 * Synchronizes memory graph state across browser tabs and windows.
 * Uses BroadcastChannel API for real-time sync and chrome.storage
 * for persistence.
 *
 * Features:
 * - Real-time cross-tab updates via BroadcastChannel
 * - Conflict resolution with timestamps
 * - Debounced persistence to IndexedDB
 * - Leader election for background tasks
 */

import { memoryStore } from './memory-store.js';

// ============================================================================
// SYNC CONSTANTS
// ============================================================================

const CHANNEL_NAME = 'awt_memory_sync';
const LEADER_KEY = 'awt_memory_leader';
const LEADER_HEARTBEAT_MS = 5000;
const LEADER_TIMEOUT_MS = 15000;
const SYNC_DEBOUNCE_MS = 1000;

// Message types
const MessageType = {
  // Graph updates
  NODE_ADDED: 'node_added',
  NODE_UPDATED: 'node_updated',
  NODE_REMOVED: 'node_removed',
  EDGE_ADDED: 'edge_added',
  EDGE_REMOVED: 'edge_removed',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',

  // Sync control
  REQUEST_FULL_SYNC: 'request_full_sync',
  FULL_SYNC_RESPONSE: 'full_sync_response',
  HEARTBEAT: 'heartbeat',

  // Leader election
  LEADER_CLAIM: 'leader_claim',
  LEADER_RELEASE: 'leader_release',
  LEADER_QUERY: 'leader_query',
  LEADER_ANNOUNCE: 'leader_announce'
};

// ============================================================================
// MEMORY SYNC CLASS
// ============================================================================

export class MemorySync {
  constructor() {
    this.tabId = this._generateTabId();
    this.channel = null;
    this.isLeader = false;
    this.leaderId = null;
    this.leaderLastSeen = null;

    this.graph = null;
    this.syncDebounceTimer = null;
    this.heartbeatInterval = null;
    this.leaderCheckInterval = null;

    this.listeners = new Map();
    this.pendingUpdates = [];
    this.isInitialized = false;
  }

  /**
   * Initialize sync system
   */
  async init(graph) {
    if (this.isInitialized) return;

    this.graph = graph;

    // Check for BroadcastChannel support
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event) => this._handleMessage(event.data);
    }

    // Start leader election
    await this._startLeaderElection();

    // Start heartbeat if we're the leader
    if (this.isLeader) {
      this._startLeaderHeartbeat();
    }

    // Check for orphaned leader
    this._startLeaderCheck();

    // Request full sync from leader on startup
    this._requestFullSync();

    this.isInitialized = true;
    console.log(`[MemorySync] Initialized. Tab: ${this.tabId}, Leader: ${this.isLeader}`);
  }

  /**
   * Shutdown sync system
   */
  shutdown() {
    // Release leadership if we have it
    if (this.isLeader) {
      this._broadcast({
        type: MessageType.LEADER_RELEASE,
        tabId: this.tabId
      });
    }

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
    }
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    // Close channel
    if (this.channel) {
      this.channel.close();
    }

    this.isInitialized = false;
  }

  // ============================================================================
  // BROADCAST METHODS
  // ============================================================================

  /**
   * Broadcast node addition
   */
  broadcastNodeAdded(node) {
    this._broadcast({
      type: MessageType.NODE_ADDED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: node.toJSON ? node.toJSON() : node
    });
    this._schedulePersist();
  }

  /**
   * Broadcast node update
   */
  broadcastNodeUpdated(node) {
    this._broadcast({
      type: MessageType.NODE_UPDATED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: node.toJSON ? node.toJSON() : node
    });
    this._schedulePersist();
  }

  /**
   * Broadcast node removal
   */
  broadcastNodeRemoved(nodeId) {
    this._broadcast({
      type: MessageType.NODE_REMOVED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: { nodeId }
    });
    this._schedulePersist();
  }

  /**
   * Broadcast edge addition
   */
  broadcastEdgeAdded(edge) {
    this._broadcast({
      type: MessageType.EDGE_ADDED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: edge.toJSON ? edge.toJSON() : edge
    });
    this._schedulePersist();
  }

  /**
   * Broadcast edge removal
   */
  broadcastEdgeRemoved(edgeId) {
    this._broadcast({
      type: MessageType.EDGE_REMOVED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: { edgeId }
    });
    this._schedulePersist();
  }

  /**
   * Broadcast session start
   */
  broadcastSessionStarted(session) {
    this._broadcast({
      type: MessageType.SESSION_STARTED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: session.toJSON ? session.toJSON() : session
    });
    this._schedulePersist();
  }

  /**
   * Broadcast session end
   */
  broadcastSessionEnded(sessionId) {
    this._broadcast({
      type: MessageType.SESSION_ENDED,
      tabId: this.tabId,
      timestamp: Date.now(),
      payload: { sessionId }
    });
    this._schedulePersist();
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  _broadcast(message) {
    if (this.channel) {
      try {
        this.channel.postMessage(message);
      } catch (error) {
        console.error('[MemorySync] Broadcast failed:', error);
      }
    }
  }

  _handleMessage(message) {
    // Ignore our own messages
    if (message.tabId === this.tabId) return;

    switch (message.type) {
      // Graph updates
      case MessageType.NODE_ADDED:
        this._handleRemoteNodeAdded(message.payload);
        break;

      case MessageType.NODE_UPDATED:
        this._handleRemoteNodeUpdated(message.payload);
        break;

      case MessageType.NODE_REMOVED:
        this._handleRemoteNodeRemoved(message.payload.nodeId);
        break;

      case MessageType.EDGE_ADDED:
        this._handleRemoteEdgeAdded(message.payload);
        break;

      case MessageType.EDGE_REMOVED:
        this._handleRemoteEdgeRemoved(message.payload.edgeId);
        break;

      case MessageType.SESSION_STARTED:
        this._handleRemoteSessionStarted(message.payload);
        break;

      case MessageType.SESSION_ENDED:
        this._handleRemoteSessionEnded(message.payload.sessionId);
        break;

      // Sync control
      case MessageType.REQUEST_FULL_SYNC:
        if (this.isLeader) {
          this._sendFullSync(message.tabId);
        }
        break;

      case MessageType.FULL_SYNC_RESPONSE:
        if (message.targetTabId === this.tabId) {
          this._applyFullSync(message.payload);
        }
        break;

      case MessageType.HEARTBEAT:
        if (message.tabId === this.leaderId) {
          this.leaderLastSeen = Date.now();
        }
        break;

      // Leader election
      case MessageType.LEADER_CLAIM:
        this._handleLeaderClaim(message);
        break;

      case MessageType.LEADER_RELEASE:
        if (message.tabId === this.leaderId) {
          this._startLeaderElection();
        }
        break;

      case MessageType.LEADER_QUERY:
        if (this.isLeader) {
          this._announceLeadership();
        }
        break;

      case MessageType.LEADER_ANNOUNCE:
        this._handleLeaderAnnounce(message);
        break;
    }

    // Notify listeners
    this._notifyListeners(message.type, message.payload);
  }

  // ============================================================================
  // REMOTE UPDATE HANDLERS
  // ============================================================================

  _handleRemoteNodeAdded(nodeData) {
    if (!this.graph) return;

    // Check if node already exists
    const existing = this.graph.nodes.get(nodeData.id);
    if (existing) {
      // Conflict resolution: keep newer
      if (nodeData.metadata?.updatedAt > existing.metadata?.updatedAt) {
        this._applyNodeData(nodeData);
      }
    } else {
      this._applyNodeData(nodeData);
    }
  }

  _handleRemoteNodeUpdated(nodeData) {
    if (!this.graph) return;

    const existing = this.graph.nodes.get(nodeData.id);
    if (existing) {
      // Conflict resolution: keep newer
      if (nodeData.metadata?.updatedAt >= existing.metadata?.updatedAt) {
        this._applyNodeData(nodeData);
      }
    }
  }

  _handleRemoteNodeRemoved(nodeId) {
    if (!this.graph) return;
    this.graph.removeNode(nodeId);
  }

  _handleRemoteEdgeAdded(edgeData) {
    if (!this.graph) return;

    const existing = this.graph.edges.get(edgeData.id);
    if (!existing) {
      this._applyEdgeData(edgeData);
    }
  }

  _handleRemoteEdgeRemoved(edgeId) {
    if (!this.graph) return;
    this.graph._removeEdgeInternal(edgeId);
  }

  _handleRemoteSessionStarted(sessionData) {
    if (!this.graph) return;

    const existing = this.graph.sessions.get(sessionData.id);
    if (!existing) {
      const { WorkSession } = require('./memory-graph.js');
      const session = WorkSession.fromJSON(sessionData);
      this.graph.sessions.set(session.id, session);
    }
  }

  _handleRemoteSessionEnded(sessionId) {
    if (!this.graph) return;

    const session = this.graph.sessions.get(sessionId);
    if (session) {
      session.end();
    }
  }

  _applyNodeData(nodeData) {
    const { MemoryNode } = require('./memory-graph.js');
    const node = MemoryNode.fromJSON(nodeData);

    this.graph.nodes.set(node.id, node);

    // Update indexes
    const hash = this.graph._hashContent(node.type, node.content);
    this.graph.contentIndex.set(hash, node.id);

    if (!this.graph.nodesByType.has(node.type)) {
      this.graph.nodesByType.set(node.type, new Set());
    }
    this.graph.nodesByType.get(node.type).add(node.id);

    if (!this.graph.outgoing.has(node.id)) {
      this.graph.outgoing.set(node.id, new Set());
    }
    if (!this.graph.incoming.has(node.id)) {
      this.graph.incoming.set(node.id, new Set());
    }
  }

  _applyEdgeData(edgeData) {
    const { MemoryEdge } = require('./memory-graph.js');
    const edge = MemoryEdge.fromJSON(edgeData);

    this.graph.edges.set(edge.id, edge);

    // Update adjacency lists
    this.graph.outgoing.get(edge.sourceId)?.add(edge.id);
    this.graph.incoming.get(edge.targetId)?.add(edge.id);

    if (edge.bidirectional) {
      this.graph.outgoing.get(edge.targetId)?.add(edge.id);
      this.graph.incoming.get(edge.sourceId)?.add(edge.id);
    }

    if (!this.graph.edgesByType.has(edge.type)) {
      this.graph.edgesByType.set(edge.type, new Set());
    }
    this.graph.edgesByType.get(edge.type).add(edge.id);
  }

  // ============================================================================
  // FULL SYNC
  // ============================================================================

  _requestFullSync() {
    // Only request if there's a leader and it's not us
    if (this.leaderId && this.leaderId !== this.tabId) {
      this._broadcast({
        type: MessageType.REQUEST_FULL_SYNC,
        tabId: this.tabId,
        timestamp: Date.now()
      });
    }
  }

  _sendFullSync(targetTabId) {
    if (!this.graph) return;

    this._broadcast({
      type: MessageType.FULL_SYNC_RESPONSE,
      tabId: this.tabId,
      targetTabId,
      timestamp: Date.now(),
      payload: this.graph.toJSON()
    });
  }

  _applyFullSync(graphData) {
    if (!this.graph) return;

    // Only apply if our graph is empty or outdated
    const ourLastModified = this.graph.stats?.lastModified || 0;
    const theirLastModified = graphData.stats?.lastModified || 0;

    if (theirLastModified > ourLastModified) {
      console.log('[MemorySync] Applying full sync from leader');

      // Clear and rebuild
      this.graph.nodes.clear();
      this.graph.edges.clear();
      this.graph.sessions.clear();
      this.graph.nodesByType.clear();
      this.graph.edgesByType.clear();
      this.graph.contentIndex.clear();
      this.graph.outgoing.clear();
      this.graph.incoming.clear();

      // Rebuild from JSON
      const { MemoryGraph } = require('./memory-graph.js');
      const newGraph = MemoryGraph.fromJSON(graphData);

      // Copy state to our graph
      this.graph.nodes = newGraph.nodes;
      this.graph.edges = newGraph.edges;
      this.graph.sessions = newGraph.sessions;
      this.graph.nodesByType = newGraph.nodesByType;
      this.graph.edgesByType = newGraph.edgesByType;
      this.graph.contentIndex = newGraph.contentIndex;
      this.graph.outgoing = newGraph.outgoing;
      this.graph.incoming = newGraph.incoming;
      this.graph.stats = newGraph.stats;
    }
  }

  // ============================================================================
  // LEADER ELECTION
  // ============================================================================

  async _startLeaderElection() {
    // Check for existing leader
    this._broadcast({
      type: MessageType.LEADER_QUERY,
      tabId: this.tabId
    });

    // Wait briefly for response
    await new Promise(resolve => setTimeout(resolve, 200));

    // If no leader responded, claim leadership
    if (!this.leaderId || this.leaderId === this.tabId) {
      this._claimLeadership();
    }
  }

  _claimLeadership() {
    this._broadcast({
      type: MessageType.LEADER_CLAIM,
      tabId: this.tabId,
      timestamp: Date.now()
    });

    // Set ourselves as leader
    this.isLeader = true;
    this.leaderId = this.tabId;
    this.leaderLastSeen = Date.now();

    // Store in chrome.storage for persistence
    this._storeLeaderState();

    // Start heartbeat
    this._startLeaderHeartbeat();

    console.log('[MemorySync] Claimed leadership');
  }

  _handleLeaderClaim(message) {
    // If we're the leader, compare timestamps
    if (this.isLeader) {
      // Lower tabId wins in ties (deterministic)
      if (message.tabId < this.tabId) {
        this.isLeader = false;
        this.leaderId = message.tabId;
        this.leaderLastSeen = Date.now();
        clearInterval(this.heartbeatInterval);
        console.log(`[MemorySync] Yielded leadership to ${message.tabId}`);
      }
    } else {
      this.leaderId = message.tabId;
      this.leaderLastSeen = Date.now();
    }
  }

  _handleLeaderAnnounce(message) {
    this.leaderId = message.tabId;
    this.leaderLastSeen = Date.now();

    if (this.isLeader && this.tabId !== message.tabId) {
      // Another tab claims leadership, defer to them if they have lower ID
      if (message.tabId < this.tabId) {
        this.isLeader = false;
        clearInterval(this.heartbeatInterval);
      }
    }
  }

  _announceLeadership() {
    this._broadcast({
      type: MessageType.LEADER_ANNOUNCE,
      tabId: this.tabId,
      timestamp: Date.now()
    });
  }

  _startLeaderHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader) {
        this._broadcast({
          type: MessageType.HEARTBEAT,
          tabId: this.tabId,
          timestamp: Date.now()
        });

        // Persist graph periodically if we're the leader
        this._schedulePersist();
      }
    }, LEADER_HEARTBEAT_MS);
  }

  _startLeaderCheck() {
    this.leaderCheckInterval = setInterval(() => {
      if (this.leaderId && this.leaderId !== this.tabId) {
        const now = Date.now();
        if (now - this.leaderLastSeen > LEADER_TIMEOUT_MS) {
          console.log('[MemorySync] Leader timeout, starting election');
          this._startLeaderElection();
        }
      }
    }, LEADER_HEARTBEAT_MS);
  }

  async _storeLeaderState() {
    try {
      await chrome.storage.local.set({
        [LEADER_KEY]: {
          tabId: this.tabId,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      // chrome.storage may not be available in all contexts
    }
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  _schedulePersist() {
    // Only leader persists
    if (!this.isLeader) return;

    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = setTimeout(async () => {
      try {
        await memoryStore.saveGraph(this.graph);
      } catch (error) {
        console.error('[MemorySync] Persist failed:', error);
      }
    }, SYNC_DEBOUNCE_MS);
  }

  // ============================================================================
  // EVENT LISTENERS
  // ============================================================================

  /**
   * Subscribe to sync events
   */
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);

    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * Unsubscribe from sync events
   */
  off(eventType, callback) {
    this.listeners.get(eventType)?.delete(callback);
  }

  _notifyListeners(eventType, payload) {
    const callbacks = this.listeners.get(eventType);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload);
        } catch (error) {
          console.error('[MemorySync] Listener error:', error);
        }
      }
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  _generateTabId() {
    return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      tabId: this.tabId,
      isLeader: this.isLeader,
      leaderId: this.leaderId,
      leaderLastSeen: this.leaderLastSeen,
      isInitialized: this.isInitialized,
      channelActive: !!this.channel
    };
  }

  /**
   * Force full sync from leader
   */
  forceSync() {
    this._requestFullSync();
  }
}

// Export singleton
export const memorySync = new MemorySync();
