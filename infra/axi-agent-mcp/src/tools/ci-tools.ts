/**
 * CI/CD 工具集
 * 提供运行 Lint、Test 和自动修复功能
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

export interface LintResult {
  success: boolean;
  totalErrors: number;
  totalWarnings: number;
  files: LintFileResult[];
  duration: number;
  command: string;
}

export interface LintFileResult {
  filePath: string;
  messages: LintMessage[];
}

export interface LintMessage {
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  ruleId?: string;
  fixable?: boolean;
}

export interface TestResult {
  success: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: {
    lines: number;
    functions: number;
    branches: number;
  };
  failures: TestFailure[];
  command: string;
}

export interface TestFailure {
  name: string;
  file?: string;
  error: string;
  stack?: string;
}

export interface PackageScript {
  name: string;
  command: string;
  type: "lint" | "test" | "build" | "dev" | "other";
}

export class CITools {
  private projectRoot: string;
  private packageManager: "npm" | "yarn" | "pnpm" | "bun";

  constructor(projectRoot: string, packageManager?: "npm" | "yarn" | "pnpm" | "bun") {
    this.projectRoot = projectRoot;
    this.packageManager = packageManager || this.detectPackageManager();
  }

  /**
   * 检测包管理器
   */
  private detectPackageManager(): "npm" | "yarn" | "pnpm" | "bun" {
    if (existsSync(join(this.projectRoot, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(this.projectRoot, "yarn.lock"))) return "yarn";
    if (existsSync(join(this.projectRoot, "bun.lockb"))) return "bun";
    return "npm";
  }

  /**
   * 执行命令
   */
  private async execCommand(
    command: string,
    options?: { timeout?: number; cwd?: string }
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const cwd = options?.cwd || this.projectRoot;
    const timeout = options?.timeout || 300000; // 5 分钟默认超时

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env: { ...process.env, CI: "true" },
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return { stdout, stderr, code: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || "",
        code: error.code || 1,
      };
    }
  }

  /**
   * 读取 package.json
   */
  private async readPackageJson(): Promise<any> {
    try {
      const content = await readFile(join(this.projectRoot, "package.json"), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 获取可用的脚本命令
   */
  async getScripts(): Promise<PackageScript[]> {
    const pkg = await this.readPackageJson();
    if (!pkg || !pkg.scripts) return [];

    const scripts: PackageScript[] = [];

    for (const [name, command] of Object.entries(pkg.scripts)) {
      let type: PackageScript["type"] = "other";

      if (name.includes("lint")) type = "lint";
      else if (name.includes("test")) type = "test";
      else if (name.includes("build")) type = "build";
      else if (name.includes("dev") || name.includes("start")) type = "dev";

      scripts.push({
        name,
        command: command as string,
        type,
      });
    }

    return scripts;
  }

  /**
   * 运行 Lint
   */
  async runLint(options?: {
    fix?: boolean;
    script?: string;
    timeout?: number;
  }): Promise<LintResult> {
    const startTime = Date.now();
    
    // 获取 lint 命令
    const scripts = await this.getScripts();
    let lintScript = scripts.find(s => s.name === "lint");
    
    if (options?.script) {
      lintScript = scripts.find(s => s.name === options.script);
    }

    if (!lintScript) {
      // 尝试默认命令
      lintScript = {
        name: "lint",
        command: this.packageManager === "npm" ? "npm run lint" : `${this.packageManager} lint`,
        type: "lint",
      };
    }

    let command = lintScript.command;
    if (options?.fix) {
      // 尝试添加 --fix 参数
      if (!command.includes("--fix")) {
        command += " --fix";
      }
    }

    logger.info("ci_lint_start", { command, fix: options?.fix });

    const result = await this.execCommand(command, {
      timeout: options?.timeout,
    });

    const duration = Date.now() - startTime;

    // 解析输出
    const parsed = this.parseLintOutput(result.stdout, result.stderr);

    logger.info("ci_lint_complete", {
      success: parsed.success,
      errors: parsed.totalErrors,
      warnings: parsed.totalWarnings,
      duration,
    });

    return {
      ...parsed,
      duration,
      command,
    };
  }

  /**
   * 解析 Lint 输出
   */
  private parseLintOutput(stdout: string, stderr: string): LintResult {
    const output = stdout + stderr;
    const files: LintFileResult[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    // 简单解析 ESLint 输出
    // 实际使用中应该使用 JSON 格式输出
    const lines = output.split("\n");
    let currentFile: LintFileResult | null = null;

    for (const line of lines) {
      // 检测文件路径
      const fileMatch = line.match(/^\/?[^\s]+\.([tj]sx?)?$/);
      if (fileMatch) {
        if (currentFile) {
          files.push(currentFile);
        }
        currentFile = {
          filePath: line.trim(),
          messages: [],
        };
        continue;
      }

      // 检测错误信息
      const errorMatch = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+([a-z-]+))?$/i);
      if (errorMatch && currentFile) {
        const [, lineStr, columnStr, severity, message, ruleId] = errorMatch;
        currentFile.messages.push({
          line: parseInt(lineStr, 10),
          column: parseInt(columnStr, 10),
          severity: severity as "error" | "warning",
          message: message.trim(),
          ruleId,
        });

        if (severity === "error") totalErrors++;
        else totalWarnings++;
      }
    }

    if (currentFile) {
      files.push(currentFile);
    }

    // 如果没有解析到具体文件，但有错误
    if (files.length === 0 && (totalErrors > 0 || totalWarnings > 0)) {
      files.push({
        filePath: "unknown",
        messages: [],
      });
    }

    // 检测是否成功
    const success = totalErrors === 0 && !output.includes("✖") && !output.includes("failed");

    return {
      success,
      totalErrors,
      totalWarnings,
      files,
      duration: 0,
      command: "",
    };
  }

  /**
   * 运行测试
   */
  async runTest(options?: {
    script?: string;
    coverage?: boolean;
    watch?: boolean;
    timeout?: number;
    pattern?: string; // 测试文件模式
  }): Promise<TestResult> {
    const startTime = Date.now();

    // 获取 test 命令
    const scripts = await this.getScripts();
    let testScript = scripts.find(s => s.name === "test");

    if (options?.script) {
      testScript = scripts.find(s => s.name === options.script);
    }

    if (!testScript) {
      testScript = {
        name: "test",
        command: this.packageManager === "npm" ? "npm test" : `${this.packageManager} test`,
        type: "test",
      };
    }

    let command = testScript.command;
    
    if (options?.coverage) {
      if (!command.includes("--coverage")) {
        command += " --coverage";
      }
    }
    if (options?.watch) {
      if (!command.includes("--watch")) {
        command += " --watch";
      }
    }
    if (options?.pattern) {
      command += ` "${options.pattern}"`;
    }

    logger.info("ci_test_start", { command, coverage: options?.coverage });

    const result = await this.execCommand(command, {
      timeout: options?.timeout,
    });

    const duration = Date.now() - startTime;

    // 解析输出
    const parsed = this.parseTestOutput(result.stdout, result.stderr);

    logger.info("ci_test_complete", {
      success: parsed.success,
      total: parsed.total,
      passed: parsed.passed,
      failed: parsed.failed,
      duration,
    });

    return {
      ...parsed,
      duration,
      command,
    };
  }

  /**
   * 解析测试输出
   */
  private parseTestOutput(stdout: string, stderr: string): TestResult {
    const output = stdout + stderr;
    const failures: TestFailure[] = [];

    // 解析 Jest/Vitest 输出
    const totalMatch = output.match(/Tests:\s*(\d+)\s+total/i);
    const passedMatch = output.match(/(\d+)\s+passed/i);
    const failedMatch = output.match(/(\d+)\s+failed/i);
    const skippedMatch = output.match(/(\d+)\s+skipped/i);
    const durationMatch = output.match(/Time:\s*([\d.]+)\s*s/i);
    const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i);

    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
    const duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;

    // 解析失败的测试
    const failureRegex = /●\s*(.+?)\n\s*(.+?)(?=\n\s*●|\n\s*Test Suites|$)/gs;
    let match;
    while ((match = failureRegex.exec(output)) !== null) {
      failures.push({
        name: match[1].trim(),
        error: match[2].trim(),
      });
    }

    // 检测覆盖率
    let coverage;
    if (coverageMatch) {
      coverage = {
        lines: parseFloat(coverageMatch[1]),
        functions: parseFloat(coverageMatch[2]),
        branches: parseFloat(coverageMatch[3]),
      };
    }

    const success = failed === 0 && !output.includes("FAIL");

    return {
      success,
      total,
      passed,
      failed,
      skipped,
      duration,
      coverage,
      failures,
      command: "",
    };
  }

  /**
   * 自动修复 Lint 错误
   */
  async autoFixLint(options?: {
    maxAttempts?: number;
    timeout?: number;
  }): Promise<{
    success: boolean;
    attempts: number;
    remainingErrors: number;
    results: LintResult[];
  }> {
    const maxAttempts = options?.maxAttempts || 3;
    const results: LintResult[] = [];
    let attempts = 0;

    logger.info("ci_autofix_start", { maxAttempts });

    while (attempts < maxAttempts) {
      attempts++;
      logger.info("ci_autofix_attempt", { attempt: attempts });

      const result = await this.runLint({ fix: true, timeout: options?.timeout });
      results.push(result);

      if (result.success || result.totalErrors === 0) {
        logger.info("ci_autofix_success", { attempts });
        return {
          success: true,
          attempts,
          remainingErrors: 0,
          results,
        };
      }

      // 如果没有修复任何问题，停止
      if (attempts > 1) {
        const prevResult = results[attempts - 2];
        if (result.totalErrors === prevResult.totalErrors) {
          logger.warn("ci_autofix_no_progress", { errors: result.totalErrors });
          break;
        }
      }
    }

    const lastResult = results[results.length - 1];
    logger.warn("ci_autofix_failed", {
      attempts,
      remainingErrors: lastResult.totalErrors,
    });

    return {
      success: false,
      attempts,
      remainingErrors: lastResult.totalErrors,
      results,
    };
  }

  /**
   * 运行构建
   */
  async runBuild(options?: {
    script?: string;
    timeout?: number;
  }): Promise<{
    success: boolean;
    duration: number;
    output: string;
    command: string;
  }> {
    const startTime = Date.now();

    const scripts = await this.getScripts();
    let buildScript = scripts.find(s => s.name === "build");

    if (options?.script) {
      buildScript = scripts.find(s => s.name === options.script);
    }

    if (!buildScript) {
      buildScript = {
        name: "build",
        command: this.packageManager === "npm" ? "npm run build" : `${this.packageManager} build`,
        type: "build",
      };
    }

    logger.info("ci_build_start", { command: buildScript.command });

    const result = await this.execCommand(buildScript.command, {
      timeout: options?.timeout,
    });

    const duration = Date.now() - startTime;
    const success = result.code === 0;

    logger.info("ci_build_complete", {
      success,
      duration,
      hasError: result.stderr.length > 0,
    });

    return {
      success,
      duration,
      output: result.stdout + result.stderr,
      command: buildScript.command,
    };
  }

  /**
   * 安装依赖
   */
  async install(options?: { production?: boolean }): Promise<void> {
    let command = `${this.packageManager} install`;

    if (options?.production) {
      if (this.packageManager === "npm") {
        command += " --production";
      } else if (this.packageManager === "yarn") {
        command += " --production";
      } else if (this.packageManager === "pnpm") {
        command += " --prod";
      }
    }

    logger.info("ci_install_start", { command, production: options?.production });

    await this.execCommand(command, { timeout: 600000 }); // 10 分钟超时

    logger.info("ci_install_complete");
  }

  /**
   * 清理缓存
   */
  async clean(): Promise<void> {
    const scripts = await this.getScripts();
    const cleanScript = scripts.find(s => s.name === "clean");

    if (cleanScript) {
      await this.execCommand(cleanScript.command);
    } else {
      // 默认清理命令
      await this.execCommand(`${this.packageManager} cache clean`);
    }

    logger.info("ci_clean_complete");
  }
}

/**
 * 创建 CI 工具实例
 */
export function createCITools(
  projectRoot: string,
  packageManager?: "npm" | "yarn" | "pnpm" | "bun"
): CITools {
  return new CITools(projectRoot, packageManager);
}
