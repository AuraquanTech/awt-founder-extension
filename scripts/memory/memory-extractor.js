/**
 * Memory Extractor - Entity Extraction & Relationship Mapping
 * =============================================================
 * Extracts entities from conversations and builds the memory graph.
 * This is the bridge between raw conversation text and structured memory.
 *
 * Capabilities:
 * - Multi-language code detection with confidence scoring
 * - Framework/library identification
 * - Error pattern recognition
 * - Goal/intent extraction
 * - Entity relationship inference
 * - Automatic graph population
 */

import { memoryGraph, NodeType, EdgeType, MemoryNode } from './memory-graph.js';

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

const LANGUAGE_SIGNATURES = {
  python: {
    keywords: ['def ', 'import ', 'from ', 'class ', 'self.', '__init__', 'async def', 'await ', 'elif ', 'except:', 'raise ', 'lambda ', 'yield '],
    patterns: [/def\s+\w+\s*\(/, /import\s+\w+/, /from\s+\w+\s+import/, /if\s+__name__\s*==\s*["']__main__["']/, /:\s*$\n\s+/m],
    extensions: ['.py', '.pyw', '.pyi'],
    frameworks: {
      django: ['from django', 'models.Model', 'views.py', 'urls.py', 'settings.py', 'manage.py'],
      flask: ['from flask', 'Flask(__name__)', '@app.route', 'render_template'],
      fastapi: ['from fastapi', 'FastAPI()', '@app.get', '@app.post', 'Depends('],
      pandas: ['import pandas', 'pd.DataFrame', 'pd.read_', '.groupby(', '.merge('],
      pytorch: ['import torch', 'torch.nn', 'torch.tensor', '.cuda()', 'nn.Module'],
      tensorflow: ['import tensorflow', 'tf.keras', 'tf.constant', 'model.fit']
    }
  },
  javascript: {
    keywords: ['const ', 'let ', 'var ', 'function ', '=>', 'async ', 'await ', 'require(', 'export ', 'import ', 'module.exports'],
    patterns: [/const\s+\w+\s*=/, /let\s+\w+\s*=/, /function\s+\w+\s*\(/, /=>\s*[\{(]/, /\.then\s*\(/, /\.catch\s*\(/],
    extensions: ['.js', '.mjs', '.cjs'],
    frameworks: {
      react: ['import React', 'from \'react\'', 'useState', 'useEffect', 'useRef', 'jsx', '<Component'],
      vue: ['<template>', '<script setup>', 'defineComponent', 'ref(', 'reactive(', 'v-if', 'v-for'],
      angular: ['@Component', '@Injectable', '@NgModule', 'ngOnInit', 'from \'@angular'],
      express: ['express()', 'app.get', 'app.post', 'app.use', 'router.', 'req, res'],
      nextjs: ['getServerSideProps', 'getStaticProps', 'next/link', 'next/image', 'pages/', 'app/']
    }
  },
  typescript: {
    keywords: ['interface ', 'type ', ': string', ': number', ': boolean', ': void', 'as const', 'readonly ', 'enum ', 'namespace '],
    patterns: [/interface\s+\w+/, /type\s+\w+\s*=/, /:\s*(string|number|boolean|any|void|never)/, /<\w+>/, /\w+\s*:\s*\w+\[\]/],
    extensions: ['.ts', '.tsx', '.d.ts'],
    frameworks: {} // Inherits from JavaScript
  },
  rust: {
    keywords: ['fn ', 'let mut', 'impl ', 'struct ', 'enum ', 'pub ', 'mod ', 'use ', '&self', '&str', 'Vec<', 'Option<', 'Result<', '->'],
    patterns: [/fn\s+\w+\s*\(/, /let\s+mut\s+\w+/, /impl\s+\w+/, /struct\s+\w+/, /pub\s+fn/, /#\[derive/],
    extensions: ['.rs'],
    frameworks: {
      tokio: ['#[tokio::main]', 'tokio::spawn', 'async fn', '.await'],
      actix: ['actix_web', 'HttpServer', 'App::new', '#[get(', '#[post('],
      rocket: ['#[launch]', 'rocket::build', '#[get(', '#[post(']
    }
  },
  go: {
    keywords: ['func ', 'package ', 'import (', 'var ', ':= ', 'err != nil', 'defer ', 'go ', 'chan ', 'select {'],
    patterns: [/func\s+\w+\s*\(/, /package\s+\w+/, /if\s+err\s*!=\s*nil/, /go\s+func\s*\(/, /make\s*\(/],
    extensions: ['.go'],
    frameworks: {
      gin: ['gin.Default', 'gin.Context', 'c.JSON', 'r.GET', 'r.POST'],
      echo: ['echo.New', 'echo.Context', 'e.GET', 'e.POST'],
      fiber: ['fiber.New', 'fiber.Ctx', 'app.Get', 'app.Post']
    }
  },
  java: {
    keywords: ['public class', 'private ', 'protected ', 'void ', 'static ', 'final ', 'extends ', 'implements ', '@Override', 'import java'],
    patterns: [/public\s+class\s+\w+/, /public\s+static\s+void\s+main/, /private\s+\w+\s+\w+;/, /@\w+\s*\n?\s*public/],
    extensions: ['.java'],
    frameworks: {
      spring: ['@SpringBootApplication', '@Autowired', '@RestController', '@Service', '@Repository', 'spring-boot'],
      hibernate: ['@Entity', '@Table', '@Column', 'SessionFactory', 'hibernate']
    }
  },
  csharp: {
    keywords: ['public class', 'private ', 'namespace ', 'using ', 'void ', 'async Task', 'await ', 'var ', 'string ', 'int '],
    patterns: [/public\s+class\s+\w+/, /namespace\s+\w+/, /using\s+\w+;/, /async\s+Task/, /\[.*\]\s*\n?\s*public/],
    extensions: ['.cs'],
    frameworks: {
      aspnet: ['[ApiController]', '[HttpGet]', '[HttpPost]', 'IActionResult', 'ControllerBase'],
      blazor: ['@page', '@inject', 'StateHasChanged', 'RenderFragment'],
      efcore: ['DbContext', 'DbSet', 'OnModelCreating', 'Entity Framework']
    }
  },
  sql: {
    keywords: ['SELECT ', 'INSERT ', 'UPDATE ', 'DELETE ', 'FROM ', 'WHERE ', 'JOIN ', 'CREATE TABLE', 'ALTER TABLE', 'DROP ', 'INDEX '],
    patterns: [/SELECT\s+[\w*,\s]+\s+FROM/i, /INSERT\s+INTO\s+\w+/i, /UPDATE\s+\w+\s+SET/i, /CREATE\s+TABLE/i],
    extensions: ['.sql'],
    frameworks: {
      postgresql: ['SERIAL', 'RETURNING', 'ON CONFLICT', '::'],
      mysql: ['AUTO_INCREMENT', 'ENGINE=InnoDB', 'LIMIT'],
      sqlite: ['INTEGER PRIMARY KEY', 'AUTOINCREMENT']
    }
  },
  shell: {
    keywords: ['#!/bin/bash', '#!/bin/sh', 'echo ', 'export ', 'source ', 'chmod ', 'sudo ', 'apt ', 'brew ', 'npm ', 'yarn ', 'git ', 'docker ', 'curl ', 'wget '],
    patterns: [/^\s*\$\s+/, /\|\s*grep/, /&&\s*/, /\$\{?\w+\}?/, /if\s*\[\s*.*\s*\]/],
    extensions: ['.sh', '.bash', '.zsh'],
    frameworks: {}
  }
};

const ERROR_SIGNATURES = [
  { type: 'stack_trace', pattern: /(?:Traceback|at\s+[\w.$]+\s*\(.*?:\d+(?::\d+)?\))/i, importance: 0.9 },
  { type: 'exception', pattern: /(?:Error|Exception|Failure):\s*.+/i, importance: 0.85 },
  { type: 'syntax', pattern: /(?:SyntaxError|ParseError|Unexpected\s+token)/i, importance: 0.8 },
  { type: 'type', pattern: /(?:TypeError|cannot read|undefined is not|null is not)/i, importance: 0.8 },
  { type: 'reference', pattern: /(?:ReferenceError|is not defined|NameError)/i, importance: 0.8 },
  { type: 'http', pattern: /(?:4\d{2}|5\d{2})\s+(?:error|Error|Bad|Not Found|Forbidden|Unauthorized|Internal)/i, importance: 0.75 },
  { type: 'compile', pattern: /(?:compile|build|compilation)\s*(?:error|failed)/i, importance: 0.85 },
  { type: 'runtime', pattern: /(?:runtime|segmentation|memory)\s*(?:error|fault)/i, importance: 0.9 },
  { type: 'assertion', pattern: /(?:AssertionError|assert|expect.*to)/i, importance: 0.7 },
  { type: 'warning', pattern: /(?:Warning|Deprecat)/i, importance: 0.5 }
];

const TOPIC_KEYWORDS = {
  'web development': ['frontend', 'backend', 'fullstack', 'api', 'rest', 'graphql', 'http', 'server', 'client', 'browser', 'html', 'css', 'dom'],
  'machine learning': ['ml', 'ai', 'neural', 'model', 'training', 'dataset', 'prediction', 'classification', 'deep learning', 'tensorflow', 'pytorch'],
  'database': ['database', 'sql', 'query', 'table', 'schema', 'migration', 'orm', 'crud', 'index', 'transaction', 'postgresql', 'mysql', 'mongodb'],
  'devops': ['docker', 'kubernetes', 'k8s', 'ci/cd', 'pipeline', 'deploy', 'container', 'aws', 'azure', 'terraform', 'helm', 'jenkins'],
  'security': ['authentication', 'authorization', 'oauth', 'jwt', 'token', 'encryption', 'hash', 'password', 'vulnerability', 'xss', 'csrf'],
  'testing': ['test', 'unit test', 'integration', 'e2e', 'mock', 'assert', 'coverage', 'tdd', 'jest', 'pytest', 'mocha'],
  'mobile': ['ios', 'android', 'react native', 'flutter', 'mobile', 'app', 'swift', 'kotlin', 'xcode'],
  'data science': ['data', 'analysis', 'visualization', 'statistics', 'pandas', 'numpy', 'jupyter', 'chart', 'plot'],
  'performance': ['optimization', 'performance', 'latency', 'throughput', 'caching', 'profiling', 'benchmark', 'memory leak']
};

// ============================================================================
// MEMORY EXTRACTOR CLASS
// ============================================================================

export class MemoryExtractor {
  constructor(graph = memoryGraph) {
    this.graph = graph;
    this.lastExtraction = null;
    this.extractionCount = 0;
  }

  /**
   * Main extraction method - processes text and populates the graph
   */
  extract(text, metadata = {}) {
    if (!text || text.length < 20) return null;

    const platform = metadata.platform || this._detectPlatform();
    const sessionId = this.graph.activeSession?.id;

    const extraction = {
      timestamp: Date.now(),
      platform,
      sessionId,
      entities: {
        languages: [],
        frameworks: [],
        codeBlocks: [],
        errors: [],
        topics: [],
        files: [],
        functions: [],
        classes: [],
        urls: [],
        goals: []
      },
      nodes: [],
      edges: []
    };

    // Run all extractors
    this._extractLanguages(text, extraction, metadata);
    this._extractCodeBlocks(text, extraction, metadata);
    this._extractFrameworks(text, extraction, metadata);
    this._extractErrors(text, extraction, metadata);
    this._extractTopics(text, extraction, metadata);
    this._extractEntities(text, extraction, metadata);
    this._extractGoals(text, extraction, metadata);

    // Build relationships between extracted nodes
    this._buildRelationships(extraction);

    // Update session context
    if (this.graph.activeSession && extraction.entities.languages.length > 0) {
      this.graph.activeSession.updateInferredContext({
        language: extraction.entities.languages[0]?.name,
        framework: extraction.entities.frameworks[0]?.name,
        topic: extraction.entities.topics[0]?.name
      });
    }

    this.lastExtraction = extraction;
    this.extractionCount++;

    return extraction;
  }

  /**
   * Detect programming languages with confidence scores
   */
  _extractLanguages(text, extraction, metadata) {
    const scores = {};
    const lower = text.toLowerCase();

    for (const [lang, sig] of Object.entries(LANGUAGE_SIGNATURES)) {
      let score = 0;

      // Keyword matching (weight: 2)
      for (const kw of sig.keywords) {
        const count = (text.match(new RegExp(this._escapeRegex(kw), 'g')) || []).length;
        score += count * 2;
      }

      // Pattern matching (weight: 3)
      for (const pat of sig.patterns) {
        if (pat.test(text)) score += 3;
      }

      // Extension matching (weight: 5)
      for (const ext of sig.extensions) {
        if (lower.includes(ext)) score += 5;
      }

      if (score > 0) scores[lang] = score;
    }

    // Convert to ranked list
    const ranked = Object.entries(scores)
      .map(([name, score]) => ({
        name,
        confidence: Math.min(score / 30, 1.0),
        score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    extraction.entities.languages = ranked;

    // Add to graph
    for (const lang of ranked) {
      if (lang.confidence >= 0.3) {
        const node = this.graph.addNode(NodeType.LANGUAGE, lang.name, {
          confidence: lang.confidence,
          importance: 0.5 + (lang.confidence * 0.3),
          platform: extraction.platform,
          source: 'extraction'
        });
        extraction.nodes.push(node);
      }
    }
  }

  /**
   * Extract code blocks with language detection
   */
  _extractCodeBlocks(text, extraction, metadata) {
    // Fenced code blocks
    const fencedRegex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    let blockIndex = 0;

    while ((match = fencedRegex.exec(text)) !== null) {
      const declaredLang = match[1] || 'unknown';
      const code = match[2].trim();

      if (code.length < 10) continue;

      // Detect language if not declared
      let detectedLang = declaredLang;
      let confidence = declaredLang !== 'unknown' ? 0.9 : 0.5;

      if (declaredLang === 'unknown' || declaredLang === '') {
        const langScores = this._scoreLanguage(code);
        if (langScores.length > 0) {
          detectedLang = langScores[0].name;
          confidence = langScores[0].confidence;
        }
      }

      const block = {
        code,
        language: detectedLang,
        confidence,
        index: blockIndex++,
        length: code.length,
        lines: code.split('\n').length
      };

      extraction.entities.codeBlocks.push(block);

      // Add to graph
      const node = this.graph.addNode(NodeType.CODE_BLOCK, code.substring(0, 500), {
        language: detectedLang,
        confidence,
        importance: 0.6,
        platform: extraction.platform,
        source: 'extraction',
        fullLength: code.length
      });
      extraction.nodes.push(node);

      // Update session stats
      if (this.graph.activeSession) {
        this.graph.activeSession.codeBlockCount++;
      }
    }
  }

  /**
   * Detect frameworks and libraries
   */
  _extractFrameworks(text, extraction, metadata) {
    const detected = [];
    const lower = text.toLowerCase();

    // Check each language's frameworks
    for (const [lang, sig] of Object.entries(LANGUAGE_SIGNATURES)) {
      for (const [framework, indicators] of Object.entries(sig.frameworks || {})) {
        let matchCount = 0;
        for (const indicator of indicators) {
          if (lower.includes(indicator.toLowerCase())) {
            matchCount++;
          }
        }

        if (matchCount >= 1) {
          const confidence = Math.min(matchCount / indicators.length + 0.3, 1.0);
          detected.push({
            name: framework,
            language: lang,
            confidence,
            matchCount
          });
        }
      }
    }

    // Deduplicate and sort
    const unique = detected
      .sort((a, b) => b.confidence - a.confidence)
      .filter((fw, i, arr) => arr.findIndex(f => f.name === fw.name) === i)
      .slice(0, 5);

    extraction.entities.frameworks = unique;

    // Add to graph
    for (const fw of unique) {
      if (fw.confidence >= 0.4) {
        const node = this.graph.addNode(NodeType.FRAMEWORK, fw.name, {
          language: fw.language,
          confidence: fw.confidence,
          importance: 0.6,
          platform: extraction.platform,
          source: 'extraction'
        });
        extraction.nodes.push(node);

        // Link to language
        const langNode = extraction.nodes.find(n =>
          n.type === NodeType.LANGUAGE && n.content === fw.language
        );
        if (langNode) {
          const edge = this.graph.addEdge(node.id, langNode.id, EdgeType.PART_OF);
          if (edge) extraction.edges.push(edge);
        }
      }
    }
  }

  /**
   * Extract error messages and stack traces
   */
  _extractErrors(text, extraction, metadata) {
    const errors = [];

    for (const sig of ERROR_SIGNATURES) {
      const matches = text.match(new RegExp(sig.pattern.source, 'gi')) || [];

      for (const match of matches.slice(0, 3)) {
        // Get context around the error
        const idx = text.indexOf(match);
        const contextStart = Math.max(0, idx - 100);
        const contextEnd = Math.min(text.length, idx + match.length + 200);
        const context = text.substring(contextStart, contextEnd);

        errors.push({
          type: sig.type,
          message: match.trim().substring(0, 200),
          context: context.trim(),
          importance: sig.importance
        });
      }
    }

    // Deduplicate similar errors
    const unique = errors.filter((err, i, arr) =>
      arr.findIndex(e => e.message === err.message) === i
    ).slice(0, 5);

    extraction.entities.errors = unique;

    // Add to graph
    for (const error of unique) {
      const node = this.graph.addNode(NodeType.ERROR, error.message, {
        errorType: error.type,
        context: error.context,
        confidence: 0.85,
        importance: error.importance,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);

      // Update session stats
      if (this.graph.activeSession) {
        this.graph.activeSession.errorCount++;
      }
    }
  }

  /**
   * Detect discussion topics
   */
  _extractTopics(text, extraction, metadata) {
    const lower = text.toLowerCase();
    const topics = [];

    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      let matchCount = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) matchCount++;
      }

      if (matchCount >= 2) {
        topics.push({
          name: topic,
          confidence: Math.min(matchCount / keywords.length + 0.2, 1.0),
          matchCount
        });
      }
    }

    const ranked = topics
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    extraction.entities.topics = ranked;

    // Add to graph
    for (const topic of ranked) {
      const node = this.graph.addNode(NodeType.TOPIC, topic.name, {
        confidence: topic.confidence,
        importance: 0.4,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }
  }

  /**
   * Extract file names, functions, classes, URLs
   */
  _extractEntities(text, extraction, metadata) {
    // Files
    const filePattern = /[\w-]+\.(?:js|ts|tsx|jsx|py|rb|go|rs|java|cpp|c|h|css|scss|html|json|yaml|yml|md|sql|vue|svelte|kt|swift)/gi;
    const files = [...new Set((text.match(filePattern) || []))].slice(0, 10);
    extraction.entities.files = files;

    for (const file of files) {
      const node = this.graph.addNode(NodeType.FILE, file, {
        importance: 0.5,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }

    // Functions
    const funcPattern = /(?:function|def|fn|func|fun)\s+(\w+)\s*\(/g;
    const functions = [];
    let funcMatch;
    while ((funcMatch = funcPattern.exec(text)) !== null) {
      if (funcMatch[1] && funcMatch[1].length > 2 && !functions.includes(funcMatch[1])) {
        functions.push(funcMatch[1]);
      }
    }
    extraction.entities.functions = functions.slice(0, 10);

    for (const func of extraction.entities.functions) {
      const node = this.graph.addNode(NodeType.FUNCTION, func, {
        importance: 0.45,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }

    // Classes (PascalCase identifiers)
    const classPattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    const commonWords = ['JavaScript', 'TypeScript', 'PostgreSQL', 'MongoDB', 'GraphQL', 'NextJS', 'NodeJS'];
    const classes = [];
    let classMatch;
    while ((classMatch = classPattern.exec(text)) !== null) {
      const name = classMatch[1];
      if (!commonWords.includes(name) && !classes.includes(name)) {
        classes.push(name);
      }
    }
    extraction.entities.classes = classes.slice(0, 10);

    for (const cls of extraction.entities.classes) {
      const node = this.graph.addNode(NodeType.CLASS, cls, {
        importance: 0.5,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }

    // URLs
    const urlPattern = /https?:\/\/[^\s<>"']+/g;
    const urls = [...new Set((text.match(urlPattern) || []))].slice(0, 10);
    extraction.entities.urls = urls;

    for (const url of urls) {
      const node = this.graph.addNode(NodeType.URL, url, {
        importance: 0.35,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }
  }

  /**
   * Extract user goals and intents
   */
  _extractGoals(text, extraction, metadata) {
    const goalPatterns = [
      /(?:i want to|i need to|help me|i'm trying to|how (?:do i|can i|to))\s+([^.?!]{5,100})/gi,
      /(?:build|create|make|implement|fix|debug|optimize|refactor)\s+(?:a |an |the )?([^.?!]{5,100})/gi,
      /(?:working on|developing|building)\s+(?:a |an |the )?([^.?!]{5,100})/gi
    ];

    const goals = [];

    for (const pattern of goalPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const goal = match[1].trim();
        if (goal.length > 5 && goal.length < 100 && !goals.includes(goal)) {
          goals.push(goal);
        }
      }
    }

    extraction.entities.goals = goals.slice(0, 3);

    // Add to graph
    for (const goal of extraction.entities.goals) {
      const node = this.graph.addNode(NodeType.GOAL, goal, {
        importance: 0.7,
        confidence: 0.6,
        platform: extraction.platform,
        source: 'extraction'
      });
      extraction.nodes.push(node);
    }
  }

  /**
   * Build relationships between extracted entities
   */
  _buildRelationships(extraction) {
    const { nodes } = extraction;

    // Find nodes by type
    const byType = (type) => nodes.filter(n => n.type === type);

    const languages = byType(NodeType.LANGUAGE);
    const frameworks = byType(NodeType.FRAMEWORK);
    const codeBlocks = byType(NodeType.CODE_BLOCK);
    const errors = byType(NodeType.ERROR);
    const files = byType(NodeType.FILE);
    const functions = byType(NodeType.FUNCTION);
    const classes = byType(NodeType.CLASS);
    const goals = byType(NodeType.GOAL);
    const topics = byType(NodeType.TOPIC);

    // Code blocks USE languages
    for (const code of codeBlocks) {
      const lang = code.metadata?.language;
      const langNode = languages.find(n => n.content === lang);
      if (langNode) {
        const edge = this.graph.addEdge(code.id, langNode.id, EdgeType.USES);
        if (edge) extraction.edges.push(edge);
      }
    }

    // Errors might be CAUSED_BY code blocks
    for (const error of errors) {
      if (codeBlocks.length > 0) {
        // Link to most recent code block
        const recentCode = codeBlocks[codeBlocks.length - 1];
        const edge = this.graph.addEdge(error.id, recentCode.id, EdgeType.RELATED_TO);
        if (edge) extraction.edges.push(edge);
      }
    }

    // Files CONTAIN functions and classes
    for (const file of files) {
      const ext = file.content.split('.').pop();

      // Link to matching language
      const langMap = { js: 'javascript', ts: 'typescript', py: 'python', rs: 'rust', go: 'go', java: 'java' };
      const lang = langMap[ext];
      if (lang) {
        const langNode = languages.find(n => n.content === lang);
        if (langNode) {
          const edge = this.graph.addEdge(file.id, langNode.id, EdgeType.USES);
          if (edge) extraction.edges.push(edge);
        }
      }
    }

    // Goals RELATED_TO topics
    for (const goal of goals) {
      for (const topic of topics) {
        const edge = this.graph.addEdge(goal.id, topic.id, EdgeType.RELATED_TO, {
          bidirectional: true
        });
        if (edge) extraction.edges.push(edge);
      }
    }

    // Languages RELATED_TO frameworks (already linked in _extractFrameworks)
    // Additional cross-linking for topics to languages
    for (const topic of topics) {
      if (languages.length > 0) {
        const edge = this.graph.addEdge(topic.id, languages[0].id, EdgeType.RELATED_TO);
        if (edge) extraction.edges.push(edge);
      }
    }
  }

  /**
   * Helper: Score text for language detection
   */
  _scoreLanguage(text) {
    const scores = {};

    for (const [lang, sig] of Object.entries(LANGUAGE_SIGNATURES)) {
      let score = 0;

      for (const kw of sig.keywords) {
        if (text.includes(kw)) score += 2;
      }

      for (const pat of sig.patterns) {
        if (pat.test(text)) score += 3;
      }

      if (score > 0) scores[lang] = score;
    }

    return Object.entries(scores)
      .map(([name, score]) => ({ name, confidence: Math.min(score / 20, 1.0), score }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Helper: Detect current platform
   */
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

  /**
   * Helper: Escape regex special characters
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get extraction statistics
   */
  getStats() {
    return {
      extractionCount: this.extractionCount,
      lastExtraction: this.lastExtraction ? {
        timestamp: this.lastExtraction.timestamp,
        entityCounts: {
          languages: this.lastExtraction.entities.languages.length,
          frameworks: this.lastExtraction.entities.frameworks.length,
          codeBlocks: this.lastExtraction.entities.codeBlocks.length,
          errors: this.lastExtraction.entities.errors.length,
          topics: this.lastExtraction.entities.topics.length,
          goals: this.lastExtraction.entities.goals.length
        },
        nodesCreated: this.lastExtraction.nodes.length,
        edgesCreated: this.lastExtraction.edges.length
      } : null
    };
  }
}

// Export singleton
export const memoryExtractor = new MemoryExtractor();
