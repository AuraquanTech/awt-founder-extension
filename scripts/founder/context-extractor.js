/**
 * Smart Context Injection - ContextExtractor
 * ===========================================
 * THE KILLER FEATURE: Extracts intelligence from current conversation
 * Auto-fills prompt variables with contextual awareness
 *
 * Detects: languages, frameworks, code blocks, errors, topics, entities
 */

const LANGUAGE_PATTERNS = {
  python: {
    keywords: ["python", "pip", "django", "flask", "fastapi", "pandas", "numpy", "def ", "import ", "__init__", "self."],
    codePatterns: [/def\s+\w+\s*\(/, /import\s+\w+/, /from\s+\w+\s+import/, /if\s+__name__\s*==/],
    frameworks: ["django", "flask", "fastapi", "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "keras"]
  },
  javascript: {
    keywords: ["javascript", "node", "npm", "yarn", "react", "vue", "angular", "express", "const ", "let ", "var ", "=> ", "async ", "await "],
    codePatterns: [/const\s+\w+\s*=/, /let\s+\w+\s*=/, /function\s+\w+\s*\(/, /=>\s*\{/, /async\s+function/, /\.then\s*\(/],
    frameworks: ["react", "vue", "angular", "express", "next.js", "nuxt", "svelte", "nest.js", "electron"]
  },
  typescript: {
    keywords: ["typescript", ".ts", ".tsx", "interface ", "type ", ": string", ": number", ": boolean", "as const", "readonly"],
    codePatterns: [/interface\s+\w+/, /type\s+\w+\s*=/, /:\s*(string|number|boolean|any)/, /<\w+>/],
    frameworks: ["angular", "nest.js", "next.js", "deno"]
  },
  rust: {
    keywords: ["rust", "cargo", "rustc", "fn ", "let mut", "impl ", "struct ", "enum ", "&str", "&self", ".rs", "Vec<", "Option<", "Result<"],
    codePatterns: [/fn\s+\w+\s*\(/, /let\s+mut\s+/, /impl\s+\w+/, /struct\s+\w+/, /enum\s+\w+/],
    frameworks: ["tokio", "actix", "rocket", "axum", "warp", "diesel"]
  },
  go: {
    keywords: ["golang", "go ", "func ", "package ", "import (", "go.mod", ":= ", "err != nil", ".go"],
    codePatterns: [/func\s+\w+\s*\(/, /package\s+\w+/, /import\s+\(/, /if\s+err\s*!=\s*nil/],
    frameworks: ["gin", "echo", "fiber", "chi", "gorilla"]
  },
  java: {
    keywords: ["java", "maven", "gradle", "spring", "public class", "private ", "void ", ".java", "System.out", "@Override", "@Autowired"],
    codePatterns: [/public\s+class\s+\w+/, /private\s+\w+\s+\w+/, /public\s+static\s+void\s+main/],
    frameworks: ["spring", "spring boot", "hibernate", "maven", "gradle", "junit"]
  },
  csharp: {
    keywords: ["c#", "csharp", ".net", "dotnet", "asp.net", "public class", "namespace ", "using ", ".cs", "async Task"],
    codePatterns: [/public\s+class\s+\w+/, /namespace\s+\w+/, /using\s+\w+;/, /async\s+Task/],
    frameworks: [".net", "asp.net", "entity framework", "blazor", "xamarin"]
  },
  php: {
    keywords: ["php", "laravel", "symfony", "composer", "<?php", "function ", "->", ".php", "namespace "],
    codePatterns: [/<\?php/, /function\s+\w+\s*\(/, /\$\w+\s*=/, /\$this->/],
    frameworks: ["laravel", "symfony", "wordpress", "drupal"]
  },
  ruby: {
    keywords: ["ruby", "rails", "gem ", "bundler", "def ", "end", "class ", "module ", ".rb", "rake"],
    codePatterns: [/def\s+\w+/, /class\s+\w+/, /module\s+\w+/, /do\s*\|/],
    frameworks: ["rails", "sinatra", "rspec", "sidekiq"]
  },
  sql: {
    keywords: ["sql", "mysql", "postgresql", "postgres", "sqlite", "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "FROM ", "WHERE ", "JOIN "],
    codePatterns: [/SELECT\s+.*\s+FROM/i, /INSERT\s+INTO/i, /UPDATE\s+\w+\s+SET/i, /CREATE\s+TABLE/i],
    frameworks: ["mysql", "postgresql", "mongodb", "redis", "sqlite", "oracle"]
  },
  shell: {
    keywords: ["bash", "shell", "terminal", "command line", "cli", "chmod", "sudo", "apt", "brew", "npm ", "git ", "docker ", "curl "],
    codePatterns: [/^\s*\$\s*/, /\|\s*grep/, /&&\s*/, /\|\|/],
    frameworks: ["bash", "zsh", "fish", "powershell"]
  },
  swift: {
    keywords: ["swift", "ios", "xcode", "swiftui", "uikit", "func ", "var ", "let ", "struct ", "@State", ".swift"],
    codePatterns: [/func\s+\w+\s*\(/, /var\s+\w+:/, /let\s+\w+:/, /struct\s+\w+/],
    frameworks: ["swiftui", "uikit", "combine", "alamofire"]
  },
  kotlin: {
    keywords: ["kotlin", "android", "fun ", "val ", "var ", "class ", "data class", ".kt", "suspend "],
    codePatterns: [/fun\s+\w+\s*\(/, /val\s+\w+\s*[:=]/, /var\s+\w+\s*[:=]/, /data\s+class/],
    frameworks: ["android", "ktor", "spring", "compose"]
  }
};

const ERROR_PATTERNS = [
  { type: "stacktrace", pattern: /(?:Traceback|Error|Exception|at\s+\w+\.\w+\(.*:\d+\))/i },
  { type: "error_message", pattern: /(?:error|failed|failure|exception|cannot|unable|invalid|undefined|null|crashed)[:.\s]/i },
  { type: "http_error", pattern: /(?:4\d{2}|5\d{2})\s*(?:error|bad|not found|forbidden|unauthorized)/i },
  { type: "syntax_error", pattern: /(?:syntax\s*error|parse\s*error|unexpected\s*token)/i },
  { type: "type_error", pattern: /(?:type\s*error|cannot read|undefined is not|null is not)/i },
  { type: "reference_error", pattern: /(?:reference\s*error|is not defined|cannot find)/i },
  { type: "compile_error", pattern: /(?:compile|build|compilation)\s*(?:error|failed)/i }
];

const TOPIC_PATTERNS = {
  "web development": ["frontend", "backend", "fullstack", "api", "rest", "graphql", "http", "server", "client", "browser"],
  "machine learning": ["ml", "ai", "neural", "model", "training", "dataset", "prediction", "classification", "deep learning"],
  "database": ["database", "sql", "query", "table", "schema", "migration", "orm", "crud", "index", "transaction"],
  "devops": ["docker", "kubernetes", "k8s", "ci/cd", "pipeline", "deploy", "container", "aws", "azure", "terraform"],
  "security": ["authentication", "authorization", "oauth", "jwt", "token", "encryption", "hash", "password", "vulnerability"],
  "testing": ["test", "unit test", "integration", "e2e", "mock", "assert", "coverage", "tdd", "spec"],
  "mobile": ["ios", "android", "react native", "flutter", "mobile", "app", "swift", "kotlin"],
  "data science": ["data", "analysis", "visualization", "statistics", "pandas", "numpy", "jupyter", "chart"]
};

export class ContextExtractor {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 5000;
  }

  getConversationText() {
    const selectors = [
      "[data-message-author-role] .markdown",
      "[data-message-author-role] .whitespace-pre-wrap",
      ".font-claude-message",
      ".prose",
      ".markdown-body",
      "[class*='message']",
      "[class*='Message']",
      ".model-response-text",
      ".response-content"
    ];

    let text = "";
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          text += el.textContent + "\n\n";
        });
        if (text.length > 100) break;
      } catch (e) {}
    }
    return text;
  }

  extractCodeBlocks(text) {
    const blocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        language: match[1] || "unknown",
        code: match[2].trim()
      });
    }
    return blocks;
  }

  detectLanguage(text) {
    const lower = text.toLowerCase();
    const scores = {};

    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      let score = 0;
      for (const kw of patterns.keywords) {
        if (lower.includes(kw.toLowerCase())) score += 2;
      }
      for (const pat of patterns.codePatterns) {
        if (pat.test(text)) score += 3;
      }
      for (const fw of patterns.frameworks) {
        if (lower.includes(fw.toLowerCase())) score += 4;
      }
      if (score > 0) scores[lang] = score;
    }

    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lang, score]) => ({
        language: lang,
        confidence: Math.min(score / 20, 1)
      }));
  }

  detectFrameworks(text) {
    const lower = text.toLowerCase();
    const detected = [];
    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      for (const fw of patterns.frameworks) {
        if (lower.includes(fw.toLowerCase())) {
          detected.push({ framework: fw, language: lang, confidence: 0.8 });
        }
      }
    }
    return detected;
  }

  extractErrors(text) {
    const errors = [];
    for (const { type, pattern } of ERROR_PATTERNS) {
      const matches = text.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        matches.slice(0, 3).forEach(m => {
          const idx = text.indexOf(m);
          const context = text.substring(
            Math.max(0, idx - 100),
            Math.min(text.length, idx + 300)
          );
          errors.push({
            type,
            message: m.trim(),
            context: context.trim()
          });
        });
      }
    }
    return errors.slice(0, 5);
  }

  detectTopics(text) {
    const lower = text.toLowerCase();
    const topics = [];
    for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
      const matches = keywords.filter(kw => lower.includes(kw)).length;
      if (matches >= 2) {
        topics.push({
          topic,
          confidence: Math.min(matches / keywords.length, 1)
        });
      }
    }
    return topics.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  extractEntities(text) {
    const entities = { files: [], functions: [], urls: [], classes: [] };

    // Files
    const fileMatches = text.match(/[\w-]+\.(js|ts|tsx|jsx|py|rb|go|rs|java|cpp|c|h|css|scss|html|json|yaml|yml|md|sql)/gi) || [];
    entities.files = [...new Set(fileMatches)].slice(0, 10);

    // Functions
    const funcRegex = /(?:function|def|fn|func)\s+(\w+)/g;
    let m;
    while ((m = funcRegex.exec(text)) !== null) {
      if (m[1] && m[1].length > 2) entities.functions.push(m[1]);
    }
    entities.functions = [...new Set(entities.functions)].slice(0, 10);

    // URLs
    entities.urls = (text.match(/https?:\/\/[^\s<>"]+/g) || []).slice(0, 10);

    // Classes (PascalCase)
    const classMatches = text.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g) || [];
    entities.classes = [...new Set(classMatches.filter(c =>
      !["JavaScript", "TypeScript", "PostgreSQL", "MongoDB"].includes(c)
    ))].slice(0, 10);

    return entities;
  }

  extractGoal(text) {
    const patterns = [
      /(?:i want to|i need to|help me|i'm trying to|how (?:do i|can i|to))\s+([^.?!]{5,80})/gi,
      /(?:build|create|make|implement|fix|debug|optimize|refactor)\s+(?:a |an |the )?([^.?!]{5,80})/gi,
      /(?:working on|developing|building)\s+(?:a |an |the )?([^.?!]{5,80})/gi
    ];

    const goals = [];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(text)) !== null) {
        if (m[1] && m[1].length > 5 && m[1].length < 100) {
          goals.push(m[1].trim());
        }
      }
    }
    return [...new Set(goals)].slice(0, 3);
  }

  extract() {
    const now = Date.now();
    if (this.cache && (now - this.cacheTime) < this.CACHE_TTL) {
      return this.cache;
    }

    const text = this.getConversationText();
    if (!text || text.length < 20) return null;

    const codeBlocks = this.extractCodeBlocks(text);
    const languages = this.detectLanguage(text);
    const frameworks = this.detectFrameworks(text);
    const errors = this.extractErrors(text);
    const topics = this.detectTopics(text);
    const entities = this.extractEntities(text);
    const goals = this.extractGoal(text);

    const lastCode = codeBlocks.length > 0 ? codeBlocks[codeBlocks.length - 1] : null;
    const lastError = errors.length > 0 ? errors[errors.length - 1] : null;

    const context = {
      // Primary values for auto-fill
      language: languages[0]?.language || null,
      languageConfidence: languages[0]?.confidence || 0,
      framework: frameworks[0]?.framework || null,
      frameworkConfidence: frameworks[0]?.confidence || 0,

      // Code
      code: lastCode?.code || null,
      codeLanguage: lastCode?.language || null,

      // Errors
      error: lastError?.message || null,
      errorContext: lastError?.context || null,

      // Topics & Goals
      topic: topics[0]?.topic || null,
      goal: goals[0] || null,

      // Entities
      files: entities.files,
      functions: entities.functions,
      urls: entities.urls,
      classes: entities.classes,

      // All detected
      allLanguages: languages,
      allFrameworks: frameworks,
      allErrors: errors,
      allTopics: topics,
      allGoals: goals,
      allCodeBlocks: codeBlocks,

      // Metadata
      extractedAt: now,
      conversationLength: text.length
    };

    this.cache = context;
    this.cacheTime = now;
    return context;
  }

  mapVariablesToContext(variables, context) {
    if (!context) return {};
    const mappings = {};

    for (const variable of variables) {
      const v = variable.toLowerCase();
      let value = null, confidence = 0, source = null;

      // Language mappings
      if (["language", "lang", "programming_language", "programminglanguage"].includes(v)) {
        if (context.language) {
          value = context.language.charAt(0).toUpperCase() + context.language.slice(1);
          confidence = context.languageConfidence;
          source = "language_detection";
        }
      }
      // Framework mappings
      else if (["framework", "library", "stack", "tech"].includes(v)) {
        if (context.framework) {
          value = context.framework;
          confidence = context.frameworkConfidence;
          source = "framework_detection";
        }
      }
      // Code mappings
      else if (["code", "snippet", "source", "sourcecode", "source_code", "codeblock"].includes(v)) {
        if (context.code) {
          value = context.code;
          confidence = 0.9;
          source = "code_extraction";
        }
      }
      // Error mappings
      else if (["error", "error_message", "errormessage", "exception", "bug", "issue"].includes(v)) {
        if (context.error) {
          value = context.error;
          confidence = 0.85;
          source = "error_extraction";
        }
      }
      // Topic mappings
      else if (["topic", "domain", "area", "subject", "context"].includes(v)) {
        if (context.topic) {
          value = context.topic;
          confidence = 0.7;
          source = "topic_detection";
        }
      }
      // Goal mappings
      else if (["goal", "task", "objective", "purpose", "intent"].includes(v)) {
        if (context.goal) {
          value = context.goal;
          confidence = 0.6;
          source = "goal_extraction";
        }
      }
      // File mappings
      else if (["file", "filename", "file_name", "path"].includes(v)) {
        if (context.files.length > 0) {
          value = context.files[0];
          confidence = 0.75;
          source = "entity_extraction";
        }
      }
      // Function mappings
      else if (["function", "method", "func", "function_name"].includes(v)) {
        if (context.functions.length > 0) {
          value = context.functions[0];
          confidence = 0.7;
          source = "entity_extraction";
        }
      }
      // URL mappings
      else if (["url", "link", "endpoint", "api"].includes(v)) {
        if (context.urls.length > 0) {
          value = context.urls[0];
          confidence = 0.8;
          source = "entity_extraction";
        }
      }
      // Class mappings
      else if (["class", "classname", "class_name", "component"].includes(v)) {
        if (context.classes.length > 0) {
          value = context.classes[0];
          confidence = 0.7;
          source = "entity_extraction";
        }
      }
      // From language (for conversions)
      else if (["fromlang", "from_lang", "sourcelang", "source_lang"].includes(v)) {
        if (context.language) {
          value = context.language.charAt(0).toUpperCase() + context.language.slice(1);
          confidence = context.languageConfidence;
          source = "language_detection";
        }
      }

      if (value) {
        mappings[variable] = {
          value,
          confidence,
          source,
          autoDetected: true
        };
      }
    }

    return mappings;
  }

  clearCache() {
    this.cache = null;
    this.cacheTime = 0;
  }
}

// Global singleton instance
export const contextExtractor = new ContextExtractor();
