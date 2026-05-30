/**
 * 项目分析工具
 * 扫描工作空间，识别所有项目并分析架构
 */

import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";

export interface ProjectInfo {
  name: string;
  path: string;
  type: "frontend" | "backend" | "fullstack" | "monorepo" | "library" | "unknown";
  techStack: {
    languages: string[];
    frameworks: string[];
    databases?: string[];
    buildTools?: string[];
  };
  structure: {
    hasSrc: boolean;
    hasTests: boolean;
    hasDocs: boolean;
    hasConfig: boolean;
    directories: string[];
  };
  packageJson?: {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  issues: ProjectIssue[];
}

export interface ProjectIssue {
  severity: "error" | "warning" | "info";
  category: "structure" | "dependency" | "config" | "security" | "performance";
  message: string;
  suggestion?: string;
}

export class ProjectAnalyzer {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 扫描工作空间所有项目
   */
  async scanProjects(): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];

    // 扫描根目录
    const rootEntries = await readdir(this.workspaceRoot, { withFileTypes: true });

    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      if (this.shouldIgnore(entry.name)) continue;

      const projectPath = join(this.workspaceRoot, entry.name);
      const project = await this.analyzeProject(projectPath);

      if (project) {
        projects.push(project);
      }
    }

    // 扫描子目录（深度 1 层）
    const subDirs = await this.scanSubDirectories();
    projects.push(...subDirs);

    return projects;
  }

  /**
   * 扫描子目录
   */
  private async scanSubDirectories(): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];
    const commonProjectDirs = ["apps", "packages", "services", "projects", "modules"];

    for (const subDir of commonProjectDirs) {
      const subPath = join(this.workspaceRoot, subDir);
      
      if (!existsSync(subPath)) continue;

      const entries = await readdir(subPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (this.shouldIgnore(entry.name)) continue;

        const projectPath = join(subPath, entry.name);
        const project = await this.analyzeProject(projectPath);

        if (project) {
          // 添加前缀
          project.name = `${subDir}/${project.name}`;
          projects.push(project);
        }
      }
    }

    return projects;
  }

  /**
   * 分析单个项目
   */
  private async analyzeProject(projectPath: string): Promise<ProjectInfo | null> {
    // 检查是否是项目目录
    const hasPackageJson = existsSync(join(projectPath, "package.json"));
    const hasRequirements = existsSync(join(projectPath, "requirements.txt"));
    const hasGoMod = existsSync(join(projectPath, "go.mod"));
    const hasCargo = existsSync(join(projectPath, "Cargo.toml"));
    const hasPom = existsSync(join(projectPath, "pom.xml"));

    if (!hasPackageJson && !hasRequirements && !hasGoMod && !hasCargo && !hasPom) {
      return null; // 不是项目目录
    }

    const relativePath = relative(this.workspaceRoot, projectPath);
    const name = relativePath.replace(/[\\/]/g, "/");

    // 分析 package.json
    let packageJson;
    if (hasPackageJson) {
      try {
        const content = await readFile(join(projectPath, "package.json"), "utf-8");
        packageJson = JSON.parse(content);
      } catch {
        // 忽略解析错误
      }
    }

    // 分析技术栈
    const techStack = await this.analyzeTechStack(projectPath, packageJson);

    // 分析结构
    const structure = await this.analyzeStructure(projectPath);

    // 检测问题
    const issues = await this.detectIssues(projectPath, packageJson, techStack, structure);

    // 确定项目类型
    const type = this.determineProjectType(techStack, structure);

    return {
      name,
      path: projectPath,
      type,
      techStack,
      structure,
      packageJson,
      issues,
    };
  }

  /**
   * 分析技术栈
   */
  private async analyzeTechStack(
    projectPath: string,
    packageJson?: any
  ): Promise<ProjectInfo["techStack"]> {
    const languages: string[] = [];
    const frameworks: string[] = [];
    const databases: string[] = [];
    const buildTools: string[] = [];

    // 检测语言
    const langFiles = await this.detectLanguageFiles(projectPath);
    languages.push(...langFiles);

    // 从 package.json 检测
    if (packageJson) {
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      const depNames = Object.keys(deps);

      // 框架
      if (depNames.includes("react")) frameworks.push("React");
      if (depNames.includes("vue")) frameworks.push("Vue");
      if (depNames.includes("@angular/core")) frameworks.push("Angular");
      if (depNames.includes("@nestjs/core")) frameworks.push("NestJS");
      if (depNames.includes("express")) frameworks.push("Express");
      if (depNames.includes("next")) frameworks.push("Next.js");
      if (depNames.includes("nuxt")) frameworks.push("Nuxt.js");

      // 构建工具
      if (depNames.includes("webpack")) buildTools.push("Webpack");
      if (depNames.includes("vite")) buildTools.push("Vite");
      if (depNames.includes("rollup")) buildTools.push("Rollup");
      if (depNames.includes("typescript")) buildTools.push("TypeScript");
    }

    // 检测数据库配置
    const dbConfigs = await this.detectDatabaseConfigs(projectPath);
    databases.push(...dbConfigs);

    return {
      languages: [...new Set(languages)],
      frameworks: [...new Set(frameworks)],
      databases: databases.length > 0 ? databases : undefined,
      buildTools: buildTools.length > 0 ? buildTools : undefined,
    };
  }

  /**
   * 检测语言文件
   */
  private async detectLanguageFiles(projectPath: string): Promise<string[]> {
    const languages: string[] = [];
    const langMap: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".go": "Go",
      ".rs": "Rust",
      ".java": "Java",
      ".cpp": "C++",
      ".c": "C",
      ".h": "C/C++",
      ".rb": "Ruby",
      ".php": "PHP",
      ".swift": "Swift",
      ".kt": "Kotlin",
      ".vue": "Vue",
      ".svelte": "Svelte",
    };

    try {
      const checkDir = async (dir: string) => {
        const entries = await readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (this.shouldIgnore(entry.name)) continue;

          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
              continue;
            }
            await checkDir(join(dir, entry.name));
          } else if (entry.isFile()) {
            const ext = entry.name.split(".").pop();
            if (ext && langMap[ext] && !languages.includes(langMap[ext])) {
              languages.push(langMap[ext]);
            }
          }
        }
      };

      await checkDir(projectPath);
    } catch {
      // 忽略错误
    }

    return languages;
  }

  /**
   * 检测数据库配置
   */
  private async detectDatabaseConfigs(projectPath: string): Promise<string[]> {
    const databases: string[] = [];

    try {
      // 检查常见配置文件
      const configFiles = [
        "package.json",
        "requirements.txt",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
      ];

      for (const configFile of configFiles) {
        const configPath = join(projectPath, configFile);
        if (!existsSync(configPath)) continue;

        const content = await readFile(configPath, "utf-8");

        if (content.includes("pg") || content.includes("postgres")) {
          databases.push("PostgreSQL");
        }
        if (content.includes("mysql") || content.includes("mysql2")) {
          databases.push("MySQL");
        }
        if (content.includes("mongodb") || content.includes("mongoose")) {
          databases.push("MongoDB");
        }
        if (content.includes("redis")) {
          databases.push("Redis");
        }
        if (content.includes("sqlite")) {
          databases.push("SQLite");
        }
        if (content.includes("typeorm") || content.includes("prisma") || content.includes("sequelize")) {
          databases.push("ORM");
        }
      }
    } catch {
      // 忽略错误
    }

    return databases;
  }

  /**
   * 分析项目结构
   */
  private async analyzeStructure(projectPath: string): Promise<ProjectInfo["structure"]> {
    const directories: string[] = [];
    let hasSrc = false;
    let hasTests = false;
    let hasDocs = false;
    let hasConfig = false;

    try {
      const entries = await readdir(projectPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirName = entry.name.toLowerCase();
        directories.push(entry.name);

        if (dirName === "src" || dirName === "source") hasSrc = true;
        if (dirName === "test" || dirName === "tests" || dirName === "__tests__") hasTests = true;
        if (dirName === "doc" || dirName === "docs" || dirName === "documentation") hasDocs = true;
        if (dirName === "config" || dirName === "configs" || dirName === "configuration") hasConfig = true;
      }
    } catch {
      // 忽略错误
    }

    return {
      hasSrc,
      hasTests,
      hasDocs,
      hasConfig,
      directories,
    };
  }

  /**
   * 检测项目问题
   */
  private async detectIssues(
    projectPath: string,
    packageJson?: any,
    techStack?: any,
    structure?: any
  ): Promise<ProjectIssue[]> {
    const issues: ProjectIssue[] = [];

    // 结构问题
    if (structure && !structure.hasSrc) {
      issues.push({
        severity: "warning",
        category: "structure",
        message: "缺少 src 目录，代码可能直接放在根目录",
        suggestion: "建议创建 src 目录组织源代码",
      });
    }

    if (structure && !structure.hasTests) {
      issues.push({
        severity: "warning",
        category: "structure",
        message: "缺少测试目录",
        suggestion: "建议添加测试目录和测试文件",
      });
    }

    // 依赖问题
    if (packageJson) {
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (Object.keys(deps).length === 0) {
        issues.push({
          severity: "warning",
          category: "dependency",
          message: "没有依赖项",
          suggestion: "检查 package.json 是否正确配置",
        });
      }

      // 检查过时的依赖
      if (deps["react"] && deps["react"].startsWith("15.")) {
        issues.push({
          severity: "error",
          category: "dependency",
          message: "React 版本过旧 (v15)",
          suggestion: "建议升级到 React 18",
        });
      }
    }

    // 配置问题
    if (!existsSync(join(projectPath, ".gitignore"))) {
      issues.push({
        severity: "warning",
        category: "config",
        message: "缺少 .gitignore 文件",
        suggestion: "建议添加 .gitignore 文件",
      });
    }

    if (!existsSync(join(projectPath, "README.md")) && !existsSync(join(projectPath, "readme.md"))) {
      issues.push({
        severity: "info",
        category: "config",
        message: "缺少 README 文档",
        suggestion: "建议添加 README.md 说明项目",
      });
    }

    return issues;
  }

  /**
   * 确定项目类型
   */
  private determineProjectType(
    techStack: any,
    structure: any
  ): ProjectInfo["type"] {
    const frameworks = techStack.frameworks || [];
    const directories = structure.directories || [];

    // Monorepo 检测
    if (directories.includes("packages") || directories.includes("apps")) {
      return "monorepo";
    }

    // Fullstack 检测
    const hasFrontend = frameworks.some((f: string) => ["React", "Vue", "Angular", "Next.js", "Nuxt.js"].includes(f));
    const hasBackend = frameworks.some((f: string) => ["NestJS", "Express", "Fastify"].includes(f));

    if (hasFrontend && hasBackend) {
      return "fullstack";
    }

    // Frontend 检测
    if (hasFrontend) {
      return "frontend";
    }

    // Backend 检测
    if (hasBackend) {
      return "backend";
    }

    // Library 检测
    if (structure.hasSrc && !structure.hasTests) {
      return "library";
    }

    return "unknown";
  }

  /**
   * 应该忽略的目录
   */
  private shouldIgnore(name: string): boolean {
    const ignored = [
      "node_modules",
      "dist",
      "build",
      ".git",
      ".svn",
      "vendor",
      "__pycache__",
      ".venv",
      "venv",
      "target",
      "out",
      ".next",
      ".nuxt",
      "coverage",
      ".idea",
      ".vscode",
    ];
    return ignored.includes(name.toLowerCase());
  }

  /**
   * 生成项目报告
   */
  generateReport(projects: ProjectInfo[]): string {
    const lines: string[] = [];

    lines.push(`📊 工作空间项目分析报告`);
    lines.push(`━━━━━━━━━━━━━━━━━━`);
    lines.push(``);
    lines.push(`工作空间：${this.workspaceRoot}`);
    lines.push(`项目总数：${projects.length}`);
    lines.push(``);

    // 按类型统计
    const byType: Record<string, number> = {};
    for (const project of projects) {
      byType[project.type] = (byType[project.type] || 0) + 1;
    }

    lines.push(`📁 项目类型分布:`);
    for (const [type, count] of Object.entries(byType)) {
      lines.push(`  - ${type}: ${count}个`);
    }
    lines.push(``);

    // 详细列表
    lines.push(`📋 项目详情:`);
    lines.push(``);

    for (const project of projects) {
      lines.push(`**${project.name}**`);
      lines.push(`  类型：${project.type}`);
      lines.push(`  路径：${project.path}`);
      lines.push(`  语言：${project.techStack.languages.join(", ") || "未知"}`);
      lines.push(`  框架：${project.techStack.frameworks.join(", ") || "未知"}`);
      
      if (project.techStack.databases) {
        lines.push(`  数据库：${project.techStack.databases.join(", ")}`);
      }
      
      lines.push(`  结构:`);
      lines.push(`    - 源代码目录：${project.structure.hasSrc ? "✓" : "✗"}`);
      lines.push(`    - 测试目录：${project.structure.hasTests ? "✓" : "✗"}`);
      lines.push(`    - 文档目录：${project.structure.hasDocs ? "✓" : "✗"}`);
      lines.push(`    - 配置目录：${project.structure.hasConfig ? "✓" : "✗"}`);

      if (project.issues.length > 0) {
        lines.push(`  问题:`);
        for (const issue of project.issues) {
          const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
          lines.push(`    ${icon} [${issue.category}] ${issue.message}`);
          if (issue.suggestion) {
            lines.push(`       建议：${issue.suggestion}`);
          }
        }
      }

      lines.push(``);
    }

    // 总体统计
    const totalIssues = projects.reduce((sum, p) => sum + p.issues.length, 0);
    const errorCount = projects.reduce((sum, p) => sum + p.issues.filter(i => i.severity === "error").length, 0);
    const warningCount = projects.reduce((sum, p) => sum + p.issues.filter(i => i.severity === "warning").length, 0);

    lines.push(`━━━━━━━━━━━━━━━━━━`);
    lines.push(``);
    lines.push(`📈 总体统计:`);
    lines.push(`  总问题数：${totalIssues}`);
    lines.push(`  错误：${errorCount}`);
    lines.push(`  警告：${warningCount}`);
    lines.push(`  信息：${totalIssues - errorCount - warningCount}`);
    lines.push(``);

    if (errorCount > 0 || warningCount > 0) {
      lines.push(`💡 建议优先处理:`);
      if (errorCount > 0) {
        lines.push(`  1. 修复 ${errorCount} 个错误`);
      }
      if (warningCount > 0) {
        lines.push(`  2. 处理 ${warningCount} 个警告`);
      }
    }

    return lines.join("\n");
  }
}

/**
 * 创建项目分析器
 */
export function createProjectAnalyzer(workspaceRoot: string): ProjectAnalyzer {
  return new ProjectAnalyzer(workspaceRoot);
}
