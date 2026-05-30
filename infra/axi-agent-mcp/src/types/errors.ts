/**
 * 自定义错误类型定义
 * 用于统一处理各种业务错误
 */

/**
 * 文件系统操作错误
 */
export class FileSystemError extends Error {
  path?: string;
  operation?: string;
  
  constructor(message: string, options?: { path?: string; operation?: string }) {
    super(message);
    this.name = 'FileSystemError';
    if (options) {
      this.path = options.path;
      this.operation = options.operation;
    }
  }
}

/**
 * 文件锁错误
 */
export class FileLockError extends Error {
  filePath?: string;
  ownerId?: string;
  timeout?: number;
  heldBy?: string;
  
  constructor(message: string, options?: { filePath?: string; ownerId?: string; timeout?: number; heldBy?: string }) {
    super(message);
    this.name = 'FileLockError';
    if (options) {
      this.filePath = options.filePath;
      this.ownerId = options.ownerId;
      this.timeout = options.timeout;
      this.heldBy = options.heldBy;
    }
  }
}

/**
 * 数据库操作错误
 */
export class DatabaseError extends Error {
  uri?: string;
  host?: string;
  database?: string;
  collection?: string;
  
  constructor(message: string, options?: { uri?: string; host?: string; database?: string; collection?: string }) {
    super(message);
    this.name = 'DatabaseError';
    if (options) {
      this.uri = options.uri;
      this.host = options.host;
      this.database = options.database;
      this.collection = options.collection;
    }
  }
}

/**
 * 代码存储错误
 */
export class CodeStoreError extends Error {
  filePath?: string;
  taskId?: string;
  rootPath?: string;
  
  constructor(message: string, options?: { filePath?: string; taskId?: string; rootPath?: string }) {
    super(message);
    this.name = 'CodeStoreError';
    if (options) {
      this.filePath = options.filePath;
      this.taskId = options.taskId;
      this.rootPath = options.rootPath;
    }
  }
}

/**
 * 缓存操作错误
 */
export class CacheError extends Error {
  key?: string;
  prefix?: string;
  
  constructor(message: string, options?: { key?: string; prefix?: string }) {
    super(message);
    this.name = 'CacheError';
    if (options) {
      this.key = options.key;
      this.prefix = options.prefix;
    }
  }
}

/**
 * 向量存储错误
 */
export class VectorStoreError extends Error {
  filePath?: string;
  collectionId?: string;
  
  constructor(message: string, options?: { filePath?: string; collectionId?: string }) {
    super(message);
    this.name = 'VectorStoreError';
    if (options) {
      this.filePath = options.filePath;
      this.collectionId = options.collectionId;
    }
  }
}

/**
 * 工作流错误
 */
export class WorkflowError extends Error {
  workflowId?: string;
  stepId?: string;
  
  constructor(message: string, options?: { workflowId?: string; stepId?: string }) {
    super(message);
    this.name = 'WorkflowError';
    if (options) {
      this.workflowId = options.workflowId;
      this.stepId = options.stepId;
    }
  }
}

/**
 * Git 操作错误
 */
export class GitError extends Error {
  args?: string[];
  command?: string;
  stdout?: string;
  stderr?: string;
  
  constructor(message: string, options?: { args?: string[]; command?: string; stdout?: string; stderr?: string }) {
    super(message);
    this.name = 'GitError';
    if (options) {
      this.args = options.args;
      this.command = options.command;
      this.stdout = options.stdout;
      this.stderr = options.stderr;
    }
  }
}

/**
 * 调度器错误
 */
export class SchedulerError extends Error {
  taskId?: string;
  
  constructor(message: string, options?: { taskId?: string }) {
    super(message);
    this.name = 'SchedulerError';
    if (options) {
      this.taskId = options.taskId;
    }
  }
}
