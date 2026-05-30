/**
 * 向量存储（使用 PostgreSQL pgvector）
 */

import { Pool } from 'pg';
import { logger } from '../logger.js';

export interface VectorDocument {
  id?: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

export class VectorStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * 创建向量表
   */
  async createTable(tableName: string = 'vectors', dimensions: number = 1536): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        embedding vector(${dimensions}),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 创建向量索引
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${tableName}_embedding_idx 
      ON ${tableName} 
      USING ivfflat (embedding vector_cosine_ops)
    `);

    logger.info("vector_table_created", { tableName, dimensions });
  }

  /**
   * 插入向量
   */
  async insert(doc: VectorDocument, tableName: string = 'vectors'): Promise<string> {
    const { content, embedding, metadata } = doc;
    
    const result = await this.pool.query(
      `INSERT INTO ${tableName} (content, embedding, metadata)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [content, `[${embedding.join(',')}]`, metadata ? JSON.stringify(metadata) : null]
    );

    const id = result.rows[0].id;
    logger.info("vector_inserted", { id, tableName });
    return id;
  }

  /**
   * 批量插入向量
   */
  async insertBatch(docs: VectorDocument[], tableName: string = 'vectors'): Promise<string[]> {
    const ids: string[] = [];
    
    for (const doc of docs) {
      const id = await this.insert(doc, tableName);
      ids.push(id);
    }

    logger.info("vector_batch_inserted", { count: ids.length, tableName });
    return ids;
  }

  /**
   * 相似度搜索
   */
  async similaritySearch(
    query: number[],
    limit: number = 10,
    tableName: string = 'vectors'
  ): Promise<Array<VectorDocument & { id: string; similarity: number }>> {
    const result = await this.pool.query(
      `SELECT id, content, embedding, metadata, 
              1 - (embedding <=> $1::vector) as similarity
       FROM ${tableName}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [`[${query.join(',')}]`, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      content: row.content,
      embedding: JSON.parse(`[${row.embedding}]`),
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  }

  /**
   * 删除向量
   */
  async delete(id: string, tableName: string = 'vectors'): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${tableName} WHERE id = $1`,
      [id]
    );

    const deleted = (result.rowCount || 0) > 0;
    logger.info("vector_deleted", { id, deleted });
    return deleted;
  }

  /**
   * 清空表
   */
  async clear(tableName: string = 'vectors'): Promise<void> {
    await this.pool.query(`TRUNCATE ${tableName}`);
    logger.info("vector_table_cleared", { tableName });
  }

  /**
   * 获取统计信息
   */
  async stats(tableName: string = 'vectors'): Promise<{ count: number }> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM ${tableName}`
    );

    return {
      count: parseInt(result.rows[0].count, 10),
    };
  }
}
