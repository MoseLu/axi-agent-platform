/**
 * 文件操作工具集
 * 提供安全的文件读写、修改、删除操作
 * 支持批量操作和备份机制
 */

import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  stat,
  readdir,
  access,
} from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../logger.js";

export interface FileResult {
  success: boolean;
  path?: string;
  content?: string;
  error?: string;
  backupPath?: string;
  stats?: {
    size: number;
    created: Date;
    modified: Date;
  };
}

export interface FileModification {
  path: string;
  oldContent: string;
  newContent: string;
  changes: Array<{
    line: number;
    oldLine?: string;
    newLine: string;
  }>;
}

export interface DirectoryStructure {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: DirectoryStructure[];
  depth: number;
}

export class FileSystemTools {
  private basePath: string;
  private backups: Map<string, string> = new Map(); // original -> backup path
  private maxBackups = 10;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * 读取文件
   */
  async readFile(filePath: string): Promise<FileResult> {
    const startTime = Date.now();
    const absolutePath = this.resolvePath(filePath);

    try {
      await this.checkPathSafety(absolutePath);
      
      const content = await readFile(absolutePath, "utf-8");
      const stats = await stat(absolutePath);

      logger.info("file_read", {
        path: absolutePath,
        size: stats.size,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        path: absolutePath,
        content,
        stats: {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("file_read_failed", errorMsg, { path: absolutePath });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 写入文件（创建或覆盖）
   */
  async writeFile(
    filePath: string,
    content: string,
    options?: { backup?: boolean; createDir?: boolean }
  ): Promise<FileResult> {
    const startTime = Date.now();
    const absolutePath = this.resolvePath(filePath);
    const { backup = true, createDir = true } = options || {};

    try {
      await this.checkPathSafety(absolutePath);

      // 备份现有文件
      let backupPath: string | undefined;
      if (backup && existsSync(absolutePath)) {
        backupPath = await this.createBackup(absolutePath);
      }

      // 创建目录（如果需要）
      if (createDir) {
        const dir = dirname(absolutePath);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
      }

      // 写入文件
      await writeFile(absolutePath, content, "utf-8");

      logger.info("file_write", {
        path: absolutePath,
        size: content.length,
        backup: backupPath,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        path: absolutePath,
        backupPath,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("file_write_failed", errorMsg, { path: absolutePath });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 修改文件（智能替换）
   */
  async modifyFile(
    filePath: string,
    modifications: Array<{
      search: string | RegExp;
      replace: string;
    }>
  ): Promise<FileResult & { changes?: FileModification["changes"] }> {
    const startTime = Date.now();
    const absolutePath = this.resolvePath(filePath);

    try {
      // 读取原文件
      const readResult = await this.readFile(filePath);
      if (!readResult.success || !readResult.content) {
        return {
          success: false,
          error: readResult.error || "无法读取文件",
        };
      }

      const oldContent = readResult.content;
      let newContent = oldContent;
      const changes: FileModification["changes"] = [];

      // 应用所有修改
      for (const mod of modifications) {
        const lines = newContent.split("\n");
        
        if (typeof mod.search === "string") {
          // 字符串替换
          if (newContent.includes(mod.search)) {
            newContent = newContent.replace(
              new RegExp(mod.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
              mod.replace
            );
            
            // 记录变更
            lines.forEach((line, idx) => {
              const searchValue = mod.search;
              if (typeof searchValue === 'string' && line.includes(searchValue)) {
                changes.push({
                  line: idx + 1,
                  oldLine: line,
                  newLine: line.replace(searchValue, mod.replace),
                });
              } else if (searchValue instanceof RegExp && searchValue.test(line)) {
                changes.push({
                  line: idx + 1,
                  oldLine: line,
                  newLine: line.replace(searchValue, mod.replace),
                });
              }
            });
          }
        } else {
          // 正则替换 - 需要先转为字符串
          const searchStr = mod.search.toString();
          let match;
          const regex = new RegExp(searchStr);
          while ((match = regex.exec(oldContent)) !== null) {
            const lineNum = oldContent.substring(0, match.index).split("\n").length;
            changes.push({
              line: lineNum,
              oldLine: match[0],
              newLine: mod.replace,
            });
          }
          newContent = newContent.replace(mod.search, mod.replace);
        }
      }

      // 如果没有变化
      if (oldContent === newContent) {
        return {
          success: true,
          path: absolutePath,
        };
      }

      // 写入新内容
      const writeResult = await this.writeFile(filePath, newContent, {
        backup: true,
      });

      logger.info("file_modify", {
        path: absolutePath,
        changesCount: changes.length,
        duration: Date.now() - startTime,
      });

      return {
        ...writeResult,
        changes,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("file_modify_failed", errorMsg, { path: absolutePath });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath: string): Promise<FileResult> {
    const absolutePath = this.resolvePath(filePath);

    try {
      await this.checkPathSafety(absolutePath);

      // 备份
      const backupPath = await this.createBackup(absolutePath);

      // 删除
      await unlink(absolutePath);

      logger.info("file_delete", {
        path: absolutePath,
        backup: backupPath,
      });

      return {
        success: true,
        path: absolutePath,
        backupPath,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("file_delete_failed", errorMsg, { path: absolutePath });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 创建备份
   */
  private async createBackup(originalPath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${originalPath}.backup.${timestamp}`;

    const content = await readFile(originalPath, "utf-8");
    await writeFile(backupPath, content, "utf-8");

    this.backups.set(originalPath, backupPath);

    // 清理旧备份
    if (this.backups.size > this.maxBackups) {
      const oldestKey = Array.from(this.backups.keys())[0];
      const oldestBackup = this.backups.get(oldestKey);
      if (oldestBackup) {
        await unlink(oldestBackup).catch(() => {});
        this.backups.delete(oldestKey);
      }
    }

    return backupPath;
  }

  /**
   * 恢复备份
   */
  async restoreBackup(filePath: string): Promise<FileResult> {
    const absolutePath = this.resolvePath(filePath);
    const backupPath = this.backups.get(absolutePath);

    if (!backupPath || !existsSync(backupPath)) {
      return {
        success: false,
        error: "未找到备份文件",
      };
    }

    try {
      const content = await readFile(backupPath, "utf-8");
      await writeFile(absolutePath, content, "utf-8");

      logger.info("backup_restored", {
        original: absolutePath,
        backup: backupPath,
      });

      return {
        success: true,
        path: absolutePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 列出目录结构
   */
  async listDirectory(
    dirPath: string,
    options?: { maxDepth?: number; includeHidden?: boolean }
  ): Promise<DirectoryStructure | null> {
    const { maxDepth = 3, includeHidden = false } = options || {};
    const absolutePath = this.resolvePath(dirPath);

    try {
      await this.checkPathSafety(absolutePath);
      const structure = await this.buildDirectoryStructure(
        absolutePath,
        0,
        maxDepth,
        includeHidden
      );
      return structure;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("list_directory_failed", errorMsg, { path: absolutePath });
      return null;
    }
  }

  /**
   * 递归构建目录结构
   */
  private async buildDirectoryStructure(
    path: string,
    depth: number,
    maxDepth: number,
    includeHidden: boolean
  ): Promise<DirectoryStructure> {
    const stats = await stat(path);
    const name = path.split(/[\\/]/).pop() || path;

    if (!stats.isDirectory()) {
      return {
        path,
        name,
        type: "file",
        depth,
      };
    }

    const children: DirectoryStructure[] = [];
    
    if (depth < maxDepth) {
      const entries = await readdir(path, { withFileTypes: true });
      
      for (const entry of entries) {
        // 跳过隐藏文件（如果不包含）
        if (!includeHidden && entry.name.startsWith(".")) {
          continue;
        }

        // 跳过 node_modules、.git 等
        if (["node_modules", ".git", "dist", "build"].includes(entry.name)) {
          continue;
        }

        const childPath = join(path, entry.name);
        const child = await this.buildDirectoryStructure(
          childPath,
          depth + 1,
          maxDepth,
          includeHidden
        );
        children.push(child);
      }
    }

    return {
      path,
      name,
      type: "directory",
      children,
      depth,
    };
  }

  /**
   * 搜索文件
   */
  async searchFiles(
    pattern: string,
    basePath?: string
  ): Promise<string[]> {
    const searchBase = basePath ? this.resolvePath(basePath) : this.basePath;
    const results: string[] = [];

    const search = async (dir: string) => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) {
            continue;
          }

          const fullPath = join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await search(fullPath);
          } else if (entry.isFile()) {
            // 简单 glob 匹配
            if (this.matchGlob(entry.name, pattern)) {
              results.push(fullPath);
            }
          }
        }
      } catch {
        // 忽略错误
      }
    };

    await search(searchBase);
    return results;
  }

  /**
   * 简单 glob 匹配
   */
  private matchGlob(filename: string, pattern: string): boolean {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$"
    );
    return regex.test(filename);
  }

  /**
   * 解析路径（确保在 basePath 内）
   */
  private resolvePath(filePath: string): string {
    if (isAbsolute(filePath)) {
      return filePath;
    }
    return join(this.basePath, filePath);
  }

  /**
   * 路径安全检查
   */
  private async checkPathSafety(absolutePath: string): Promise<void> {
    // 防止路径遍历攻击
    const normalized = relative(this.basePath, absolutePath);
    if (normalized.startsWith("..") || isAbsolute(normalized)) {
      throw new Error(`不安全的路径访问：${absolutePath}`);
    }

    // 检查是否允许访问
    const allowedPrefixes = ["apps/", "packages/", "services/", "database/", "src/"];
    const relPath = relative(this.basePath, absolutePath);
    
    if (!allowedPrefixes.some(prefix => relPath.startsWith(prefix) || relPath.startsWith(prefix.replace("/", "\\")))) {
      // 允许根目录文件（如 package.json）
      if (!relPath.includes("/") && !relPath.includes("\\")) {
        return;
      }
      throw new Error(`不允许访问此路径：${absolutePath}`);
    }
  }
}

/**
 * 创建文件系统工具实例
 */
export function createFileSystemTools(basePath: string): FileSystemTools {
  return new FileSystemTools(basePath);
}
