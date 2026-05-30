/**
 * 数据库配置和连接管理
 * 支持 PostgreSQL (pgvector), MongoDB, Redis
 */

import { Pool } from 'pg';
import { MongoClient, Db, Collection } from 'mongodb';
import { createClient, RedisClientType } from 'redis';
import { logger } from '../logger.js';

export interface DatabaseConfig {
  postgresql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  mongodb: {
    uri: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

export class DatabaseManager {
  private config: DatabaseConfig;
  private pgPool?: Pool;
  private mongoClient?: MongoClient;
  private mongoDb?: Db;
  private redisClient?: RedisClientType;
  private connected = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * 连接所有数据库
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn("db_already_connected");
      return;
    }

    try {
      // 连接 PostgreSQL
      await this.connectPostgreSQL();
      
      // 连接 MongoDB
      await this.connectMongoDB();
      
      // 连接 Redis
      await this.connectRedis();

      this.connected = true;
      logger.info("db_all_connected", {
        postgresql: !!this.pgPool,
        mongodb: !!this.mongoDb,
        redis: !!this.redisClient,
      });
    } catch (error) {
      logger.error("db_connect_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 连接 PostgreSQL
   */
  private async connectPostgreSQL(): Promise<void> {
    const { host, port, database, user, password } = this.config.postgresql;

    try {
      this.pgPool = new Pool({
        host,
        port,
        database,
        user,
        password,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // 测试连接
      const client = await this.pgPool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // 检查 pgvector 扩展
      try {
        await this.pgPool.query('CREATE EXTENSION IF NOT EXISTS vector');
        logger.info("postgresql_connected", { host, port, database, hasVector: true });
      } catch {
        logger.warn("postgresql_no_vector_extension", { host, port, database });
      }
    } catch (error) {
      logger.error("postgresql_connect_failed", {
        host,
        port,
        database,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 连接 MongoDB
   */
  private async connectMongoDB(): Promise<void> {
    const { uri, database } = this.config.mongodb;

    try {
      this.mongoClient = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
      });

      await this.mongoClient.connect();
      this.mongoDb = this.mongoClient.db(database);

      // 测试连接
      await this.mongoDb.admin().ping();

      logger.info("mongodb_connected", { uri: uri.replace(/\/\/.*@/, '//***@'), database });
    } catch (error) {
      logger.error("mongodb_connect_failed", {
        uri: uri.replace(/\/\/.*@/, '//***@'),
        database,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 连接 Redis
   */
  private async connectRedis(): Promise<void> {
    const { host, port, password } = this.config.redis;

    try {
      this.redisClient = createClient({
        socket: {
          host,
          port,
        },
        password,
      });

      this.redisClient.on('error', (err) => {
        logger.error("redis_error", { error: err.message });
      });

      await this.redisClient.connect();
      await this.redisClient.ping();

      logger.info("redis_connected", { host, port });
    } catch (error) {
      logger.error("redis_connect_failed", {
        host,
        port,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取 PostgreSQL 连接池
   */
  getPostgreSQL(): Pool {
    if (!this.pgPool) {
      throw new Error("PostgreSQL 未连接");
    }
    return this.pgPool;
  }

  /**
   * 获取 MongoDB 数据库
   */
  getMongoDB(): Db {
    if (!this.mongoDb) {
      throw new Error("MongoDB 未连接");
    }
    return this.mongoDb;
  }

  /**
   * 获取 MongoDB Collection
   */
  getCollection<T = any>(name: string): Collection<T> {
    return this.getMongoDB().collection<T>(name);
  }

  /**
   * 获取 Redis 客户端
   */
  getRedis(): RedisClientType {
    if (!this.redisClient) {
      throw new Error("Redis 未连接");
    }
    return this.redisClient;
  }

  /**
   * 检查连接状态
   */
  async checkHealth(): Promise<{
    postgresql: boolean;
    mongodb: boolean;
    redis: boolean;
  }> {
    const result = {
      postgresql: false,
      mongodb: false,
      redis: false,
    };

    // 检查 PostgreSQL
    try {
      if (this.pgPool) {
        const client = await this.pgPool.connect();
        await client.query('SELECT 1');
        client.release();
        result.postgresql = true;
      }
    } catch {
      // 忽略
    }

    // 检查 MongoDB
    try {
      if (this.mongoDb) {
        await this.mongoDb.admin().ping();
        result.mongodb = true;
      }
    } catch {
      // 忽略
    }

    // 检查 Redis
    try {
      if (this.redisClient) {
        await this.redisClient.ping();
        result.redis = true;
      }
    } catch {
      // 忽略
    }

    return result;
  }

  /**
   * 关闭所有连接
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      // 关闭 PostgreSQL
      if (this.pgPool) {
        await this.pgPool.end();
        logger.info("postgresql_disconnected");
      }

      // 关闭 MongoDB
      if (this.mongoClient) {
        await this.mongoClient.close();
        logger.info("mongodb_disconnected");
      }

      // 关闭 Redis
      if (this.redisClient) {
        await this.redisClient.quit();
        logger.info("redis_disconnected");
      }

      this.connected = false;
    } catch (error) {
      logger.error("db_disconnect_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// 从环境变量加载配置
export function loadDatabaseConfig(): DatabaseConfig {
  return {
    postgresql: {
      host: process.env.DB_POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.DB_POSTGRES_PORT || '5432', 10),
      database: process.env.DB_POSTGRES_DB || 'code_swarm',
      user: process.env.DB_POSTGRES_USER || 'postgres',
      password: process.env.DB_POSTGRES_PASSWORD || 'postgres',
    },
    mongodb: {
      uri: process.env.DB_MONGODB_URI || 'mongodb://localhost:27017',
      database: process.env.DB_MONGODB_DB || 'code_swarm',
    },
    redis: {
      host: process.env.DB_REDIS_HOST || 'localhost',
      port: parseInt(process.env.DB_REDIS_PORT || '6379', 10),
      password: process.env.DB_REDIS_PASSWORD,
    },
  };
}

// 导出单例实例
export const dbManager = new DatabaseManager(loadDatabaseConfig());
