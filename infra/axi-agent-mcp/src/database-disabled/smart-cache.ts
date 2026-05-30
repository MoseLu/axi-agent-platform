/**
 * 智能缓存系统
 * 使用 Redis 实现多级缓存
 */

import { RedisClientType } from 'redis';
import { createHash } from 'crypto';
import { logger } from '../logger.js';

export interface CacheOptions {
  ttl?: number; // 过期时间（秒）
  prefix?: string; // 键前缀
  serialize?: boolean; // 是否序列化
}

export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  memoryUsage?: number;
}

export class SmartCache {
  private redisClient: RedisClientType;
  private readonly defaultTTL = 3600; // 1 小时
  private stats: { hits: number; misses: number } = { hits: 0, misses: 0 };

  constructor(redisClient: RedisClientType) {
    this.redisClient = redisClient;
  }

  /**
   * 生成缓存键
   */
  private generateKey(key: string, prefix?: string): string {
    const hash = createHash('md5').update(key).digest('hex');
    return prefix ? `${prefix}:${hash}` : `cache:${hash}`;
  }

  /**
   * 获取缓存
   */
  async get<T = any>(
    key: string,
    options?: CacheOptions
  ): Promise<T | null> {
    const cacheKey = this.generateKey(key, options?.prefix);

    try {
      const value = await this.redisClient.get(cacheKey);
      
      if (value === null) {
        this.stats.misses++;
        logger.debug("cache_miss", { key: cacheKey });
        return null;
      }

      this.stats.hits++;
      logger.debug("cache_hit", { key: cacheKey });

      if (options?.serialize !== false) {
        return JSON.parse(value) as T;
      }
      
      return value as T;
    } catch (error) {
      logger.error("cache_get_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 设置缓存
   */
  async set<T>(
    key: string,
    value: T,
    options?: CacheOptions
  ): Promise<boolean> {
    const cacheKey = this.generateKey(key, options?.prefix);
    const ttl = options?.ttl || this.defaultTTL;

    try {
      const serialized = options?.serialize !== false 
        ? JSON.stringify(value) 
        : (value as string);

      await this.redisClient.setEx(cacheKey, ttl, serialized);
      
      logger.debug("cache_set", { key: cacheKey, ttl });
      return true;
    } catch (error) {
      logger.error("cache_set_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 获取或设置（带回调）
   */
  async getOrSet<T>(
    key: string,
    getter: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // 尝试从缓存获取
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // 缓存未命中，执行 getter
    const value = await getter();

    // 存入缓存
    await this.set(key, value, options);

    return value;
  }

  /**
   * 删除缓存
   */
  async delete(key: string, prefix?: string): Promise<boolean> {
    const cacheKey = this.generateKey(key, prefix);

    try {
      await this.redisClient.del(cacheKey);
      logger.debug("cache_delete", { key: cacheKey });
      return true;
    } catch (error) {
      logger.error("cache_delete_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 批量删除（按前缀）
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    try {
      const keys = await this.redisClient.keys(`${prefix}:*`);
      
      if (keys.length === 0) {
        return 0;
      }

      await this.redisClient.del(keys);
      logger.info("cache_delete_by_prefix", { prefix, count: keys.length });
      return keys.length;
    } catch (error) {
      logger.error("cache_delete_by_prefix_failed", {
        prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key: string, prefix?: string): Promise<boolean> {
    const cacheKey = this.generateKey(key, prefix);

    try {
      const exists = await this.redisClient.exists(cacheKey);
      return exists === 1;
    } catch (error) {
      logger.error("cache_exists_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 获取剩余 TTL
   */
  async getTTL(key: string, prefix?: string): Promise<number> {
    const cacheKey = this.generateKey(key, prefix);

    try {
      return await this.redisClient.ttl(cacheKey);
    } catch (error) {
      logger.error("cache_ttl_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return -1;
    }
  }

  /**
   * 刷新 TTL
   */
  async refreshTTL(key: string, ttl: number, prefix?: string): Promise<boolean> {
    const cacheKey = this.generateKey(key, prefix);

    try {
      await this.redisClient.expire(cacheKey, ttl);
      logger.debug("cache_ttl_refreshed", { key: cacheKey, ttl });
      return true;
    } catch (error) {
      logger.error("cache_ttl_refresh_failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<CacheStats> {
    try {
      const keysCount = await this.redisClient.dbSize();
      const memoryInfo = await this.redisClient.info('memory');
      
      // 解析内存使用
      const memoryMatch = memoryInfo.match(/used_memory:(\d+)/);
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1], 10) : undefined;

      return {
        hits: this.stats.hits,
        misses: this.stats.misses,
        keys: keysCount,
        memoryUsage,
      };
    } catch (error) {
      logger.error("cache_stats_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        hits: this.stats.hits,
        misses: this.stats.misses,
        keys: 0,
      };
    }
  }

  /**
   * 获取命中率
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return this.stats.hits / total;
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0 };
    logger.info("cache_stats_reset");
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    try {
      await this.redisClient.flushDb();
      logger.info("cache_cleared");
    } catch (error) {
      logger.error("cache_clear_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * 缓存装饰器
 */
export function Cached(options?: CacheOptions) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const cache = target.cache as SmartCache;

    if (!cache) {
      throw new Error("Cache not initialized");
    }

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`;
      
      // 尝试从缓存获取
      const cached = await cache.get(cacheKey, options);
      if (cached !== null) {
        return cached;
      }

      // 执行原方法
      const result = await originalMethod.apply(this, args);

      // 存入缓存
      await cache.set(cacheKey, result, options);

      return result;
    };

    return descriptor;
  };
}
