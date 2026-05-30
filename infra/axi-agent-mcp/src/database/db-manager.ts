/**
 * 数据库配置和连接管理
 * 支持 PostgreSQL (pgvector), MongoDB, Redis
 */

import { Pool } from 'pg';
import { MongoClient, Db } from 'mongodb';
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("db_connect_failed", errorMsg);
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
        logger.info("pgvector_enabled");
      } catch {
        logger.warn("pgvector_not_available");
      }

      logger.info("postgresql_connected", { host, database });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("postgresql_connect_failed", errorMsg, { host, database });
      throw error;
    }
  }

  /**
   * 连接 MongoDB
   */
  private async connectMongoDB(): Promise<void> {
    const { uri, database } = this.config.mongodb;

    try {
      this.mongoClient = new MongoClient(uri);
      await this.mongoClient.connect();
      this.mongoDb = this.mongoClient.db(database);

      // 测试连接
      await this.mongoDb.command({ ping: 1 });

      logger.info("mongodb_connected", { uri: uri.substring(0, 20) + "...", database });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("mongodb_connect_failed", errorMsg, { uri: uri.substring(0, 20) + "...", database });
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

      await this.redisClient.connect();

      // 测试连接
      await this.redisClient.ping();

      logger.info("redis_connected", { host, port });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("redis_connect_failed", errorMsg, { host, port });
      throw error;
    }
  }

  /**
   * 断开所有连接
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      // 断开 PostgreSQL
      if (this.pgPool) {
        await this.pgPool.end();
        logger.info("postgresql_disconnected");
      }

      // 断开 MongoDB
      if (this.mongoClient) {
        await this.mongoClient.close();
        logger.info("mongodb_disconnected");
      }

      // 断开 Redis
      if (this.redisClient) {
        await this.redisClient.quit();
        logger.info("redis_disconnected");
      }

      this.connected = false;
    } catch (error) {
      logger.error("db_disconnect_failed", error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 获取 PostgreSQL 连接池
   */
  getPostgresPool(): Pool {
    if (!this.pgPool) {
      throw new Error("PostgreSQL 未连接");
    }
    return this.pgPool;
  }

  /**
   * 获取 MongoDB 数据库
   */
  getMongoDb(): Db {
    if (!this.mongoDb) {
      throw new Error("MongoDB 未连接");
    }
    return this.mongoDb;
  }

  /**
   * 获取 Redis 客户端
   */
  getRedisClient(): RedisClientType {
    if (!this.redisClient) {
      throw new Error("Redis 未连接");
    }
    return this.redisClient;
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 获取连接统计
   */
  getStats() {
    return {
      connected: this.connected,
      postgresql: !!this.pgPool,
      mongodb: !!this.mongoDb,
      redis: !!this.redisClient,
    };
  }
}

/**
 * 从环境变量加载配置
 */
export function loadDatabaseConfig(): DatabaseConfig {
  const pgPassword = process.env.DB_POSTGRESQL_PASSWORD;
  const redisPassword = process.env.DB_REDIS_PASSWORD;
  
  return {
    postgresql: {
      host: process.env.DB_POSTGRESQL_HOST || 'localhost',
      port: parseInt(process.env.DB_POSTGRESQL_PORT || '5432', 10),
      database: process.env.DB_POSTGRESQL_DATABASE || 'mcp_swarm',
      user: process.env.DB_POSTGRESQL_USER || 'postgres',
      password: pgPassword !== undefined ? pgPassword : '',
    },
    mongodb: {
      uri: process.env.DB_MONGODB_URI || 'mongodb://localhost:27017',
      database: process.env.DB_MONGODB_DATABASE || 'mcp_swarm',
    },
    redis: {
      host: process.env.DB_REDIS_HOST || 'localhost',
      port: parseInt(process.env.DB_REDIS_PORT || '6379', 10),
      password: redisPassword !== undefined ? redisPassword : undefined,
    },
  };
}
