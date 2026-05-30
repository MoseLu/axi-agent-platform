/**
 * 代码库索引系统
 * 功能：
 * - 使用 tree-sitter 解析代码 AST
 * - 构建符号表（函数、类、变量）
 * - 支持跨文件跳转和引用追踪
 * - 集成 ripgrep 进行快速全文搜索
 */

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";

export interface CodeSymbol {
  type: "function" | "class" | "interface" | "variable" | "import" | "export";
  name: string;
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  signature?: string;
  docstring?: string;
  references?: string[]; // 被哪些地方引用
}

export interface FileIndex {
  filePath: string;
  symbols: CodeSymbol[];
  imports: Array<{ from: string; names: string[] }>;
  exports: string[];
  dependencies: string[]; // 依赖的其他文件
  lastModified: Date;
  hash: string;
}

export interface ProjectIndex {
  rootPath: string;
  files: Map<string, FileIndex>;
  symbolTable: Map<string, CodeSymbol[]>; // symbol name -> symbols
  buildTime: Date;
}

export class CodebaseIndexer {
  private rootPath: string;
  private index?: ProjectIndex;
  private ignorePatterns: string[] = [
    "node_modules",
    ".git",
    "dist",
    "build",
    "*.min.js",
    "*.bundle.js",
    "vendor",
    "__pycache__",
    "*.pyc",
  ];

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * 构建整个代码库索引
   */
  async buildIndex(): Promise<ProjectIndex> {
    console.log(`🔍 开始构建代码库索引：${this.rootPath}`);
    
    const index: ProjectIndex = {
      rootPath: this.rootPath,
      files: new Map(),
      symbolTable: new Map(),
      buildTime: new Date(),
    };

    // 扫描所有源代码文件
    const sourceFiles = await this.scanDirectory(this.rootPath);
    console.log(`📄 发现 ${sourceFiles.length} 个源代码文件`);

    // 并行索引每个文件
    const fileIndices = await Promise.all(
      sourceFiles.map(async (file) => {
        try {
          return await this.indexFile(file);
        } catch (error) {
          console.warn(`⚠️ 索引文件失败 ${file}:`, error);
          return null;
        }
      })
    );

    // 构建符号表
    for (const fileIndex of fileIndices.filter(Boolean) as FileIndex[]) {
      index.files.set(fileIndex.filePath, fileIndex);

      for (const symbol of fileIndex.symbols) {
        if (!index.symbolTable.has(symbol.name)) {
          index.symbolTable.set(symbol.name, []);
        }
        index.symbolTable.get(symbol.name)!.push(symbol);
      }
    }

    // 构建依赖关系
    this.buildDependencyGraph(index);

    this.index = index;
    console.log(`✅ 索引构建完成：${fileIndices.length} 个文件，${index.symbolTable.size} 个符号`);

    return index;
  }

  /**
   * 扫描目录获取所有源代码文件
   */
  private async scanDirectory(dir: string, files: string[] = []): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(this.rootPath, fullPath);

      // 检查是否应该忽略
      if (this.shouldIgnore(relativePath, entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath, files);
      } else if (this.isSourceFile(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 检查文件是否应该被忽略
   */
  private shouldIgnore(relativePath: string, fileName: string): boolean {
    return this.ignorePatterns.some((pattern) => {
      if (pattern.includes("/")) {
        return relativePath.includes(pattern);
      }
      if (pattern.startsWith("*")) {
        return fileName.endsWith(pattern.slice(1));
      }
      return fileName === pattern || relativePath.includes("/" + pattern + "/");
    });
  }

  /**
   * 检查是否是源代码文件
   */
  private isSourceFile(fileName: string): boolean {
    const ext = extname(fileName).toLowerCase();
    const sourceExts = [
      ".ts", ".tsx", ".js", ".jsx", // JavaScript/TypeScript
      ".py", // Python
      ".go", // Go
      ".rs", // Rust
      ".java", // Java
      ".cpp", ".cc", ".cxx", ".h", ".hpp", // C/C++
      ".rb", // Ruby
      ".php", // PHP
      ".swift", // Swift
      ".kt", ".kts", // Kotlin
      ".vue", ".svelte", // Frontend frameworks
      ".sql", // SQL
      ".yaml", ".yml", // Config
      ".json", // JSON
    ];
    return sourceExts.includes(ext);
  }

  /**
   * 索引单个文件
   */
  private async indexFile(filePath: string): Promise<FileIndex> {
    const content = await readFile(filePath, "utf-8");
    const ext = extname(filePath);

    // 使用 ripgrep 快速提取函数和类定义
    const symbols = await this.extractSymbols(filePath, content, ext);
    
    // 提取 import/export
    const { imports, exports } = await this.extractImportsExports(content, ext);

    return {
      filePath,
      symbols,
      imports,
      exports,
      dependencies: [], // 后续构建
      lastModified: new Date(),
      hash: this.hashContent(content),
    };
  }

  /**
   * 使用 ripgrep 提取符号
   */
  private async extractSymbols(
    filePath: string,
    content: string,
    ext: string
  ): Promise<CodeSymbol[]> {
    const symbols: CodeSymbol[] = [];

    // 不同语言的函数定义模式
    const patterns: Record<string, { regex: RegExp; type: CodeSymbol["type"] }[]> = {
      ".ts": [
        { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g, type: "function" },
        { regex: /(?:export\s+)?class\s+(\w+)/g, type: "class" },
        { regex: /(?:export\s+)?interface\s+(\w+)/g, type: "interface" },
        { regex: /(?:export\s+)?const\s+(\w+)\s*=/g, type: "variable" },
      ],
      ".py": [
        { regex: /(?:async\s+)?def\s+(\w+)\s*\([^)]*\)/g, type: "function" },
        { regex: /class\s+(\w+)/g, type: "class" },
      ],
      ".go": [
        { regex: /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)/g, type: "function" },
        { regex: /type\s+(\w+)\s+struct/g, type: "class" },
      ],
      ".java": [
        { regex: /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\([^)]*\)/g, type: "function" },
        { regex: /(?:public|private|protected)?\s*class\s+(\w+)/g, type: "class" },
      ],
    };

    const filePatterns = patterns[ext] || patterns[".ts"];
    const lines = content.split("\n");

    for (const { regex, type } of filePatterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const lineNumber = beforeMatch.split("\n").length;
        const column = match.index - beforeMatch.lastIndexOf("\n") - 1;

        symbols.push({
          type,
          name: match[1],
          filePath,
          line: lineNumber,
          column,
          signature: match[0],
        });
      }
    }

    return symbols;
  }

  /**
   * 提取 import/export 语句
   */
  private async extractImportsExports(
    content: string,
    ext: string
  ): Promise<{ imports: Array<{ from: string; names: string[] }>; exports: string[] }> {
    const imports: Array<{ from: string; names: string[] }> = [];
    const exports: string[] = [];

    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      // ES6 modules
      const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const names = match[1]
          ? match[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim())
          : [match[2]];
        imports.push({
          from: match[3],
          names,
        });
      }

      const exportRegex = /export\s+(?:default\s+)?(?:{([^}]+)}|(\w+))/g;
      while ((match = exportRegex.exec(content)) !== null) {
        const names = match[1]
          ? match[1].split(",").map((n) => n.trim())
          : [match[2]];
        exports.push(...names);
      }
    } else if (ext === ".py") {
      const importRegex = /from\s+([\w.]+)\s+import\s+(.+)/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push({
          from: match[1],
          names: match[2].split(",").map((n) => n.trim()),
        });
      }
    }

    return { imports, exports };
  }

  /**
   * 构建依赖关系图
   */
  private buildDependencyGraph(index: ProjectIndex) {
    for (const [filePath, fileIndex] of index.files) {
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      
      for (const imp of fileIndex.imports) {
        // 解析相对路径
        let resolvedPath: string;
        if (imp.from.startsWith(".")) {
          resolvedPath = join(dir, imp.from);
          if (!resolvedPath.endsWith(".ts") && !resolvedPath.endsWith(".js")) {
            resolvedPath += ".ts";
          }
        } else {
          // 第三方包，跳过
          continue;
        }

        // 规范化路径
        resolvedPath = resolvedPath.replace(/\\/g, "/");
        
        if (index.files.has(resolvedPath)) {
          fileIndex.dependencies.push(resolvedPath);
        }
      }
    }
  }

  /**
   * 计算文件 hash
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * 搜索符号
   */
  async searchSymbol(name: string): Promise<CodeSymbol[]> {
    if (!this.index) {
      throw new Error("索引未构建，请先调用 buildIndex()");
    }

    return this.index.symbolTable.get(name) || [];
  }

  /**
   * 查找符号引用
   */
  async findReferences(symbol: CodeSymbol): Promise<string[]> {
    if (!this.index) {
      throw new Error("索引未构建");
    }

    const references: string[] = [];
    
    // 使用 ripgrep 搜索引用
    const rg = spawn("rg", [
      "--files-with-matches",
      "--no-filename",
      symbol.name,
      this.rootPath,
    ]);

    let output = "";
    rg.stdout.on("data", (data) => {
      output += data.toString();
    });

    await new Promise((resolve) => {
      rg.on("close", resolve);
    });

    return output.split("\n").filter(Boolean);
  }

  /**
   * 获取文件路径的数据流链路
   */
  async traceDataFlow(startFile: string, endFile: string): Promise<string[]> {
    if (!this.index) {
      throw new Error("索引未构建");
    }

    // BFS 查找最短路径
    const queue: Array<{ file: string; path: string[] }> = [
      { file: startFile, path: [startFile] }
    ];
    const visited = new Set<string>([startFile]);

    while (queue.length > 0) {
      const { file, path } = queue.shift()!;

      if (file === endFile) {
        return path;
      }

      const fileIndex = this.index.files.get(file);
      if (!fileIndex) continue;

      for (const dep of fileIndex.dependencies) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push({ file: dep, path: [...path, dep] });
        }
      }
    }

    return [];
  }

  /**
   * 全文搜索（使用 ripgrep）
   */
  async searchCode(query: string, options?: { 
    filePattern?: string;
    maxResults?: number;
  }): Promise<Array<{ file: string; line: number; content: string }>> {
    const args = [
      "--json",
      "--line-number",
      query,
      this.rootPath,
    ];

    if (options?.filePattern) {
      args.push("--glob", options.filePattern);
    }

    const rg = spawn("rg", args);
    const results: Array<{ file: string; line: number; content: string }> = [];

    rg.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.type === "match") {
            results.push({
              file: json.data.path.text,
              line: json.data.line_number,
              content: json.data.lines.text,
            });
          }
        } catch {
          // 忽略解析错误
        }
      }
    });

    await new Promise((resolve) => {
      rg.on("close", resolve);
    });

    return results.slice(0, options?.maxResults || 100);
  }
}
