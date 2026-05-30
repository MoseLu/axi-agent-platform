/**
 * 代码存储（使用 MongoDB）
 */

import { Db, Collection, ObjectId } from 'mongodb';
import { logger } from '../logger.js';

export interface CodeDocument {
  _id?: ObjectId;
  filePath: string;
  content: string;
  language: string;
  metadata?: {
    size: number;
    lines: number;
    lastModified: Date;
    gitHash?: string;
  };
  embeddings?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export class CodeStore {
  private db: Db;
  private collection: Collection<CodeDocument>;

  constructor(db: Db, collectionName: string = 'code') {
    this.db = db;
    this.collection = db.collection<CodeDocument>(collectionName);
  }

  /**
   * 创建索引
   */
  async createIndexes(): Promise<void> {
    await this.collection.createIndex({ filePath: 1 }, { unique: true });
    await this.collection.createIndex({ language: 1 });
    await this.collection.createIndex({ "metadata.gitHash": 1 });
    
    // 如果有 embeddings，创建向量索引（需要 MongoDB Atlas）
    // 注释掉，因为需要 MongoDB Atlas 或特殊配置
    // await this.collection.createIndex({ embeddings: "vector" });
    
    logger.info("code_store_indexes_created");
  }

  /**
   * 存储代码
   */
  async upsert(doc: Omit<CodeDocument, '_id' | 'createdAt' | 'updatedAt'>): Promise<ObjectId> {
    const now = new Date();
    
    const result = await this.collection.findOneAndUpdate(
      { filePath: doc.filePath },
      {
        $set: {
          ...doc,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result) {
      throw new Error("Failed to upsert code document");
    }

    const id = result._id || new ObjectId();
    logger.info("code_upserted", { filePath: doc.filePath, id });
    return id;
  }

  /**
   * 批量存储代码
   */
  async upsertBatch(docs: Omit<CodeDocument, '_id' | 'createdAt' | 'updatedAt'>[]): Promise<number> {
    const operations = docs.map(doc => ({
      updateOne: {
        filter: { filePath: doc.filePath },
        update: {
          $set: {
            ...doc,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await this.collection.bulkWrite(operations);
    logger.info("code_batch_upserted", { 
      inserted: result.upsertedCount, 
      modified: result.modifiedCount 
    });
    
    return result.upsertedCount + result.modifiedCount;
  }

  /**
   * 获取代码
   */
  async getByPath(filePath: string): Promise<CodeDocument | null> {
    return await this.collection.findOne({ filePath });
  }

  /**
   * 按语言获取代码
   */
  async getByLanguage(language: string, limit: number = 100): Promise<CodeDocument[]> {
    return await this.collection
      .find({ language })
      .limit(limit)
      .toArray();
  }

  /**
   * 搜索代码（基于元数据）
   */
  async search(query: {
    language?: string;
    minLines?: number;
    maxLines?: number;
    gitHash?: string;
  }, limit: number = 100): Promise<CodeDocument[]> {
    const filter: Record<string, any> = {};

    if (query.language) {
      filter.language = query.language;
    }

    if (query.minLines !== undefined || query.maxLines !== undefined) {
      filter['metadata.lines'] = {};
      if (query.minLines !== undefined) {
        filter['metadata.lines'].$gte = query.minLines;
      }
      if (query.maxLines !== undefined) {
        filter['metadata.lines'].$lte = query.maxLines;
      }
    }

    if (query.gitHash) {
      filter['metadata.gitHash'] = query.gitHash;
    }

    return await this.collection.find(filter).limit(limit).toArray();
  }

  /**
   * 删除代码
   */
  async deleteByPath(filePath: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ filePath });
    const deleted = result.deletedCount > 0;
    logger.info("code_deleted", { filePath, deleted });
    return deleted;
  }

  /**
   * 统计信息
   */
  async stats(): Promise<{
    totalFiles: number;
    totalLines: number;
    byLanguage: Record<string, number>;
  }> {
    const totalFiles = await this.collection.countDocuments();
    
    const linesResult = await this.collection.aggregate([
      { $group: { _id: null, totalLines: { $sum: "$metadata.lines" } } }
    ]).toArray();
    
    const languageResult = await this.collection.aggregate([
      { $group: { _id: "$language", count: { $sum: 1 } } }
    ]).toArray();

    const byLanguage: Record<string, number> = {};
    for (const item of languageResult) {
      byLanguage[item._id] = item.count;
    }

    return {
      totalFiles,
      totalLines: linesResult[0]?.totalLines || 0,
      byLanguage,
    };
  }

  /**
   * 清空集合
   */
  async clear(): Promise<void> {
    await this.collection.deleteMany({});
    logger.info("code_store_cleared");
  }
}
