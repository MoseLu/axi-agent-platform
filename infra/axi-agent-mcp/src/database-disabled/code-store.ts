/**
 * MongoDB 代码存储
 * 存储代码片段、执行历史等
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { logger } from '../logger.js';

export interface CodeSnippet {
  _id?: ObjectId;
  filePath: string;
  code: string;
  language: string;
  symbols: string[];
  metadata: {
    size: number;
    lines: number;
    lastModified: Date;
  };
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionHistory {
  _id?: ObjectId;
  taskId: string;
  type: 'lint' | 'test' | 'build' | 'git' | 'other';
  command: string;
  success: boolean;
  output: string;
  errors?: string[];
  duration: number;
  projectRoot: string;
  executedAt: Date;
}

export interface ProjectInfo {
  _id?: ObjectId;
  name: string;
  rootPath: string;
  techStack: any;
  lastIndexedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class CodeStore {
  private db: Db;
  private snippetsCollection: Collection<CodeSnippet>;
  private historyCollection: Collection<ExecutionHistory>;
  private projectsCollection: Collection<ProjectInfo>;

  constructor(db: Db) {
    this.db = db;
    this.snippetsCollection = db.collection<CodeSnippet>('code_snippets');
    this.historyCollection = db.collection<ExecutionHistory>('execution_history');
    this.projectsCollection = db.collection<ProjectInfo>('projects');
  }

  /**
   * 初始化索引
   */
  async initialize(): Promise<void> {
    try {
      // 创建索引
      await this.snippetsCollection.createIndex({ filePath: 1 });
      await this.snippetsCollection.createIndex({ language: 1 });
      await this.snippetsCollection.createIndex({ symbols: 1 });
      await this.snippetsCollection.createIndex({ tags: 1 });
      await this.snippetsCollection.createIndex({ createdAt: -1 });

      await this.historyCollection.createIndex({ taskId: 1 });
      await this.historyCollection.createIndex({ type: 1 });
      await this.historyCollection.createIndex({ executedAt: -1 });

      await this.projectsCollection.createIndex({ rootPath: 1 }, { unique: true });
      await this.projectsCollection.createIndex({ name: 1 });

      logger.info("mongodb_indexes_created");
    } catch (error) {
      logger.error("mongodb_index_creation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 存储代码片段
   */
  async storeSnippet(snippet: Omit<CodeSnippet, '_id' | 'createdAt' | 'updatedAt'>): Promise<ObjectId> {
    const now = new Date();
    
    try {
      const result = await this.snippetsCollection.updateOne(
        { filePath: snippet.filePath },
        {
          $set: {
            ...snippet,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      );

      const id = result.upsertedId?._id || (await this.snippetsCollection.findOne({ filePath: snippet.filePath }))?._id;
      
      logger.debug("snippet_stored", { filePath: snippet.filePath, language: snippet.language });
      return id as ObjectId;
    } catch (error) {
      logger.error("snippet_store_failed", {
        filePath: snippet.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 批量存储代码片段
   */
  async storeBatch(snippets: Array<Omit<CodeSnippet, '_id' | 'createdAt' | 'updatedAt'>>): Promise<number> {
    const now = new Date();
    
    try {
      const bulkOps = snippets.map(snippet => ({
        updateOne: {
          filter: { filePath: snippet.filePath },
          update: {
            $set: {
              ...snippet,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        } as any,
      }));

      const result = await this.snippetsCollection.bulkWrite(bulkOps);
      
      logger.info("snippets_batch_stored", {
        total: snippets.length,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
      });
      
      return result.modifiedCount + result.upsertedCount;
    } catch (error) {
      logger.error("snippets_batch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 搜索代码片段
   */
  async searchSnippets(query: {
    language?: string;
    symbols?: string[];
    tags?: string[];
    filePathPattern?: string;
  }, limit: number = 20): Promise<CodeSnippet[]> {
    try {
      const filter: any = {};

      if (query.language) {
        filter.language = query.language;
      }

      if (query.symbols && query.symbols.length > 0) {
        filter.symbols = { $in: query.symbols };
      }

      if (query.tags && query.tags.length > 0) {
        filter.tags = { $in: query.tags };
      }

      if (query.filePathPattern) {
        filter.filePath = { $regex: query.filePathPattern, $options: 'i' };
      }

      const results = await this.snippetsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return results;
    } catch (error) {
      logger.error("snippet_search_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 记录执行历史
   */
  async recordExecution(history: Omit<ExecutionHistory, '_id' | 'executedAt'>): Promise<ObjectId> {
    const doc: Omit<ExecutionHistory, '_id'> = {
      ...history,
      executedAt: new Date(),
    };

    try {
      const result = await this.historyCollection.insertOne(doc as any);
      
      logger.debug("execution_recorded", {
        taskId: history.taskId,
        type: history.type,
        success: history.success,
      });
      
      return result.insertedId;
    } catch (error) {
      logger.error("execution_record_failed", {
        taskId: history.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取执行历史
   */
  async getExecutionHistory(taskId?: string, limit: number = 50): Promise<ExecutionHistory[]> {
    try {
      const filter: any = {};
      
      if (taskId) {
        filter.taskId = taskId;
      }

      const results = await this.historyCollection
        .find(filter)
        .sort({ executedAt: -1 })
        .limit(limit)
        .toArray();

      return results;
    } catch (error) {
      logger.error("execution_history_fetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 存储项目信息
   */
  async storeProject(project: Omit<ProjectInfo, '_id' | 'createdAt' | 'updatedAt'>): Promise<ObjectId> {
    const now = new Date();

    try {
      const result = await this.projectsCollection.updateOne(
        { rootPath: project.rootPath },
        {
          $set: {
            ...project,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      );

      const id = result.upsertedId?._id || (await this.projectsCollection.findOne({ rootPath: project.rootPath }))?._id;
      
      logger.info("project_stored", { name: project.name, rootPath: project.rootPath });
      return id as ObjectId;
    } catch (error) {
      logger.error("project_store_failed", {
        rootPath: project.rootPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取项目信息
   */
  async getProject(rootPath: string): Promise<ProjectInfo | null> {
    try {
      return await this.projectsCollection.findOne({ rootPath });
    } catch (error) {
      logger.error("project_fetch_failed", {
        rootPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalSnippets: number;
    totalExecutions: number;
    totalProjects: number;
    snippetsByLanguage: Record<string, number>;
  }> {
    try {
      const totalSnippets = await this.snippetsCollection.countDocuments();
      const totalExecutions = await this.historyCollection.countDocuments();
      const totalProjects = await this.projectsCollection.countDocuments();

      // 按语言统计
      const langStats = await this.snippetsCollection.aggregate([
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();

      const snippetsByLanguage: Record<string, number> = {};
      for (const stat of langStats) {
        snippetsByLanguage[stat._id] = stat.count;
      }

      return {
        totalSnippets,
        totalExecutions,
        totalProjects,
        snippetsByLanguage,
      };
    } catch (error) {
      logger.error("stats_fetch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalSnippets: 0,
        totalExecutions: 0,
        totalProjects: 0,
        snippetsByLanguage: {},
      };
    }
  }
}
