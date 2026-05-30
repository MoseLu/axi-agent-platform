/**
 * 技术栈自动识别工具
 * 分析项目配置文件，识别使用的框架、库和工具
 */

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface TechStackInfo {
  // 前端框架
  frontend?: {
    framework: "React" | "Vue" | "Angular" | "Svelte" | "Next.js" | "Nuxt.js" | null;
    uiLibrary?: string[];
    stateManagement?: string[];
    buildTool?: string;
  };

  // 后端框架
  backend?: {
    framework: "NestJS" | "Express" | "Fastify" | "Django" | "Flask" | "FastAPI" | "Spring" | null;
    orm?: string;
    database?: string[];
  };

  // 构建工具
  buildTools: {
    packageManager: "npm" | "yarn" | "pnpm" | "bun";
    bundler?: "Webpack" | "Vite" | "Rollup" | "esbuild";
    transpiler?: "Babel" | "TypeScript" | "esbuild";
  };

  // 测试框架
  testing?: {
    unitTest?: string[];
    e2eTest?: string[];
  };

  // 代码质量
  quality?: {
    linter?: string[];
    formatter?: string[];
  };

  // DevOps
  devops?: {
    docker?: boolean;
    ci?: string[];
    deployment?: string[];
  };

  // 原始依赖
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;

  // 项目信息
  projectName?: string;
  projectType: "monorepo" | "frontend" | "backend" | "fullstack" | "library";
  languages: string[];
}

export class TechStackDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * 检测项目技术栈
   */
  async detect(): Promise<TechStackInfo> {
    const info: TechStackInfo = {
      buildTools: {
        packageManager: "npm",
      },
      dependencies: {},
      devDependencies: {},
      projectType: "fullstack",
      languages: [],
    };

    // 读取 package.json
    const packageJson = await this.readPackageJson();
    if (packageJson) {
      info.projectName = packageJson.name;
      info.dependencies = packageJson.dependencies || {};
      info.devDependencies = packageJson.devDependencies || {};

      // 检测包管理器
      info.buildTools.packageManager = await this.detectPackageManager();

      // 检测前端框架
      info.frontend = this.detectFrontend(info.dependencies, info.devDependencies);

      // 检测后端框架
      info.backend = this.detectBackend(info.dependencies, info.devDependencies);

      // 检测构建工具
      info.buildTools.bundler = this.detectBundler(info.dependencies, info.devDependencies);
      info.buildTools.transpiler = this.detectTranspiler(info.dependencies, info.devDependencies);

      // 检测测试框架
      info.testing = this.detectTesting(info.dependencies, info.devDependencies);

      // 检测代码质量工具
      info.quality = this.detectQuality(info.dependencies, info.devDependencies);
    }

    // 检测项目类型
    info.projectType = await this.detectProjectType();

    // 检测语言
    info.languages = await this.detectLanguages();

    // 检测 DevOps 工具
    info.devops = await this.detectDevOps();

    return info;
  }

  /**
   * 读取 package.json
   */
  private async readPackageJson(): Promise<any> {
    try {
      const packagePath = join(this.projectRoot, "package.json");
      const content = await readFile(packagePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 检测包管理器
   */
  private async detectPackageManager(): Promise<TechStackInfo["buildTools"]["packageManager"]> {
    if (existsSync(join(this.projectRoot, "pnpm-lock.yaml"))) {
      return "pnpm";
    }
    if (existsSync(join(this.projectRoot, "yarn.lock"))) {
      return "yarn";
    }
    if (existsSync(join(this.projectRoot, "bun.lockb"))) {
      return "bun";
    }
    return "npm";
  }

  /**
   * 检测前端框架
   */
  private detectFrontend(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): NonNullable<TechStackInfo["frontend"]> {
    const allDeps = { ...deps, ...devDeps };
    const depNames = Object.keys(allDeps);

    let framework: NonNullable<TechStackInfo["frontend"]>["framework"] = null;
    const uiLibrary: string[] = [];
    const stateManagement: string[] = [];
    let buildTool: string | undefined;

    // React
    if (depNames.includes("react")) {
      if (depNames.includes("next")) {
        framework = "Next.js";
      } else {
        framework = "React";
      }

      // UI 库
      if (depNames.includes("antd")) uiLibrary.push("Ant Design");
      if (depNames.includes("@mui/material")) uiLibrary.push("Material-UI");
      if (depNames.includes("chakra-ui")) uiLibrary.push("Chakra UI");
      if (depNames.includes("@radix-ui")) uiLibrary.push("Radix UI");
      if (depNames.includes("tailwindcss")) uiLibrary.push("Tailwind CSS");

      // 状态管理
      if (depNames.includes("redux") || depNames.includes("@reduxjs/toolkit")) {
        stateManagement.push("Redux");
      }
      if (depNames.includes("mobx")) stateManagement.push("MobX");
      if (depNames.includes("zustand")) stateManagement.push("Zustand");
      if (depNames.includes("jotai")) stateManagement.push("Jotai");
      if (depNames.includes("recoil")) stateManagement.push("Recoil");
    }

    // Vue
    if (depNames.includes("vue")) {
      if (depNames.includes("nuxt")) {
        framework = "Nuxt.js";
      } else {
        framework = "Vue";
      }

      if (depNames.includes("element-plus")) uiLibrary.push("Element Plus");
      if (depNames.includes("vuetify")) uiLibrary.push("Vuetify");
      if (depNames.includes("ant-design-vue")) uiLibrary.push("Ant Design Vue");

      if (depNames.includes("pinia")) stateManagement.push("Pinia");
      if (depNames.includes("vuex")) stateManagement.push("Vuex");
    }

    // Angular
    if (depNames.includes("@angular/core")) {
      framework = "Angular";
    }

    // Svelte
    if (depNames.includes("svelte")) {
      framework = "Svelte";
      if (depNames.includes("@sveltejs/kit")) {
        // SvelteKit 是 Svelte 的元框架，但类型中没有定义，保持为 Svelte
      }
    }

    // 构建工具
    if (depNames.includes("vite")) buildTool = "Vite";
    if (depNames.includes("webpack")) buildTool = "Webpack";
    if (depNames.includes("parcel")) buildTool = "Parcel";

    return {
      framework,
      uiLibrary: uiLibrary.length > 0 ? uiLibrary : undefined,
      stateManagement: stateManagement.length > 0 ? stateManagement : undefined,
      buildTool,
    };
  }

  /**
   * 检测后端框架
   */
  private detectBackend(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): NonNullable<TechStackInfo["backend"]> {
    const allDeps = { ...deps, ...devDeps };
    const depNames = Object.keys(allDeps);

    let framework: NonNullable<TechStackInfo["backend"]>["framework"] = null;
    let orm: string | undefined;
    const database: string[] = [];

    // Node.js
    if (depNames.includes("@nestjs/core")) {
      framework = "NestJS";
      if (depNames.includes("@nestjs/typeorm")) orm = "TypeORM";
      if (depNames.includes("@nestjs/mongoose")) orm = "Mongoose";
      if (depNames.includes("prisma")) orm = "Prisma";
    } else if (depNames.includes("express")) {
      framework = "Express";
    } else if (depNames.includes("fastify")) {
      framework = "Fastify";
    }

    // Python (通过 requirements.txt 检测)
    if (depNames.includes("django") || depNames.includes("djangorestframework")) {
      framework = "Django";
    } else if (depNames.includes("flask")) {
      framework = "Flask";
    } else if (depNames.includes("fastapi")) {
      framework = "FastAPI";
    }

    // Java (通过 pom.xml 或 build.gradle 检测)
    if (depNames.includes("org.springframework.boot")) {
      framework = "Spring";
      if (depNames.includes("org.hibernate")) orm = "Hibernate";
    }

    // 数据库
    if (depNames.includes("pg") || depNames.includes("postgres")) database.push("PostgreSQL");
    if (depNames.includes("mysql2") || depNames.includes("mysql")) database.push("MySQL");
    if (depNames.includes("mongodb") || depNames.includes("mongoose")) database.push("MongoDB");
    if (depNames.includes("redis")) database.push("Redis");
    if (depNames.includes("sqlite3")) database.push("SQLite");

    return {
      framework,
      orm,
      database: database.length > 0 ? database : undefined,
    };
  }

  /**
   * 检测构建工具
   */
  private detectBundler(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): TechStackInfo["buildTools"]["bundler"] | undefined {
    const allDeps = { ...deps, ...devDeps };

    if (allDeps["vite"]) return "Vite";
    if (allDeps["webpack"]) return "Webpack";
    if (allDeps["rollup"]) return "Rollup";
    if (allDeps["esbuild"]) return "esbuild";

    return undefined;
  }

  /**
   * 检测转译器
   */
  private detectTranspiler(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): TechStackInfo["buildTools"]["transpiler"] | undefined {
    const allDeps = { ...deps, ...devDeps };

    if (allDeps["@babel/core"]) return "Babel";
    if (allDeps["typescript"]) return "TypeScript";
    if (allDeps["esbuild"]) return "esbuild";

    return undefined;
  }

  /**
   * 检测测试框架
   */
  private detectTesting(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): TechStackInfo["testing"] | undefined {
    const allDeps = { ...deps, ...devDeps };
    const depNames = Object.keys(allDeps);

    const unitTest: string[] = [];
    const e2eTest: string[] = [];

    if (depNames.includes("jest")) unitTest.push("Jest");
    if (depNames.includes("mocha")) unitTest.push("Mocha");
    if (depNames.includes("vitest")) unitTest.push("Vitest");
    if (depNames.includes("pytest")) unitTest.push("pytest");

    if (depNames.includes("cypress")) e2eTest.push("Cypress");
    if (depNames.includes("playwright")) e2eTest.push("Playwright");
    if (depNames.includes("puppeteer")) e2eTest.push("Puppeteer");

    if (unitTest.length === 0 && e2eTest.length === 0) {
      return undefined;
    }

    return {
      unitTest: unitTest.length > 0 ? unitTest : undefined,
      e2eTest: e2eTest.length > 0 ? e2eTest : undefined,
    };
  }

  /**
   * 检测代码质量工具
   */
  private detectQuality(
    deps: Record<string, string>,
    devDeps: Record<string, string>
  ): TechStackInfo["quality"] | undefined {
    const allDeps = { ...deps, ...devDeps };
    const depNames = Object.keys(allDeps);

    const linter: string[] = [];
    const formatter: string[] = [];

    if (depNames.includes("eslint")) linter.push("ESLint");
    if (depNames.includes("tslint")) linter.push("TSLint");
    if (depNames.includes("pylint")) linter.push("Pylint");

    if (depNames.includes("prettier")) formatter.push("Prettier");
    if (depNames.includes("stylelint")) formatter.push("Stylelint");

    if (linter.length === 0 && formatter.length === 0) {
      return undefined;
    }

    return {
      linter: linter.length > 0 ? linter : undefined,
      formatter: formatter.length > 0 ? formatter : undefined,
    };
  }

  /**
   * 检测 DevOps 工具
   */
  private async detectDevOps(): Promise<TechStackInfo["devops"] | undefined> {
    const devops: TechStackInfo["devops"] = {
      docker: false,
      ci: [],
      deployment: [],
    };

    // Docker
    if (
      existsSync(join(this.projectRoot, "Dockerfile")) ||
      existsSync(join(this.projectRoot, "docker-compose.yml"))
    ) {
      devops.docker = true;
    }

    // CI/CD
    if (existsSync(join(this.projectRoot, ".github/workflows"))) {
      devops.ci!.push("GitHub Actions");
    }
    if (existsSync(join(this.projectRoot, ".gitlab-ci.yml"))) {
      devops.ci!.push("GitLab CI");
    }
    if (existsSync(join(this.projectRoot, ".circleci/config.yml"))) {
      devops.ci!.push("CircleCI");
    }

    // Deployment
    if (existsSync(join(this.projectRoot, "vercel.json"))) {
      devops.deployment!.push("Vercel");
    }
    if (existsSync(join(this.projectRoot, "netlify.toml"))) {
      devops.deployment!.push("Netlify");
    }

    if (!devops.docker && devops.ci!.length === 0 && devops.deployment!.length === 0) {
      return undefined;
    }

    return devops;
  }

  /**
   * 检测项目类型
   */
  private async detectProjectType(): Promise<TechStackInfo["projectType"]> {
    const hasFrontend = existsSync(join(this.projectRoot, "apps/frontend")) ||
                        existsSync(join(this.projectRoot, "client")) ||
                        existsSync(join(this.projectRoot, "web"));
    
    const hasBackend = existsSync(join(this.projectRoot, "apps/backend")) ||
                       existsSync(join(this.projectRoot, "server")) ||
                       existsSync(join(this.projectRoot, "api"));

    const hasMonorepo = existsSync(join(this.projectRoot, "packages")) ||
                        existsSync(join(this.projectRoot, "apps"));

    if (hasMonorepo) return "monorepo";
    if (hasFrontend && hasBackend) return "fullstack";
    if (hasFrontend) return "frontend";
    if (hasBackend) return "backend";

    // 检查是否是库
    const packageJson = await this.readPackageJson();
    if (packageJson && !packageJson.bin && !packageJson.main) {
      return "library";
    }

    return "fullstack";
  }

  /**
   * 检测项目语言
   */
  private async detectLanguages(): Promise<string[]> {
    const languages: string[] = [];

    // 简单检测：通过文件扩展名
    const checkFile = async (pattern: string): Promise<boolean> => {
      try {
        const { glob } = await import("fast-glob");
        const files = await glob(pattern, {
          cwd: this.projectRoot,
          onlyFiles: true,
          absolute: false,
        });
        return files.length > 0;
      } catch {
        return false;
      }
    };

    if (await checkFile("**/*.ts") || await checkFile("**/*.tsx")) {
      languages.push("TypeScript");
    }
    if (await checkFile("**/*.js") || await checkFile("**/*.jsx")) {
      languages.push("JavaScript");
    }
    if (await checkFile("**/*.py")) {
      languages.push("Python");
    }
    if (await checkFile("**/*.go")) {
      languages.push("Go");
    }
    if (await checkFile("**/*.rs")) {
      languages.push("Rust");
    }
    if (await checkFile("**/*.java")) {
      languages.push("Java");
    }

    return languages;
  }

  /**
   * 生成技术栈报告
   */
  generateReport(info: TechStackInfo): string {
    const lines: string[] = [];

    lines.push(`📦 项目：${info.projectName || "未知"}`);
    lines.push(`类型：${info.projectType}`);
    lines.push(`语言：${info.languages.join(", ") || "未知"}`);
    lines.push(`包管理器：${info.buildTools.packageManager}`);
    lines.push("");

    if (info.frontend?.framework) {
      lines.push(`🎨 前端框架：${info.frontend.framework}`);
      if (info.frontend.uiLibrary) {
        lines.push(`   UI 库：${info.frontend.uiLibrary.join(", ")}`);
      }
      if (info.frontend.stateManagement) {
        lines.push(`   状态管理：${info.frontend.stateManagement.join(", ")}`);
      }
      if (info.frontend.buildTool) {
        lines.push(`   构建工具：${info.frontend.buildTool}`);
      }
      lines.push("");
    }

    if (info.backend?.framework) {
      lines.push(`⚙️ 后端框架：${info.backend.framework}`);
      if (info.backend.orm) {
        lines.push(`   ORM: ${info.backend.orm}`);
      }
      if (info.backend.database) {
        lines.push(`   数据库：${info.backend.database.join(", ")}`);
      }
      lines.push("");
    }

    if (info.buildTools.bundler) {
      lines.push(`🔧 打包工具：${info.buildTools.bundler}`);
    }
    if (info.buildTools.transpiler) {
      lines.push(`📝 转译器：${info.buildTools.transpiler}`);
    }
    lines.push("");

    if (info.testing) {
      if (info.testing.unitTest) {
        lines.push(`🧪 单元测试：${info.testing.unitTest.join(", ")}`);
      }
      if (info.testing.e2eTest) {
        lines.push(`🎭 E2E 测试：${info.testing.e2eTest.join(", ")}`);
      }
      lines.push("");
    }

    if (info.quality) {
      if (info.quality.linter) {
        lines.push(`📏 Linter: ${info.quality.linter.join(", ")}`);
      }
      if (info.quality.formatter) {
        lines.push(`✨ Formatter: ${info.quality.formatter.join(", ")}`);
      }
      lines.push("");
    }

    if (info.devops) {
      if (info.devops.docker) {
        lines.push(`🐳 Docker: 已配置`);
      }
      if (info.devops.ci && info.devops.ci.length > 0) {
        lines.push(`🔄 CI: ${info.devops.ci.join(", ")}`);
      }
      if (info.devops.deployment && info.devops.deployment.length > 0) {
        lines.push(`🚀 部署：${info.devops.deployment.join(", ")}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

/**
 * 创建技术栈检测器
 */
export function createTechStackDetector(projectRoot: string): TechStackDetector {
  return new TechStackDetector(projectRoot);
}
