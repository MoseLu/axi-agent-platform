/**
 * 向量数据库集成
 * 使用 PostgreSQL pgvector 进行代码嵌入和语义搜索
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import { logger } from '../logger.js';

export interface CodeEmbedding {
  id: string;
  filePath: string;
  code: string;
  embedding: number[];
  language: string;
  symbols: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SearchResult {
  filePath: string;
  code: string;
  similarity: number;
  language: string;
  symbols: string[];
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  language?: string;
  filePathPattern?: string;
}

export class VectorStore {
  private pgPool: Pool;
  private readonly tableName = 'code_embeddings';
  private readonly embeddingDimension = 1536; // OpenAI embedding 维度

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  /**
   * 初始化数据库表
   */
  async initialize(): Promise<void> {
    try {
      // 创建扩展
      await this.pgPool.query('CREATE EXTENSION IF NOT EXISTS vector');

      // 创建表
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id VARCHAR(64) PRIMARY KEY,
          file_path TEXT NOT NULL,
          code TEXT NOT NULL,
          embedding vector(${this.embeddingDimension}),
          language VARCHAR(32) NOT NULL,
          symbols TEXT[] NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // 创建索引
      await this.pgPool.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_embedding 
        ON ${this.tableName} 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      await this.pgPool.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_file_path 
        ON ${this.tableName} (file_path)
      `);

      await this.pgPool.query(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_language 
        ON ${this.tableName} (language)
      `);

      logger.info("vector_store_initialized", {
        table: this.tableName,
        dimension: this.embeddingDimension,
      });
    } catch (error) {
      logger.error("vector_store_init_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 生成代码的 hash
   */
  private generateId(code: string, filePath: string): string {
    return createHash('sha256')
      .update(`${filePath}:${code}`)
      .digest('hex')
      .substring(0, 64);
  }

  /**
   * 存储代码嵌入
   */
  async storeEmbedding(
    filePath: string,
    code: string,
    embedding: number[],
    language: string,
    symbols: string[] = []
  ): Promise<void> {
    const id = this.generateId(code, filePath);
    const now = new Date();

    try {
      await this.pgPool.query(
        `INSERT INTO ${this.tableName} (id, file_path, code, embedding, language, symbols, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           code = EXCLUDED.code,
           embedding = EXCLUDED.embedding,
           language = EXCLUDED.language,
           symbols = EXCLUDED.symbols,
           updated_at = EXCLUDED.updated_at`,
        [id, filePath, code, `[${embedding.join(',')}]`, language, `{${symbols.join(',')}}`, now, now]
      );

      logger.debug("vector_stored", { filePath, language, symbols: symbols.length });
    } catch (error) {
      logger.error("vector_store_failed", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 批量存储
   */
  async storeBatch(embeddings: Array<{
    filePath: string;
    code: string;
    embedding: number[];
    language: string;
    symbols?: string[];
  }>): Promise<number> {
    const client = await this.pgPool.connect();
    
    try {
      await client.query('BEGIN');
      
      let count = 0;
      for (const emb of embeddings) {
        try {
          await this.storeEmbedding(
            emb.filePath,
            emb.code,
            emb.embedding,
            emb.language,
            emb.symbols || []
          );
          count++;
        } catch (error) {
          logger.warn("vector_store_batch_item_failed", {
            filePath: emb.filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      await client.query('COMMIT');
      logger.info("vector_store_batch_complete", { total: embeddings.length, success: count });
      return count;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error("vector_store_batch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 语义搜索
   */
  async search(
    queryEmbedding: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const {
      limit = 10,
      threshold = 0.7,
      language,
      filePathPattern,
    } = options || {};

    try {
      let sql = `
        SELECT 
          file_path,
          code,
          language,
          symbols,
          1 - (embedding <=> $1::vector) as similarity
        FROM ${this.tableName}
        WHERE 1 - (embedding <=> $1::vector) >= $2
      `;

      const params: any[] = [`[${queryEmbedding.join(',')}]`, threshold];
      let paramIndex = 3;

      if (language) {
        sql += ` AND language = $${paramIndex}`;
        params.push(language);
        paramIndex++;
      }

      if (filePathPattern) {
        sql += ` AND file_path LIKE $${paramIndex}`;
        params.push(`%${filePathPattern}%`);
        paramIndex++;
      }

      sql += ` ORDER BY similarity DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await this.pgPool.query(sql, params);

      return result.rows.map(row => ({
        filePath: row.file_path,
        code: row.code,
        similarity: parseFloat(row.similarity),
        language: row.language,
        symbols: row.symbols || [],
      }));
    } catch (error) {
      logger.error("vector_search_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 查找相似代码
   */
  async findSimilarCode(
    code: string,
    embedding: number[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    // 排除自身
    const codeId = this.generateId(code, '');
    
    const results = await this.search(embedding, options);
    
    return results.filter(r => {
      const resultId = this.generateId(r.code, r.filePath);
      return resultId !== codeId;
    });
  }

  /**
   * 按文件路径删除
   */
  async deleteByFilePath(filePath: string): Promise<number> {
    try {
      const result = await this.pgPool.query(
        `DELETE FROM ${this.tableName} WHERE file_path = $1`,
        [filePath]
      );
      
      logger.info("vector_deleted", { filePath, count: result.rowCount });
      return result.rowCount || 0;
    } catch (error) {
      logger.error("vector_delete_failed", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalCount: number;
    languageCount: Record<string, number>;
    avgSymbolsPerFile: number;
  }> {
    try {
      // 总数
      const totalResult = await this.pgPool.query(
        `SELECT COUNT(*) FROM ${this.tableName}`
      );
      const totalCount = parseInt(totalResult.rows[0].count, 10);

      // 按语言统计
      const langResult = await this.pgPool.query(
        `SELECT language, COUNT(*) as count 
         FROM ${this.tableName} 
         GROUP BY language 
         ORDER BY count DESC`
      );
      const languageCount: Record<string, number> = {};
      for (const row of langResult.rows) {
        languageCount[row.language] = parseInt(row.count, 10);
      }

      // 平均符号数
      const avgResult = await this.pgPool.query(
        `SELECT AVG(array_length(symbols, 1)) as avg_symbols 
         FROM ${this.tableName} 
         WHERE array_length(symbols, 1) > 0`
      );
      const avgSymbolsPerFile = parseFloat(avgResult.rows[0].avg_symbols || '0');

      return {
        totalCount,
        languageCount,
        avgSymbolsPerFile,
      };
    } catch (error) {
      logger.error("vector_stats_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalCount: 0,
        languageCount: {},
        avgSymbolsPerFile: 0,
      };
    }
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    try {
      await this.pgPool.query(`TRUNCATE ${this.tableName}`);
      logger.info("vector_store_cleared");
    } catch (error) {
      logger.error("vector_clear_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
