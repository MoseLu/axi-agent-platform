/**
 * 文件锁机制
 * 防止多 Agent 同时修改同一文件导致冲突
 */

import { EventEmitter } from "node:events";
import { logger } from "../logger.js";

export interface LockInfo {
  filePath: string;
  ownerId: string;
  acquiredAt: Date;
  expiresAt: Date;
  purpose?: string;
}

export interface LockOptions {
  timeout?: number; // 获取锁的超时时间（毫秒）
  expiresIn?: number; // 锁的有效期（毫秒）
  retryInterval?: number; // 重试间隔（毫秒）
}

export class FileLockManager extends EventEmitter {
  private locks: Map<string, LockInfo> = new Map();
  private waitQueue: Map<string, Array<{
    ownerId: string;
    resolve: () => void;
    reject: (error: Error) => void;
  }>> = new Map();
  
  private readonly defaultTimeout = 30000; // 30 秒
  private readonly defaultExpiresIn = 300000; // 5 分钟
  private readonly defaultRetryInterval = 100; // 100 毫秒

  /**
   * 获取文件锁
   */
  async acquireLock(
    filePath: string,
    ownerId: string,
    options?: LockOptions
  ): Promise<boolean> {
    const {
      timeout = this.defaultTimeout,
      expiresIn = this.defaultExpiresIn,
      retryInterval = this.defaultRetryInterval,
    } = options || {};

    const startTime = Date.now();

    logger.info("lock_acquire_request", {
      filePath,
      ownerId,
      timeout,
    });

    while (Date.now() - startTime < timeout) {
      // 尝试获取锁
      const acquired = this.tryAcquireLock(filePath, ownerId, expiresIn);
      
      if (acquired) {
        logger.info("lock_acquired", {
          filePath,
          ownerId,
          expiresIn,
        });
        return true;
      }

      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }

    // 超时失败
    const currentLock = this.locks.get(filePath);
    const errorMsg = `获取文件锁超时：${filePath} (被 ${currentLock?.ownerId || "未知"} 持有)`;
    logger.error("lock_acquire_timeout", errorMsg, {
      filePath,
      ownerId,
      timeout,
      heldBy: currentLock?.ownerId,
    });

    throw new Error(errorMsg);
  }

  /**
   * 尝试获取锁（不等待）
   */
  private tryAcquireLock(
    filePath: string,
    ownerId: string,
    expiresIn: number
  ): boolean {
    const existingLock = this.locks.get(filePath);

    // 检查锁是否已过期
    if (existingLock && existingLock.expiresAt < new Date()) {
      logger.warn("lock_expired", {
        filePath,
        ownerId: existingLock.ownerId,
      });
      this.locks.delete(filePath);
    }

    // 如果没有锁或锁已过期，获取锁
    const currentLock = this.locks.get(filePath);
    if (!currentLock) {
      const lockInfo: LockInfo = {
        filePath,
        ownerId,
        acquiredAt: new Date(),
        expiresAt: new Date(Date.now() + expiresIn),
      };

      this.locks.set(filePath, lockInfo);
      this.emit("lock_acquired", { filePath, ownerId });
      return true;
    }

    // 锁已被其他所有者持有
    return false;
  }

  /**
   * 释放文件锁
   */
  async releaseLock(filePath: string, ownerId: string): Promise<boolean> {
    const lock = this.locks.get(filePath);

    if (!lock) {
      logger.warn("lock_not_found", { filePath, ownerId });
      return false;
    }

    if (lock.ownerId !== ownerId) {
      const errorMsg = `无权释放锁：${filePath} (被 ${lock.ownerId} 持有)`;
      logger.error("lock_owner_mismatch", errorMsg, {
        filePath,
        ownerId,
        actualOwner: lock.ownerId,
      });
      throw new Error(errorMsg);
    }

    this.locks.delete(filePath);
    
    logger.info("lock_released", { filePath, ownerId });
    this.emit("lock_released", { filePath, ownerId });

    // 通知等待队列
    this.processWaitQueue(filePath);

    return true;
  }

  /**
   * 延长锁的有效期
   */
  async extendLock(
    filePath: string,
    ownerId: string,
    extendBy: number
  ): Promise<boolean> {
    const lock = this.locks.get(filePath);

    if (!lock) {
      return false;
    }

    if (lock.ownerId !== ownerId) {
      throw new Error(`无权延长锁：${filePath}`);
    }

    lock.expiresAt = new Date(Date.now() + extendBy);
    
    logger.info("lock_extended", {
      filePath,
      ownerId,
      newExpiresAt: lock.expiresAt,
    });

    return true;
  }

  /**
   * 检查是否持有锁
   */
  hasLock(filePath: string, ownerId: string): boolean {
    const lock = this.locks.get(filePath);
    return !!(lock && lock.ownerId === ownerId && lock.expiresAt > new Date());
  }

  /**
   * 获取锁信息
   */
  getLockInfo(filePath: string): LockInfo | undefined {
    return this.locks.get(filePath);
  }

  /**
   * 获取所有活跃锁
   */
  getAllLocks(): LockInfo[] {
    return Array.from(this.locks.values()).filter(
      lock => lock.expiresAt > new Date()
    );
  }

  /**
   * 清理过期的锁
   */
  cleanupExpiredLocks(): number {
    const now = new Date();
    let count = 0;

    for (const [filePath, lock] of this.locks.entries()) {
      if (lock.expiresAt < now) {
        this.locks.delete(filePath);
        count++;
        logger.info("lock_cleanup_expired", {
          filePath,
          ownerId: lock.ownerId,
        });
      }
    }

    if (count > 0) {
      this.emit("locks_cleaned", { count });
    }

    return count;
  }

  /**
   * 处理等待队列
   */
  private processWaitQueue(filePath: string) {
    const queue = this.waitQueue.get(filePath);
    if (!queue || queue.length === 0) return;

    // 唤醒第一个等待者
    const waiter = queue.shift()!;
    
    // 尝试给它锁
    setTimeout(() => {
      waiter.resolve();
    }, 0);

    this.waitQueue.set(filePath, queue);
  }

  /**
   * 强制释放所有锁（用于错误恢复）
   */
  forceReleaseAll(ownerId: string): number {
    let count = 0;

    for (const [filePath, lock] of this.locks.entries()) {
      if (lock.ownerId === ownerId) {
        this.locks.delete(filePath);
        count++;
        logger.info("lock_force_released", { filePath, ownerId });
      }
    }

    if (count > 0) {
      this.emit("locks_force_released", { ownerId, count });
    }

    return count;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const activeLocks = this.getAllLocks();
    const waitingCount = Array.from(this.waitQueue.values())
      .reduce((sum, q) => sum + q.length, 0);

    return {
      activeLocks: activeLocks.length,
      waitingCount,
      locksByOwner: activeLocks.reduce((acc, lock) => {
        acc[lock.ownerId] = (acc[lock.ownerId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  /**
   * 启动定期清理（每 1 分钟）
   */
  startCleanupInterval(intervalMs: number = 60000) {
    const cleanup = () => {
      const count = this.cleanupExpiredLocks();
      if (count > 0) {
        logger.debug("periodic_lock_cleanup", { count });
      }
    };

    const timer = setInterval(cleanup, intervalMs);
    
    // 保存 timer 引用以便停止
    (this as any)._cleanupTimer = timer;

    logger.info("lock_cleanup_started", { intervalMs });
  }

  /**
   * 停止定期清理
   */
  stopCleanupInterval() {
    if ((this as any)._cleanupTimer) {
      clearInterval((this as any)._cleanupTimer);
      logger.info("lock_cleanup_stopped");
    }
  }
}

/**
 * 装饰器：自动获取和释放锁
 */
export function withFileLock(
  filePathArg: string | ((...args: any[]) => string)
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const filePath = typeof filePathArg === "function"
        ? filePathArg.apply(this, args)
        : filePathArg;

      const ownerId = `${this.constructor.name}:${propertyKey}:${Date.now()}`;
      
      const lockManager = (this as any).lockManager as FileLockManager;
      if (!lockManager) {
        throw new Error("lockManager not initialized");
      }

      // 获取锁
      await lockManager.acquireLock(filePath, ownerId);

      try {
        // 执行原方法
        return await originalMethod.apply(this, args);
      } finally {
        // 释放锁
        await lockManager.releaseLock(filePath, ownerId).catch(() => {});
      }
    };

    return descriptor;
  };
}

// 导出单例实例
export const fileLockManager = new FileLockManager();
