/**
 * Git 操作工具集
 * 提供完整的 Git 工作流支持
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../logger.js";

const execAsync = promisify(exec);

export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: {
    staged: FileChange[];
    unstaged: FileChange[];
    untracked: string[];
  };
  clean: boolean;
}

export interface FileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
  staged: boolean;
}

export interface CommitOptions {
  message: string;
  all?: boolean; // git commit -a
  amend?: boolean; // git commit --amend
  noVerify?: boolean; // git commit --no-verify
}

export interface BranchOptions {
  name: string;
  track?: string; // 跟踪的远程分支
  force?: boolean;
}

export interface MergeRequest {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  labels?: string[];
  reviewers?: string[];
}

export interface CIResult {
  success: boolean;
  jobId?: string;
  status: "pending" | "running" | "success" | "failed" | "canceled";
  duration?: number;
  logs?: string;
  errors?: string[];
}

export class GitTools {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * 执行 Git 命令
   */
  private async execGit(args: string[], options?: { cwd?: string }): Promise<string> {
    const cwd = options?.cwd || this.repoPath;
    
    // 检查是否是 Git 仓库
    if (!existsSync(join(cwd, ".git"))) {
      throw new Error(`不是 Git 仓库：${cwd}`);
    }

    try {
      const { stdout, stderr } = await execAsync(`git ${args.join(" ")}`, {
        cwd,
        env: process.env,
      });

      if (stderr && !stderr.includes("warning")) {
        logger.warn("git_command_warning", { args, stderr });
      }

      return stdout.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("git_command_failed", message, { args });
      throw new Error(`Git 命令失败：${message}`);
    }
  }

  /**
   * 初始化 Git 仓库
   */
  async init(): Promise<void> {
    await this.execGit(["init"]);
    logger.info("git_init", { path: this.repoPath });
  }

  /**
   * 检查是否是 Git 仓库
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前状态
   */
  async getStatus(): Promise<GitStatus> {
    // 获取当前分支
    const branch = await this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    
    // 获取上游分支
    let upstream: string | undefined;
    try {
      upstream = await this.execGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
      // 没有上游分支
    }

    // 获取 ahead/behind 信息
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const [aheadStr, behindStr] = (
        await this.execGit(["rev-list", "--left-right", "--count", `HEAD...${upstream}`])
      ).split("\t");
      ahead = parseInt(aheadStr, 10);
      behind = parseInt(behindStr, 10);
    }

    // 获取文件变更
    const changes = await this.getChanges();

    return {
      branch,
      upstream,
      ahead,
      behind,
      changes,
      clean: changes.staged.length === 0 && changes.unstaged.length === 0 && changes.untracked.length === 0,
    };
  }

  /**
   * 获取文件变更列表
   */
  async getChanges(): Promise<GitStatus["changes"]> {
    const staged: FileChange[] = [];
    const unstaged: FileChange[] = [];
    const untracked: string[] = [];

    // 已暂存的变更
    const stagedOutput = await this.execGit(["diff", "--cached", "--name-status"]).catch(() => "");
    if (stagedOutput) {
      for (const line of stagedOutput.split("\n").filter(Boolean)) {
        const [status, path] = line.split("\t");
        staged.push({
          path,
          status: this.parseStatus(status),
          staged: true,
        });
      }
    }

    // 未暂存的变更
    const unstagedOutput = await this.execGit(["diff", "--name-status"]).catch(() => "");
    if (unstagedOutput) {
      for (const line of unstagedOutput.split("\n").filter(Boolean)) {
        const [status, path] = line.split("\t");
        unstaged.push({
          path,
          status: this.parseStatus(status),
          staged: false,
        });
      }
    }

    // 未跟踪的文件
    const untrackedOutput = await this.execGit(["ls-files", "--others", "--exclude-standard"]).catch(() => "");
    if (untrackedOutput) {
      untracked.push(...untrackedOutput.split("\n").filter(Boolean));
    }

    return { staged, unstaged, untracked };
  }

  /**
   * 解析文件状态
   */
  private parseStatus(status: string): FileChange["status"] {
    const s = status[0];
    switch (s) {
      case "A": return "added";
      case "M": return "modified";
      case "D": return "deleted";
      case "R": return "renamed";
      case "C": return "copied";
      default: return "modified";
    }
  }

  /**
   * 添加文件到暂存区
   */
  async add(files: string | string[]): Promise<void> {
    const fileList = Array.isArray(files) ? files : [files];
    
    if (fileList.includes(".")) {
      await this.execGit(["add", "."]);
    } else {
      await this.execGit(["add", ...fileList]);
    }

    logger.info("git_add", { files: fileList });
  }

  /**
   * 添加所有变更
   */
  async addAll(): Promise<void> {
    await this.add(".");
  }

  /**
   * 提交
   */
  async commit(options: CommitOptions): Promise<string> {
    const args = ["commit", "-m", options.message];

    if (options.all) {
      args.push("-a");
    }
    if (options.amend) {
      args.push("--amend");
    }
    if (options.noVerify) {
      args.push("--no-verify");
    }

    await this.execGit(args);
    
    const commitHash = await this.execGit(["rev-parse", "HEAD"]);
    
    logger.info("git_commit", {
      message: options.message,
      hash: commitHash,
      amend: options.amend,
    });

    return commitHash;
  }

  /**
   * 创建分支
   */
  async createBranch(options: BranchOptions): Promise<void> {
    const args = ["checkout", "-b", options.name];

    if (options.track) {
      args.push("--track", options.track);
    }
    if (options.force) {
      args.push("--force");
    }

    await this.execGit(args);
    
    logger.info("git_create_branch", {
      name: options.name,
      track: options.track,
    });
  }

  /**
   * 切换分支
   */
  async checkout(branch: string): Promise<void> {
    await this.execGit(["checkout", branch]);
    logger.info("git_checkout", { branch });
  }

  /**
   * 推送分支
   */
  async push(branch?: string, options?: { force?: boolean; setUpstream?: boolean }): Promise<void> {
    const args = ["push"];
    
    if (options?.force) {
      args.push("--force");
    }
    if (options?.setUpstream) {
      args.push("-u", "origin", branch || "HEAD");
    } else if (branch) {
      args.push("origin", branch);
    } else {
      args.push("origin");
    }

    await this.execGit(args);
    
    logger.info("git_push", { branch, force: options?.force });
  }

  /**
   * 拉取最新代码
   */
  async pull(branch?: string): Promise<void> {
    const args = ["pull"];
    
    if (branch) {
      args.push("origin", branch);
    }

    await this.execGit(args);
    logger.info("git_pull", { branch });
  }

  /**
   * 合并分支
   */
  async merge(branch: string, message?: string): Promise<void> {
    const args = ["merge", branch];
    
    if (message) {
      args.push("-m", message);
    }

    await this.execGit(args);
    logger.info("git_merge", { branch, message });
  }

  /**
   * 变基
   */
  async rebase(branch: string): Promise<void> {
    await this.execGit(["rebase", branch]);
    logger.info("git_rebase", { branch });
  }

  /**
   * 生成符合 Conventional Commits 的提交信息
   */
  generateCommitMessage(
    type: "feat" | "fix" | "docs" | "style" | "refactor" | "test" | "chore",
    scope: string,
    description: string,
    body?: string,
    breaking?: boolean
  ): string {
    const scopeStr = scope ? `(${scope})` : "";
    const breakingStr = breaking ? "!" : "";
    
    let message = `${type}${scopeStr}${breakingStr}: ${description}`;
    
    if (body) {
      message += `\n\n${body}`;
    }

    return message;
  }

  /**
   * 创建 Merge Request / Pull Request
   * 注意：这需要 GitHub/GitLab API，这里生成描述模板
   */
  async createMRDescription(mr: MergeRequest): Promise<string> {
    const lines: string[] = [];

    lines.push(`# ${mr.title}`);
    lines.push("");
    lines.push("## 变更说明");
    lines.push(mr.description);
    lines.push("");
    lines.push("## 变更列表");
    
    // 获取变更文件
    const changes = await this.getChanges();
    const allFiles = [
      ...changes.staged.map(c => c.path),
      ...changes.unstaged.map(c => c.path),
      ...changes.untracked,
    ];

    if (allFiles.length > 0) {
      lines.push(...allFiles.map(f => `- [ ] ${f}`));
    } else {
      lines.push("- 无文件变更");
    }

    lines.push("");
    lines.push("## 测试");
    lines.push("- [ ] 单元测试通过");
    lines.push("- [ ] 集成测试通过");
    lines.push("- [ ] E2E 测试通过");
    lines.push("");
    lines.push("## 分支信息");
    lines.push(`- 源分支：\`${mr.sourceBranch}\``);
    lines.push(`- 目标分支：\`${mr.targetBranch}\``);
    
    if (mr.labels && mr.labels.length > 0) {
      lines.push("");
      lines.push("## 标签");
      lines.push(mr.labels.map(l => `#${l}`).join(" "));
    }

    if (mr.reviewers && mr.reviewers.length > 0) {
      lines.push("");
      lines.push("## 审查者");
      lines.push(mr.reviewers.map(r => `@${r}`).join(" "));
    }

    return lines.join("\n");
  }

  /**
   * 获取最近提交历史
   */
  async getLog(limit: number = 10): Promise<Array<{
    hash: string;
    shortHash: string;
    subject: string;
    body?: string;
    author: string;
    date: string;
  }>> {
    const format = "%H|%h|%s|%b|%an|%ad";
    const output = await this.execGit([
      "log",
      `-${limit}`,
      `--pretty=format:${format}`,
      "--date=iso",
    ]);

    return output.split("\n").filter(Boolean).map(line => {
      const [hash, shortHash, subject, body, author, date] = line.split("|");
      return { hash, shortHash, subject, body, author, date };
    });
  }

  /**
   * 暂存所有变更并提交（快捷方法）
   */
  async quickCommit(message: string): Promise<string> {
    await this.addAll();
    return await this.commit({ message, all: false });
  }

  /**
   * 创建功能分支（快捷方法）
   */
  async createFeatureBranch(name: string): Promise<void> {
    const branchName = name.startsWith("feature/") ? name : `feature/${name}`;
    await this.createBranch({ name: branchName });
  }

  /**
   * 清理已合并的分支
   */
  async cleanupMergedBranches(): Promise<string[]> {
    const output = await this.execGit([
      "branch",
      "--merged",
      "main", // 或 master
    ]);

    const mergedBranches = output
      .split("\n")
      .map(b => b.trim().replace("*", "").trim())
      .filter(b => b && !["main", "master", "develop"].includes(b));

    for (const branch of mergedBranches) {
      await this.execGit(["branch", "-d", branch]);
    }

    logger.info("git_cleanup_merged", { count: mergedBranches.length });
    return mergedBranches;
  }
}

/**
 * 创建 Git 工具实例
 */
export function createGitTools(repoPath: string): GitTools {
  return new GitTools(repoPath);
}
