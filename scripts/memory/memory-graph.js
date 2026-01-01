/**
 * Memory Graph - Core Architecture
 * ==================================
 * A semantic memory system that persists work context across sessions,
 * tabs, and platforms. This is the foundation for intelligent context injection.
 *
 * Architecture:
 * - Nodes: Entities (code, files, errors, concepts, tools, people)
 * - Edges: Relationships between entities with typed connections
 * - Sessions: Temporal groupings of related work
 * - Contexts: Aggregated views for specific platforms/tasks
 *
 * Design Principles:
 * - Local-first: All data stays in browser (IndexedDB)
 * - Decay-aware: Recent context weighted higher
 * - Platform-agnostic: Works across any AI chat interface
 * - Queryable: Fast retrieval by type, recency, relevance
 */

// ============================================================================
// NODE TYPES - What we remember
// ============================================================================

export const NodeType = {
  // Code entities
  LANGUAGE: 'language',
  FRAMEWORK: 'framework',
  LIBRARY: 'library',
  CODE_BLOCK: 'code_block',
  FUNCTION: 'function',
  CLASS: 'class',
  FILE: 'file',

  // Problem entities
  ERROR: 'error',
  BUG: 'bug',
  ISSUE: 'issue',

  // Project entities
  PROJECT: 'project',
  TASK: 'task',
  GOAL: 'goal',
  FEATURE: 'feature',

  // Context entities
  TOPIC: 'topic',
  CONCEPT: 'concept',
  TECHNOLOGY: 'technology',

  // Resource entities
  URL: 'url',
  DOCUMENTATION: 'documentation',
  API: 'api',

  // Session entities
  CONVERSATION: 'conversation',
  PROMPT: 'prompt',
  RESPONSE: 'response'
};

// ============================================================================
// EDGE TYPES - How things relate
// ============================================================================

export const EdgeType = {
  // Technical relationships
  USES: 'uses',                    // project USES framework
  IMPLEMENTS: 'implements',        // code IMPLEMENTS feature
  DEPENDS_ON: 'depends_on',        // library DEPENDS_ON library
  PART_OF: 'part_of',              // file PART_OF project
  CONTAINS: 'contains',            // file CONTAINS function

  // Problem relationships
  CAUSED_BY: 'caused_by',          // error CAUSED_BY code
  SOLVED_BY: 'solved_by',          // bug SOLVED_BY code
  RELATED_TO: 'related_to',        // error RELATED_TO error

  // Temporal relationships
  FOLLOWED_BY: 'followed_by',      // task FOLLOWED_BY task
  PRECEDED_BY: 'preceded_by',      // conversation PRECEDED_BY conversation

  // Contextual relationships
  MENTIONED_IN: 'mentioned_in',    // entity MENTIONED_IN conversation
  DISCUSSED_WITH: 'discussed_with', // topic DISCUSSED_WITH platform
  LEARNED_FROM: 'learned_from',    // concept LEARNED_FROM response

  // Semantic relationships
  SIMILAR_TO: 'similar_to',        // code SIMILAR_TO code
  CONTRASTS_WITH: 'contrasts_with' // concept CONTRASTS_WITH concept
};

// ============================================================================
// MEMORY NODE - Core data structure
// ============================================================================

export class MemoryNode {
  constructor(type, content, metadata = {}) {
    this.id = this._generateId();
    this.type = type;
    this.content = content;
    this.metadata = {
      ...metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: null
    };

    // Relevance scoring
    this.importance = metadata.importance || 0.5; // 0-1 scale
    this.confidence = metadata.confidence || 0.8; // How sure we are this is correct
    this.decay = 1.0; // Decays over time

    // Embeddings (optional, for semantic search)
    this.embedding = null;

    // Platform/source tracking
    this.source = metadata.source || 'unknown';
    this.platform = metadata.platform || 'unknown';
    this.sessionId = metadata.sessionId || null;
  }

  _generateId() {
    return `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  touch() {
    this.metadata.accessCount++;
    this.metadata.lastAccessedAt = Date.now();
    this.metadata.updatedAt = Date.now();
    // Boost decay on access (reinforcement)
    this.decay = Math.min(1.0, this.decay + 0.1);
  }

  updateContent(newContent) {
    this.content = newContent;
    this.metadata.updatedAt = Date.now();
  }

  /**
   * Calculate current relevance score
   * Combines: importance, recency, access frequency, confidence
   */
  getRelevanceScore(currentTime = Date.now()) {
    const ageMs = currentTime - this.metadata.createdAt;
    const ageHours = ageMs / (1000 * 60 * 60);

    // Decay function: exponential decay with half-life of 24 hours
    const halfLife = 24; // hours
    const timeDecay = Math.pow(0.5, ageHours / halfLife);

    // Recency boost if accessed recently
    const recencyBoost = this.metadata.lastAccessedAt
      ? Math.exp(-(currentTime - this.metadata.lastAccessedAt) / (1000 * 60 * 60 * 4)) * 0.3
      : 0;

    // Access frequency boost (logarithmic)
    const accessBoost = Math.log(1 + this.metadata.accessCount) * 0.1;

    // Combine all factors
    const score = (
      this.importance * 0.3 +
      this.confidence * 0.2 +
      timeDecay * 0.25 +
      recencyBoost * 0.15 +
      accessBoost * 0.1
    ) * this.decay;

    return Math.min(1.0, Math.max(0, score));
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      content: this.content,
      metadata: this.metadata,
      importance: this.importance,
      confidence: this.confidence,
      decay: this.decay,
      embedding: this.embedding,
      source: this.source,
      platform: this.platform,
      sessionId: this.sessionId
    };
  }

  static fromJSON(json) {
    const node = new MemoryNode(json.type, json.content, json.metadata);
    node.id = json.id;
    node.importance = json.importance;
    node.confidence = json.confidence;
    node.decay = json.decay;
    node.embedding = json.embedding;
    node.source = json.source;
    node.platform = json.platform;
    node.sessionId = json.sessionId;
    return node;
  }
}

// ============================================================================
// MEMORY EDGE - Relationships between nodes
// ============================================================================

export class MemoryEdge {
  constructor(sourceId, targetId, type, metadata = {}) {
    this.id = this._generateId();
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.type = type;
    this.weight = metadata.weight || 1.0; // Strength of relationship
    this.metadata = {
      ...metadata,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.bidirectional = metadata.bidirectional || false;
  }

  _generateId() {
    return `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  reinforce(amount = 0.1) {
    this.weight = Math.min(2.0, this.weight + amount);
    this.metadata.updatedAt = Date.now();
  }

  weaken(amount = 0.05) {
    this.weight = Math.max(0.1, this.weight - amount);
    this.metadata.updatedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      sourceId: this.sourceId,
      targetId: this.targetId,
      type: this.type,
      weight: this.weight,
      metadata: this.metadata,
      bidirectional: this.bidirectional
    };
  }

  static fromJSON(json) {
    const edge = new MemoryEdge(json.sourceId, json.targetId, json.type, json.metadata);
    edge.id = json.id;
    edge.weight = json.weight;
    edge.bidirectional = json.bidirectional;
    return edge;
  }
}

// ============================================================================
// WORK SESSION - Temporal grouping of related work
// ============================================================================

export class WorkSession {
  constructor(metadata = {}) {
    this.id = this._generateId();
    this.startedAt = Date.now();
    this.endedAt = null;
    this.platform = metadata.platform || 'unknown';
    this.url = metadata.url || null;

    // Session context
    this.title = metadata.title || 'Untitled Session';
    this.description = metadata.description || '';
    this.tags = metadata.tags || [];

    // Linked nodes
    this.nodeIds = new Set();

    // Session stats
    this.promptCount = 0;
    this.responseCount = 0;
    this.codeBlockCount = 0;
    this.errorCount = 0;

    // Inferred context
    this.primaryLanguage = null;
    this.primaryFramework = null;
    this.primaryTopic = null;

    // Active state
    this.isActive = true;
  }

  _generateId() {
    return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  addNode(nodeId) {
    this.nodeIds.add(nodeId);
  }

  removeNode(nodeId) {
    this.nodeIds.delete(nodeId);
  }

  end() {
    this.endedAt = Date.now();
    this.isActive = false;
  }

  getDuration() {
    const end = this.endedAt || Date.now();
    return end - this.startedAt;
  }

  updateInferredContext(context) {
    if (context.language) this.primaryLanguage = context.language;
    if (context.framework) this.primaryFramework = context.framework;
    if (context.topic) this.primaryTopic = context.topic;
  }

  toJSON() {
    return {
      id: this.id,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      platform: this.platform,
      url: this.url,
      title: this.title,
      description: this.description,
      tags: this.tags,
      nodeIds: Array.from(this.nodeIds),
      promptCount: this.promptCount,
      responseCount: this.responseCount,
      codeBlockCount: this.codeBlockCount,
      errorCount: this.errorCount,
      primaryLanguage: this.primaryLanguage,
      primaryFramework: this.primaryFramework,
      primaryTopic: this.primaryTopic,
      isActive: this.isActive
    };
  }

  static fromJSON(json) {
    const session = new WorkSession({
      platform: json.platform,
      url: json.url,
      title: json.title,
      description: json.description,
      tags: json.tags
    });
    session.id = json.id;
    session.startedAt = json.startedAt;
    session.endedAt = json.endedAt;
    session.nodeIds = new Set(json.nodeIds);
    session.promptCount = json.promptCount;
    session.responseCount = json.responseCount;
    session.codeBlockCount = json.codeBlockCount;
    session.errorCount = json.errorCount;
    session.primaryLanguage = json.primaryLanguage;
    session.primaryFramework = json.primaryFramework;
    session.primaryTopic = json.primaryTopic;
    session.isActive = json.isActive;
    return session;
  }
}

// ============================================================================
// MEMORY GRAPH - The main graph structure
// ============================================================================

export class MemoryGraph {
  constructor() {
    // Node storage: Map<nodeId, MemoryNode>
    this.nodes = new Map();

    // Edge storage: Map<edgeId, MemoryEdge>
    this.edges = new Map();

    // Adjacency lists for fast traversal
    this.outgoing = new Map(); // nodeId -> Set<edgeId>
    this.incoming = new Map(); // nodeId -> Set<edgeId>

    // Type indexes for fast queries
    this.nodesByType = new Map(); // nodeType -> Set<nodeId>
    this.edgesByType = new Map(); // edgeType -> Set<edgeId>

    // Content index for deduplication
    this.contentIndex = new Map(); // hash(type+content) -> nodeId

    // Session management
    this.sessions = new Map(); // sessionId -> WorkSession
    this.activeSession = null;

    // Statistics
    this.stats = {
      totalNodes: 0,
      totalEdges: 0,
      createdAt: Date.now(),
      lastModified: Date.now()
    };
  }

  // ========== NODE OPERATIONS ==========

  /**
   * Add a node to the graph (with deduplication)
   */
  addNode(type, content, metadata = {}) {
    // Check for existing node with same content
    const hash = this._hashContent(type, content);
    if (this.contentIndex.has(hash)) {
      const existingId = this.contentIndex.get(hash);
      const existingNode = this.nodes.get(existingId);
      if (existingNode) {
        existingNode.touch();
        // Merge metadata if provided
        if (metadata.importance && metadata.importance > existingNode.importance) {
          existingNode.importance = metadata.importance;
        }
        return existingNode;
      }
    }

    // Create new node
    const node = new MemoryNode(type, content, {
      ...metadata,
      sessionId: this.activeSession?.id
    });

    this.nodes.set(node.id, node);
    this.contentIndex.set(hash, node.id);

    // Update indexes
    if (!this.nodesByType.has(type)) {
      this.nodesByType.set(type, new Set());
    }
    this.nodesByType.get(type).add(node.id);

    // Initialize adjacency lists
    this.outgoing.set(node.id, new Set());
    this.incoming.set(node.id, new Set());

    // Link to active session
    if (this.activeSession) {
      this.activeSession.addNode(node.id);
    }

    this.stats.totalNodes++;
    this.stats.lastModified = Date.now();

    return node;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  /**
   * Get nodes by type
   */
  getNodesByType(type) {
    const nodeIds = this.nodesByType.get(type);
    if (!nodeIds) return [];
    return Array.from(nodeIds).map(id => this.nodes.get(id)).filter(Boolean);
  }

  /**
   * Update a node's content
   */
  updateNode(nodeId, updates) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    if (updates.content !== undefined) {
      // Remove old hash, add new
      const oldHash = this._hashContent(node.type, node.content);
      this.contentIndex.delete(oldHash);

      node.updateContent(updates.content);

      const newHash = this._hashContent(node.type, updates.content);
      this.contentIndex.set(newHash, nodeId);
    }

    if (updates.importance !== undefined) {
      node.importance = updates.importance;
    }

    if (updates.confidence !== undefined) {
      node.confidence = updates.confidence;
    }

    this.stats.lastModified = Date.now();
    return node;
  }

  /**
   * Remove a node and all its edges
   */
  removeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    // Remove all connected edges
    const outEdges = this.outgoing.get(nodeId) || new Set();
    const inEdges = this.incoming.get(nodeId) || new Set();

    for (const edgeId of outEdges) {
      this._removeEdgeInternal(edgeId);
    }
    for (const edgeId of inEdges) {
      this._removeEdgeInternal(edgeId);
    }

    // Remove from indexes
    const hash = this._hashContent(node.type, node.content);
    this.contentIndex.delete(hash);

    const typeSet = this.nodesByType.get(node.type);
    if (typeSet) typeSet.delete(nodeId);

    this.outgoing.delete(nodeId);
    this.incoming.delete(nodeId);

    // Remove from sessions
    for (const session of this.sessions.values()) {
      session.removeNode(nodeId);
    }

    this.nodes.delete(nodeId);
    this.stats.totalNodes--;
    this.stats.lastModified = Date.now();

    return true;
  }

  // ========== EDGE OPERATIONS ==========

  /**
   * Add an edge between two nodes
   */
  addEdge(sourceId, targetId, type, metadata = {}) {
    // Validate nodes exist
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return null;
    }

    // Check for duplicate edge
    const existingEdge = this.findEdge(sourceId, targetId, type);
    if (existingEdge) {
      existingEdge.reinforce();
      return existingEdge;
    }

    const edge = new MemoryEdge(sourceId, targetId, type, metadata);

    this.edges.set(edge.id, edge);

    // Update adjacency lists
    this.outgoing.get(sourceId)?.add(edge.id);
    this.incoming.get(targetId)?.add(edge.id);

    // Handle bidirectional edges
    if (edge.bidirectional) {
      this.outgoing.get(targetId)?.add(edge.id);
      this.incoming.get(sourceId)?.add(edge.id);
    }

    // Update type index
    if (!this.edgesByType.has(type)) {
      this.edgesByType.set(type, new Set());
    }
    this.edgesByType.get(type).add(edge.id);

    this.stats.totalEdges++;
    this.stats.lastModified = Date.now();

    return edge;
  }

  /**
   * Find an edge between two nodes of a specific type
   */
  findEdge(sourceId, targetId, type) {
    const outEdges = this.outgoing.get(sourceId);
    if (!outEdges) return null;

    for (const edgeId of outEdges) {
      const edge = this.edges.get(edgeId);
      if (edge && edge.targetId === targetId && edge.type === type) {
        return edge;
      }
    }
    return null;
  }

  /**
   * Get all edges from a node
   */
  getOutgoingEdges(nodeId) {
    const edgeIds = this.outgoing.get(nodeId);
    if (!edgeIds) return [];
    return Array.from(edgeIds).map(id => this.edges.get(id)).filter(Boolean);
  }

  /**
   * Get all edges to a node
   */
  getIncomingEdges(nodeId) {
    const edgeIds = this.incoming.get(nodeId);
    if (!edgeIds) return [];
    return Array.from(edgeIds).map(id => this.edges.get(id)).filter(Boolean);
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(nodeId, direction = 'both') {
    const neighbors = new Set();

    if (direction === 'outgoing' || direction === 'both') {
      for (const edge of this.getOutgoingEdges(nodeId)) {
        neighbors.add(edge.targetId);
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      for (const edge of this.getIncomingEdges(nodeId)) {
        neighbors.add(edge.sourceId);
      }
    }

    return Array.from(neighbors).map(id => this.nodes.get(id)).filter(Boolean);
  }

  _removeEdgeInternal(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return;

    // Remove from adjacency lists
    this.outgoing.get(edge.sourceId)?.delete(edgeId);
    this.incoming.get(edge.targetId)?.delete(edgeId);

    if (edge.bidirectional) {
      this.outgoing.get(edge.targetId)?.delete(edgeId);
      this.incoming.get(edge.sourceId)?.delete(edgeId);
    }

    // Remove from type index
    this.edgesByType.get(edge.type)?.delete(edgeId);

    this.edges.delete(edgeId);
    this.stats.totalEdges--;
  }

  // ========== SESSION OPERATIONS ==========

  /**
   * Start a new work session
   */
  startSession(metadata = {}) {
    // End current session if active
    if (this.activeSession) {
      this.endSession();
    }

    const session = new WorkSession(metadata);
    this.sessions.set(session.id, session);
    this.activeSession = session;

    return session;
  }

  /**
   * End the current session
   */
  endSession() {
    if (this.activeSession) {
      this.activeSession.end();
      this.activeSession = null;
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Get recent sessions
   */
  getRecentSessions(limit = 10) {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  // ========== QUERY OPERATIONS ==========

  /**
   * Find nodes matching criteria
   */
  query(criteria = {}) {
    let results = Array.from(this.nodes.values());

    // Filter by type
    if (criteria.type) {
      const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
      results = results.filter(n => types.includes(n.type));
    }

    // Filter by platform
    if (criteria.platform) {
      results = results.filter(n => n.platform === criteria.platform);
    }

    // Filter by session
    if (criteria.sessionId) {
      const session = this.sessions.get(criteria.sessionId);
      if (session) {
        results = results.filter(n => session.nodeIds.has(n.id));
      }
    }

    // Filter by content match
    if (criteria.contentContains) {
      const searchLower = criteria.contentContains.toLowerCase();
      results = results.filter(n =>
        String(n.content).toLowerCase().includes(searchLower)
      );
    }

    // Filter by minimum relevance
    if (criteria.minRelevance !== undefined) {
      const now = Date.now();
      results = results.filter(n => n.getRelevanceScore(now) >= criteria.minRelevance);
    }

    // Filter by recency (hours)
    if (criteria.withinHours !== undefined) {
      const cutoff = Date.now() - (criteria.withinHours * 60 * 60 * 1000);
      results = results.filter(n => n.metadata.createdAt >= cutoff);
    }

    // Sort by relevance (default) or specified field
    if (criteria.sortBy === 'created') {
      results.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt);
    } else if (criteria.sortBy === 'accessed') {
      results.sort((a, b) => (b.metadata.lastAccessedAt || 0) - (a.metadata.lastAccessedAt || 0));
    } else {
      // Default: sort by relevance
      const now = Date.now();
      results.sort((a, b) => b.getRelevanceScore(now) - a.getRelevanceScore(now));
    }

    // Apply limit
    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  /**
   * Get connected subgraph from a starting node
   */
  getSubgraph(startNodeId, depth = 2) {
    const visited = new Set();
    const nodes = [];
    const edges = [];

    const traverse = (nodeId, currentDepth) => {
      if (visited.has(nodeId) || currentDepth > depth) return;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) nodes.push(node);

      // Get all connected edges and nodes
      for (const edge of this.getOutgoingEdges(nodeId)) {
        edges.push(edge);
        traverse(edge.targetId, currentDepth + 1);
      }

      for (const edge of this.getIncomingEdges(nodeId)) {
        edges.push(edge);
        traverse(edge.sourceId, currentDepth + 1);
      }
    };

    traverse(startNodeId, 0);

    return { nodes, edges: [...new Set(edges)] };
  }

  // ========== CONTEXT GENERATION ==========

  /**
   * Generate aggregated context for injection
   * This is the main output used by the AI platforms
   */
  generateContext(options = {}) {
    const {
      maxNodes = 20,
      includeTypes = null,
      excludeTypes = [NodeType.RESPONSE],
      withinHours = 48,
      platform = null,
      format = 'structured'
    } = options;

    // Query relevant nodes
    let nodes = this.query({
      type: includeTypes,
      platform,
      withinHours,
      minRelevance: 0.1,
      limit: maxNodes * 2 // Query extra, then filter
    });

    // Exclude certain types
    if (excludeTypes) {
      nodes = nodes.filter(n => !excludeTypes.includes(n.type));
    }

    // Take top nodes by relevance
    nodes = nodes.slice(0, maxNodes);

    if (format === 'structured') {
      return this._formatStructuredContext(nodes);
    } else if (format === 'narrative') {
      return this._formatNarrativeContext(nodes);
    } else {
      return this._formatMinimalContext(nodes);
    }
  }

  _formatStructuredContext(nodes) {
    const context = {
      summary: {},
      details: {},
      timestamp: Date.now()
    };

    // Group by type
    for (const node of nodes) {
      const typeKey = node.type;
      if (!context.details[typeKey]) {
        context.details[typeKey] = [];
      }
      context.details[typeKey].push({
        content: node.content,
        relevance: node.getRelevanceScore(),
        source: node.source
      });
    }

    // Build summary
    const languages = nodes.filter(n => n.type === NodeType.LANGUAGE);
    const frameworks = nodes.filter(n => n.type === NodeType.FRAMEWORK);
    const errors = nodes.filter(n => n.type === NodeType.ERROR);
    const topics = nodes.filter(n => n.type === NodeType.TOPIC);

    if (languages.length > 0) {
      context.summary.primaryLanguage = languages[0].content;
    }
    if (frameworks.length > 0) {
      context.summary.frameworks = frameworks.map(n => n.content);
    }
    if (errors.length > 0) {
      context.summary.recentErrors = errors.length;
    }
    if (topics.length > 0) {
      context.summary.topics = topics.map(n => n.content);
    }

    return context;
  }

  _formatNarrativeContext(nodes) {
    const parts = [];

    // Languages and frameworks
    const tech = nodes.filter(n =>
      [NodeType.LANGUAGE, NodeType.FRAMEWORK, NodeType.LIBRARY].includes(n.type)
    );
    if (tech.length > 0) {
      parts.push(`Working with: ${tech.map(n => n.content).join(', ')}`);
    }

    // Current project/goal
    const goals = nodes.filter(n =>
      [NodeType.PROJECT, NodeType.GOAL, NodeType.TASK].includes(n.type)
    );
    if (goals.length > 0) {
      parts.push(`Current focus: ${goals[0].content}`);
    }

    // Recent errors
    const errors = nodes.filter(n => n.type === NodeType.ERROR);
    if (errors.length > 0) {
      parts.push(`Recent issue: ${errors[0].content}`);
    }

    // Topics
    const topics = nodes.filter(n => n.type === NodeType.TOPIC);
    if (topics.length > 0) {
      parts.push(`Context: ${topics.map(n => n.content).join(', ')}`);
    }

    return parts.join('\n');
  }

  _formatMinimalContext(nodes) {
    const language = nodes.find(n => n.type === NodeType.LANGUAGE);
    const framework = nodes.find(n => n.type === NodeType.FRAMEWORK);
    const error = nodes.find(n => n.type === NodeType.ERROR);

    return {
      language: language?.content || null,
      framework: framework?.content || null,
      error: error?.content || null
    };
  }

  // ========== UTILITY METHODS ==========

  _hashContent(type, content) {
    const str = `${type}:${JSON.stringify(content)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Apply decay to all nodes (run periodically)
   */
  applyDecay(decayAmount = 0.01) {
    for (const node of this.nodes.values()) {
      node.decay = Math.max(0.1, node.decay - decayAmount);
    }
  }

  /**
   * Prune low-relevance nodes
   */
  prune(minRelevance = 0.05, minAge = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const toRemove = [];

    for (const node of this.nodes.values()) {
      const age = now - node.metadata.createdAt;
      if (age > minAge && node.getRelevanceScore(now) < minRelevance) {
        toRemove.push(node.id);
      }
    }

    for (const nodeId of toRemove) {
      this.removeNode(nodeId);
    }

    return toRemove.length;
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      ...this.stats,
      nodesByType: Object.fromEntries(
        Array.from(this.nodesByType.entries()).map(([type, set]) => [type, set.size])
      ),
      edgesByType: Object.fromEntries(
        Array.from(this.edgesByType.entries()).map(([type, set]) => [type, set.size])
      ),
      activeSessions: Array.from(this.sessions.values()).filter(s => s.isActive).length,
      totalSessions: this.sessions.size
    };
  }

  // ========== SERIALIZATION ==========

  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
      edges: Array.from(this.edges.values()).map(e => e.toJSON()),
      sessions: Array.from(this.sessions.values()).map(s => s.toJSON()),
      stats: this.stats
    };
  }

  static fromJSON(json) {
    const graph = new MemoryGraph();

    // Restore nodes
    for (const nodeData of (json.nodes || [])) {
      const node = MemoryNode.fromJSON(nodeData);
      graph.nodes.set(node.id, node);

      // Rebuild indexes
      const hash = graph._hashContent(node.type, node.content);
      graph.contentIndex.set(hash, node.id);

      if (!graph.nodesByType.has(node.type)) {
        graph.nodesByType.set(node.type, new Set());
      }
      graph.nodesByType.get(node.type).add(node.id);

      graph.outgoing.set(node.id, new Set());
      graph.incoming.set(node.id, new Set());
    }

    // Restore edges
    for (const edgeData of (json.edges || [])) {
      const edge = MemoryEdge.fromJSON(edgeData);
      graph.edges.set(edge.id, edge);

      // Rebuild adjacency lists
      graph.outgoing.get(edge.sourceId)?.add(edge.id);
      graph.incoming.get(edge.targetId)?.add(edge.id);

      if (edge.bidirectional) {
        graph.outgoing.get(edge.targetId)?.add(edge.id);
        graph.incoming.get(edge.sourceId)?.add(edge.id);
      }

      if (!graph.edgesByType.has(edge.type)) {
        graph.edgesByType.set(edge.type, new Set());
      }
      graph.edgesByType.get(edge.type).add(edge.id);
    }

    // Restore sessions
    for (const sessionData of (json.sessions || [])) {
      const session = WorkSession.fromJSON(sessionData);
      graph.sessions.set(session.id, session);
    }

    graph.stats = json.stats || graph.stats;
    graph.stats.totalNodes = graph.nodes.size;
    graph.stats.totalEdges = graph.edges.size;

    return graph;
  }
}

// Export singleton instance
export const memoryGraph = new MemoryGraph();
