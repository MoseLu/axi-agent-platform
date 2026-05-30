/**
 * 智能缓存（使用 Redis）
 */

import { RedisClientType } from 'redis';
import { logger } from '../logger.js';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl?: number; // 生存时间（秒）
}

export class SmartCache {
  private client: RedisClientType;
  private defaultTTL: number;

  constructor(client: RedisClientType, defaultTTL: number = 3600) {
    this.client = client;
    this.defaultTTL = defaultTTL;
  }

  /**
   * 获取缓存
   */
  async get<T>(key: string): Promise<T | null> {
    const cached = await this.client.get(key);
    
    if (!cached) {
      return null;
    }

    try {
      const entry: CacheEntry<T> = JSON.parse(cached);
      
      // 检查是否过期
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl * 1000) {
        await this.delete(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      logger.error("cache_parse_error", error instanceof Error ? error.message : String(error), { key });
      return null;
    }
  }

  /**
   * 设置缓存
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    };

    await this.client.set(key, JSON.stringify(entry));
    
    if (entry.ttl) {
      await this.client.expire(key, entry.ttl);
    }

    logger.debug("cache_set", { key, ttl: entry.ttl });
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<number> {
    const result = await this.client.del(key);
    logger.debug("cache_deleted", { key });
    return result;
  }

  /**
   * 检查键是否存在
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  /**
   * 批量获取
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    const values = await this.client.mGet(keys);
    
    return values.map((value, index) => {
      if (!value) return null;
      
      try {
        const entry: CacheEntry<T> = JSON.parse(value);
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl * 1000) {
          this.delete(keys[index]);
          return null;
        }
        return entry.data;
      } catch {
        return null;
      }
    });
  }

  /**
   * 批量设置
   */
  async mset<T>(entries: Array<{ key: string; data: T; ttl?: number }>): Promise<void> {
    const multi = this.client.multi();
    
    for (const { key, data, ttl } of entries) {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl ?? this.defaultTTL,
      };
      multi.set(key, JSON.stringify(entry));
      if (entry.ttl) {
        multi.expire(key, entry.ttl);
      }
    }

    await multi.exec();
    logger.debug("cache_batch_set", { count: entries.length });
  }

  /**
   * 获取所有匹配的键
   */
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    await this.client.flushDb();
    logger.info("cache_cleared");
  }

  /**
   * 获取统计信息
   */
  async stats(): Promise<{
    totalKeys: number;
    memoryUsage: number;
  }> {
    const dbSize = await this.client.dbSize();
    
    // Redis memory 命令可能不可用，使用 try-catch
    let memory = 0;
    try {
      memory = await this.client.info('memory') as any;
    } catch {
      memory = 0;
    }

    return {
      totalKeys: dbSize,
      memoryUsage: memory,
    };
  }
}
