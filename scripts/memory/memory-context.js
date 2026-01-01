/**
 * Memory Context - Context Aggregation & Generation
 * ===================================================
 * Generates intelligent context from the memory graph for injection
 * into AI conversations. This is the output layer of the memory system.
 *
 * Features:
 * - Multi-strategy context generation (narrative, structured, minimal)
 * - Platform-aware formatting
 * - Token budget management
 * - Relevance-based filtering
 * - Cross-session context continuity
 */

import { memoryGraph, NodeType, EdgeType } from './memory-graph.js';

// ============================================================================
// CONTEXT STRATEGIES
// ============================================================================

export const ContextStrategy = {
  MINIMAL: 'minimal',       // Just key facts: language, framework, current error
  STRUCTURED: 'structured', // JSON-like structured data
  NARRATIVE: 'narrative',   // Natural language paragraph
  SYSTEM: 'system',         // Formatted as system prompt prefix
  CUSTOM: 'custom'          // User-defined template
};

// Platform-specific token limits (conservative estimates)
const PLATFORM_LIMITS = {
  chatgpt: 1500,
  claude: 2000,
  perplexity: 1000,
  gemini: 1500,
  poe: 1000,
  copilot: 800,
  bing: 600,
  you: 800,
  huggingface: 500,
  grok: 1000,
  default: 1000
};

// ============================================================================
// CONTEXT GENERATOR
// ============================================================================

export class MemoryContext {
  constructor(graph = memoryGraph) {
    this.graph = graph;
    this.templates = this._getDefaultTemplates();
  }

  /**
   * Generate context for injection
   * @param {Object} options Configuration options
   * @returns {Object} Generated context with text and metadata
   */
  generate(options = {}) {
    const {
      strategy = ContextStrategy.NARRATIVE,
      platform = 'default',
      maxTokens = null,
      includeTypes = null,
      excludeTypes = [NodeType.RESPONSE],
      withinHours = 48,
      sessionId = null,
      template = null
    } = options;

    // Determine token budget
    const tokenBudget = maxTokens || PLATFORM_LIMITS[platform] || PLATFORM_LIMITS.default;

    // Query relevant nodes
    const queryOptions = {
      type: includeTypes,
      withinHours,
      minRelevance: 0.1,
      limit: 50
    };

    if (sessionId) {
      queryOptions.sessionId = sessionId;
    }

    let nodes = this.graph.query(queryOptions);

    // Apply exclusions
    if (excludeTypes && excludeTypes.length > 0) {
      nodes = nodes.filter(n => !excludeTypes.includes(n.type));
    }

    // Group nodes by type
    const grouped = this._groupByType(nodes);

    // Generate based on strategy
    let context;
    switch (strategy) {
      case ContextStrategy.MINIMAL:
        context = this._generateMinimal(grouped, tokenBudget);
        break;
      case ContextStrategy.STRUCTURED:
        context = this._generateStructured(grouped, tokenBudget);
        break;
      case ContextStrategy.SYSTEM:
        context = this._generateSystem(grouped, tokenBudget);
        break;
      case ContextStrategy.CUSTOM:
        context = this._generateCustom(grouped, template, tokenBudget);
        break;
      case ContextStrategy.NARRATIVE:
      default:
        context = this._generateNarrative(grouped, tokenBudget);
    }

    return {
      text: context.text,
      tokens: this._estimateTokens(context.text),
      strategy,
      platform,
      nodeCount: nodes.length,
      generatedAt: Date.now(),
      metadata: context.metadata
    };
  }

  /**
   * Minimal context - just essential facts
   */
  _generateMinimal(grouped, tokenBudget) {
    const parts = [];
    const metadata = {};

    // Primary language
    const lang = grouped[NodeType.LANGUAGE]?.[0];
    if (lang) {
      metadata.language = lang.content;
    }

    // Primary framework
    const framework = grouped[NodeType.FRAMEWORK]?.[0];
    if (framework) {
      metadata.framework = framework.content;
    }

    // Current error (if any, within last 2 hours)
    const recentError = grouped[NodeType.ERROR]?.find(e => {
      const age = Date.now() - e.metadata.createdAt;
      return age < 2 * 60 * 60 * 1000;
    });
    if (recentError) {
      metadata.error = recentError.content;
    }

    // Current goal
    const goal = grouped[NodeType.GOAL]?.[0];
    if (goal) {
      metadata.goal = goal.content;
    }

    return {
      text: '', // Minimal returns structured data only
      metadata
    };
  }

  /**
   * Structured context - JSON-like format
   */
  _generateStructured(grouped, tokenBudget) {
    const context = {
      workContext: {}
    };

    // Languages
    const languages = grouped[NodeType.LANGUAGE]?.slice(0, 3) || [];
    if (languages.length > 0) {
      context.workContext.languages = languages.map(n => ({
        name: n.content,
        confidence: n.confidence?.toFixed(2)
      }));
    }

    // Frameworks
    const frameworks = grouped[NodeType.FRAMEWORK]?.slice(0, 3) || [];
    if (frameworks.length > 0) {
      context.workContext.frameworks = frameworks.map(n => n.content);
    }

    // Current errors
    const errors = grouped[NodeType.ERROR]?.slice(0, 2) || [];
    if (errors.length > 0) {
      context.workContext.recentErrors = errors.map(n => n.content.substring(0, 100));
    }

    // Goals
    const goals = grouped[NodeType.GOAL]?.slice(0, 2) || [];
    if (goals.length > 0) {
      context.workContext.goals = goals.map(n => n.content);
    }

    // Topics
    const topics = grouped[NodeType.TOPIC]?.slice(0, 3) || [];
    if (topics.length > 0) {
      context.workContext.topics = topics.map(n => n.content);
    }

    // Files being worked on
    const files = grouped[NodeType.FILE]?.slice(0, 5) || [];
    if (files.length > 0) {
      context.workContext.files = files.map(n => n.content);
    }

    const text = JSON.stringify(context, null, 2);

    // Truncate if over budget
    const truncated = this._truncateToTokens(text, tokenBudget);

    return {
      text: truncated,
      metadata: context.workContext
    };
  }

  /**
   * Narrative context - natural language description
   */
  _generateNarrative(grouped, tokenBudget) {
    const parts = [];
    const metadata = {};

    // Opening
    const languages = grouped[NodeType.LANGUAGE]?.slice(0, 2) || [];
    const frameworks = grouped[NodeType.FRAMEWORK]?.slice(0, 2) || [];

    if (languages.length > 0 || frameworks.length > 0) {
      const techParts = [];
      if (languages.length > 0) {
        const langNames = languages.map(n => this._capitalize(n.content));
        techParts.push(langNames.join(' and '));
        metadata.language = languages[0].content;
      }
      if (frameworks.length > 0) {
        const fwNames = frameworks.map(n => this._capitalize(n.content));
        techParts.push(`using ${fwNames.join(', ')}`);
        metadata.framework = frameworks[0].content;
      }
      parts.push(`Currently working with ${techParts.join(' ')}.`);
    }

    // Goals
    const goals = grouped[NodeType.GOAL]?.slice(0, 2) || [];
    if (goals.length > 0) {
      parts.push(`Working on: ${goals[0].content}.`);
      metadata.goal = goals[0].content;
    }

    // Recent errors
    const errors = grouped[NodeType.ERROR]?.slice(0, 1) || [];
    if (errors.length > 0) {
      const error = errors[0];
      const age = Date.now() - error.metadata.createdAt;
      if (age < 4 * 60 * 60 * 1000) { // Within 4 hours
        parts.push(`Recently encountered: ${error.content.substring(0, 100)}`);
        metadata.error = error.content;
      }
    }

    // Topics
    const topics = grouped[NodeType.TOPIC]?.slice(0, 2) || [];
    if (topics.length > 0) {
      const topicNames = topics.map(n => n.content);
      parts.push(`Context: ${topicNames.join(', ')}.`);
      metadata.topics = topicNames;
    }

    // Files
    const files = grouped[NodeType.FILE]?.slice(0, 3) || [];
    if (files.length > 0) {
      parts.push(`Files: ${files.map(n => n.content).join(', ')}`);
    }

    const text = parts.join(' ');
    const truncated = this._truncateToTokens(text, tokenBudget);

    return {
      text: truncated,
      metadata
    };
  }

  /**
   * System prompt context - formatted for system prompt injection
   */
  _generateSystem(grouped, tokenBudget) {
    const lines = [];
    const metadata = {};

    lines.push('<work_context>');

    // Languages and frameworks
    const languages = grouped[NodeType.LANGUAGE]?.slice(0, 2) || [];
    const frameworks = grouped[NodeType.FRAMEWORK]?.slice(0, 3) || [];

    if (languages.length > 0) {
      const primary = languages[0].content;
      lines.push(`Primary language: ${this._capitalize(primary)}`);
      metadata.language = primary;
    }

    if (frameworks.length > 0) {
      lines.push(`Tech stack: ${frameworks.map(n => this._capitalize(n.content)).join(', ')}`);
      metadata.frameworks = frameworks.map(n => n.content);
    }

    // Current project/goal
    const goals = grouped[NodeType.GOAL]?.slice(0, 1) || [];
    if (goals.length > 0) {
      lines.push(`Current task: ${goals[0].content}`);
      metadata.goal = goals[0].content;
    }

    // Files in context
    const files = grouped[NodeType.FILE]?.slice(0, 5) || [];
    if (files.length > 0) {
      lines.push(`Working files: ${files.map(n => n.content).join(', ')}`);
    }

    // Recent code context (abbreviated)
    const codeBlocks = grouped[NodeType.CODE_BLOCK]?.slice(0, 1) || [];
    if (codeBlocks.length > 0) {
      const code = codeBlocks[0];
      const lang = code.metadata?.language || 'code';
      const preview = code.content.substring(0, 150).replace(/\n/g, ' ').trim();
      lines.push(`Recent ${lang}: ${preview}...`);
    }

    // Errors
    const errors = grouped[NodeType.ERROR]?.slice(0, 1) || [];
    if (errors.length > 0) {
      lines.push(`Issue: ${errors[0].content.substring(0, 100)}`);
      metadata.error = errors[0].content;
    }

    lines.push('</work_context>');

    const text = lines.join('\n');
    const truncated = this._truncateToTokens(text, tokenBudget);

    return {
      text: truncated,
      metadata
    };
  }

  /**
   * Custom template context
   */
  _generateCustom(grouped, template, tokenBudget) {
    if (!template) {
      return this._generateNarrative(grouped, tokenBudget);
    }

    const metadata = {};
    let text = template;

    // Replace template variables
    const replacements = {
      '{{language}}': grouped[NodeType.LANGUAGE]?.[0]?.content || '',
      '{{languages}}': (grouped[NodeType.LANGUAGE] || []).map(n => n.content).join(', '),
      '{{framework}}': grouped[NodeType.FRAMEWORK]?.[0]?.content || '',
      '{{frameworks}}': (grouped[NodeType.FRAMEWORK] || []).map(n => n.content).join(', '),
      '{{error}}': grouped[NodeType.ERROR]?.[0]?.content || '',
      '{{goal}}': grouped[NodeType.GOAL]?.[0]?.content || '',
      '{{goals}}': (grouped[NodeType.GOAL] || []).map(n => n.content).join('; '),
      '{{topic}}': grouped[NodeType.TOPIC]?.[0]?.content || '',
      '{{topics}}': (grouped[NodeType.TOPIC] || []).map(n => n.content).join(', '),
      '{{files}}': (grouped[NodeType.FILE] || []).map(n => n.content).join(', '),
      '{{code}}': grouped[NodeType.CODE_BLOCK]?.[0]?.content?.substring(0, 200) || ''
    };

    for (const [key, value] of Object.entries(replacements)) {
      text = text.replace(new RegExp(key, 'g'), value);
      // Track used values in metadata
      if (value && key.startsWith('{{') && key.endsWith('}}')) {
        const metaKey = key.slice(2, -2);
        if (!metaKey.endsWith('s')) { // Don't duplicate plurals
          metadata[metaKey] = value;
        }
      }
    }

    // Clean up empty lines from unused variables
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    const truncated = this._truncateToTokens(text, tokenBudget);

    return {
      text: truncated,
      metadata
    };
  }

  // ============================================================================
  // SMART CONTEXT FEATURES
  // ============================================================================

  /**
   * Generate context specifically for error debugging
   */
  generateDebugContext(options = {}) {
    const errors = this.graph.query({
      type: NodeType.ERROR,
      withinHours: 4,
      limit: 3
    });

    if (errors.length === 0) {
      return null;
    }

    const recentError = errors[0];

    // Find related code blocks
    const codeBlocks = this.graph.query({
      type: NodeType.CODE_BLOCK,
      withinHours: 4,
      limit: 2
    });

    // Get language context
    const languages = this.graph.query({
      type: NodeType.LANGUAGE,
      withinHours: 24,
      limit: 1
    });

    const parts = [];

    if (languages.length > 0) {
      parts.push(`Language: ${this._capitalize(languages[0].content)}`);
    }

    parts.push(`Error: ${recentError.content}`);

    if (recentError.metadata?.context) {
      parts.push(`Context: ${recentError.metadata.context.substring(0, 200)}`);
    }

    if (codeBlocks.length > 0) {
      const code = codeBlocks[0].content.substring(0, 300);
      parts.push(`Related code:\n\`\`\`\n${code}\n\`\`\``);
    }

    return {
      text: parts.join('\n'),
      error: recentError.content,
      language: languages[0]?.content,
      hasCode: codeBlocks.length > 0
    };
  }

  /**
   * Generate context for continuing a previous session
   */
  generateSessionContinuationContext(sessionId) {
    const session = this.graph.getSession(sessionId);
    if (!session) return null;

    const nodes = this.graph.query({
      sessionId,
      limit: 20
    });

    const grouped = this._groupByType(nodes);

    const parts = [];
    parts.push(`Continuing session: "${session.title || 'Previous work'}"`);

    if (session.primaryLanguage) {
      parts.push(`Language: ${this._capitalize(session.primaryLanguage)}`);
    }

    if (session.primaryFramework) {
      parts.push(`Framework: ${this._capitalize(session.primaryFramework)}`);
    }

    const goals = grouped[NodeType.GOAL] || [];
    if (goals.length > 0) {
      parts.push(`Previous goal: ${goals[0].content}`);
    }

    return {
      text: parts.join('\n'),
      session: session.toJSON(),
      nodeCount: nodes.length
    };
  }

  /**
   * Generate cross-platform context summary
   */
  generateCrossPlatformContext() {
    // Get recent activity across all platforms
    const recentNodes = this.graph.query({
      withinHours: 24,
      limit: 30
    });

    // Group by platform
    const byPlatform = {};
    for (const node of recentNodes) {
      const platform = node.platform || 'unknown';
      if (!byPlatform[platform]) {
        byPlatform[platform] = [];
      }
      byPlatform[platform].push(node);
    }

    // Build summary
    const summary = {
      platforms: Object.keys(byPlatform),
      totalNodes: recentNodes.length,
      contexts: {}
    };

    for (const [platform, nodes] of Object.entries(byPlatform)) {
      const grouped = this._groupByType(nodes);
      summary.contexts[platform] = {
        language: grouped[NodeType.LANGUAGE]?.[0]?.content,
        framework: grouped[NodeType.FRAMEWORK]?.[0]?.content,
        nodeCount: nodes.length
      };
    }

    // Generate unified context text
    const languages = [...new Set(recentNodes
      .filter(n => n.type === NodeType.LANGUAGE)
      .map(n => n.content))];

    const frameworks = [...new Set(recentNodes
      .filter(n => n.type === NodeType.FRAMEWORK)
      .map(n => n.content))];

    let text = 'Cross-session context:\n';
    if (languages.length > 0) {
      text += `Languages: ${languages.map(l => this._capitalize(l)).join(', ')}\n`;
    }
    if (frameworks.length > 0) {
      text += `Frameworks: ${frameworks.map(f => this._capitalize(f)).join(', ')}\n`;
    }
    text += `Active across: ${summary.platforms.join(', ')}`;

    return {
      text,
      summary,
      languages,
      frameworks
    };
  }

  // ============================================================================
  // VARIABLE MAPPING FOR PROMPT TEMPLATES
  // ============================================================================

  /**
   * Map memory context to prompt template variables
   */
  mapToVariables(variableNames) {
    const mappings = {};

    // Query relevant nodes
    const nodes = this.graph.query({
      withinHours: 24,
      limit: 30
    });

    const grouped = this._groupByType(nodes);

    for (const varName of variableNames) {
      const v = varName.toLowerCase();
      let value = null;
      let confidence = 0;
      let source = null;

      // Language mappings
      if (['language', 'lang', 'programming_language'].includes(v)) {
        const lang = grouped[NodeType.LANGUAGE]?.[0];
        if (lang) {
          value = this._capitalize(lang.content);
          confidence = lang.confidence || 0.8;
          source = 'memory_graph';
        }
      }
      // Framework mappings
      else if (['framework', 'library', 'stack', 'tech'].includes(v)) {
        const fw = grouped[NodeType.FRAMEWORK]?.[0];
        if (fw) {
          value = this._capitalize(fw.content);
          confidence = fw.confidence || 0.8;
          source = 'memory_graph';
        }
      }
      // Error mappings
      else if (['error', 'error_message', 'exception', 'bug', 'issue'].includes(v)) {
        const error = grouped[NodeType.ERROR]?.[0];
        if (error) {
          value = error.content;
          confidence = 0.9;
          source = 'memory_graph';
        }
      }
      // Code mappings
      else if (['code', 'snippet', 'source', 'codeblock'].includes(v)) {
        const code = grouped[NodeType.CODE_BLOCK]?.[0];
        if (code) {
          value = code.content;
          confidence = 0.85;
          source = 'memory_graph';
        }
      }
      // Goal mappings
      else if (['goal', 'task', 'objective', 'purpose'].includes(v)) {
        const goal = grouped[NodeType.GOAL]?.[0];
        if (goal) {
          value = goal.content;
          confidence = goal.confidence || 0.6;
          source = 'memory_graph';
        }
      }
      // Topic mappings
      else if (['topic', 'context', 'domain', 'area'].includes(v)) {
        const topic = grouped[NodeType.TOPIC]?.[0];
        if (topic) {
          value = topic.content;
          confidence = topic.confidence || 0.7;
          source = 'memory_graph';
        }
      }
      // File mappings
      else if (['file', 'filename', 'path'].includes(v)) {
        const file = grouped[NodeType.FILE]?.[0];
        if (file) {
          value = file.content;
          confidence = 0.8;
          source = 'memory_graph';
        }
      }
      // Function mappings
      else if (['function', 'method', 'func'].includes(v)) {
        const func = grouped[NodeType.FUNCTION]?.[0];
        if (func) {
          value = func.content;
          confidence = 0.75;
          source = 'memory_graph';
        }
      }
      // Class mappings
      else if (['class', 'classname', 'component'].includes(v)) {
        const cls = grouped[NodeType.CLASS]?.[0];
        if (cls) {
          value = cls.content;
          confidence = 0.75;
          source = 'memory_graph';
        }
      }

      if (value) {
        mappings[varName] = {
          value,
          confidence,
          source,
          autoDetected: true
        };
      }
    }

    return mappings;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  _groupByType(nodes) {
    const grouped = {};
    for (const node of nodes) {
      if (!grouped[node.type]) {
        grouped[node.type] = [];
      }
      grouped[node.type].push(node);
    }
    return grouped;
  }

  _estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
  }

  _truncateToTokens(text, maxTokens) {
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    // Truncate at word boundary
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    return truncated.substring(0, lastSpace) + '...';
  }

  _capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  _getDefaultTemplates() {
    return {
      debug: `Language: {{language}}
Error: {{error}}
Related code:
\`\`\`
{{code}}
\`\`\``,

      continue: `Continuing work on: {{goal}}
Using: {{language}} with {{framework}}
Recent files: {{files}}`,

      context: `<context>
Language: {{language}}
Framework: {{framework}}
Current task: {{goal}}
Topic: {{topic}}
</context>`
    };
  }

  /**
   * Register a custom template
   */
  registerTemplate(name, template) {
    this.templates[name] = template;
  }
}

// Export singleton
export const memoryContext = new MemoryContext();
