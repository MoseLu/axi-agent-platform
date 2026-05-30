/**
 * 成本监控与配额管理模块
 * 功能：
 * - 跟踪每个模型的调用次数和 token 消耗
 * - 预算控制和告警
 * - 配额管理（QPS、日配额）
 * - 成本预测
 */

export interface ModelCost {
  costPer1kTokens: number; // 每 1k tokens 的成本（USD）
  costPerRequest?: number; // 每次请求的固定成本（可选）
}

export interface UsageRecord {
  model: string;
  timestamp: Date;
  tokens: number;
  cost: number;
  taskType?: string;
}

export interface DailyBudget {
  limit: number; // 每日预算上限（USD）
  alertThreshold: number; // 告警阈值（0-1）
  pauseThreshold: number; // 暂停阈值（0-1）
}

export interface ModelQuota {
  dailyRequests?: number; // 每日请求数限制
  qps?: number; // 每秒请求数限制
}

export interface CostMonitorConfig {
  dailyBudget: DailyBudget;
  modelCosts: Record<string, ModelCost>;
  modelQuotas: Record<string, ModelQuota>;
}

// 默认成本配置（示例价格，实际需根据 API 提供商调整）
const DEFAULT_MODEL_COSTS: Record<string, ModelCost> = {
  "qwen3-coder-next": { costPer1kTokens: 0.002, costPerRequest: 0.001 },
  "qwen3-coder-plus": { costPer1kTokens: 0.0015, costPerRequest: 0.001 },
  "qwen3-max-2026-01-23": { costPer1kTokens: 0.004, costPerRequest: 0.002 },
  "qwen3.5-plus": { costPer1kTokens: 0.001, costPerRequest: 0.0005 },
  "glm-5": { costPer1kTokens: 0.0012, costPerRequest: 0.0005 },
  "glm-4.7": { costPer1kTokens: 0.0008, costPerRequest: 0.0003 },
  "kimi-k2.5": { costPer1kTokens: 0.003, costPerRequest: 0.001 },
  "MiniMax-M2.5": { costPer1kTokens: 0.0025, costPerRequest: 0.001 },
};

const DEFAULT_CONFIG: CostMonitorConfig = {
  dailyBudget: {
    limit: 50.0,
    alertThreshold: 0.8,
    pauseThreshold: 0.95,
  },
  modelCosts: DEFAULT_MODEL_COSTS,
  modelQuotas: {},
};

export class CostMonitor {
  private config: CostMonitorConfig;
  private usageRecords: UsageRecord[] = [];
  private requestTimestamps: number[] = []; // 用于 QPS 控制
  private dailyCost: number = 0;
  private lastResetDate: string = new Date().toDateString();

  constructor(config?: Partial<CostMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.checkDailyReset();
  }

  /**
   * 检查是否需要重置日统计
   */
  private checkDailyReset() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyCost = 0;
      this.usageRecords = [];
      this.lastResetDate = today;
    }
  }

  /**
   * 记录一次使用
   */
  recordUsage(params: {
    model: string;
    tokens: number;
    taskType?: string;
  }): { cost: number; allowed: boolean; reason?: string } {
    this.checkDailyReset();

    const modelCost = this.config.modelCosts[params.model] || { 
      costPer1kTokens: 0.001, 
      costPerRequest: 0.0005 
    };
    
    const tokenCost = (params.tokens / 1000) * modelCost.costPer1kTokens;
    const requestCost = modelCost.costPerRequest || 0;
    const totalCost = tokenCost + requestCost;

    // 检查预算
    const projectedDailyCost = this.dailyCost + totalCost;
    const budgetRatio = projectedDailyCost / this.config.dailyBudget.limit;

    if (budgetRatio >= this.config.dailyBudget.pauseThreshold) {
      return {
        cost: totalCost,
        allowed: false,
        reason: `已达到每日预算的${(budgetRatio * 100).toFixed(0)}%，请求被暂停`,
      };
    }

    // 检查配额
    const quota = this.config.modelQuotas[params.model];
    if (quota) {
      const todayRequests = this.usageRecords.filter(
        (r) => r.model === params.model && r.timestamp.toDateString() === this.lastResetDate
      ).length;

      if (quota.dailyRequests && todayRequests >= quota.dailyRequests) {
        return {
          cost: totalCost,
          allowed: false,
          reason: `模型 ${params.model} 今日请求数已达上限 (${quota.dailyRequests})`,
        };
      }

      // QPS 检查
      if (quota.qps) {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 1000);
        if (this.requestTimestamps.length >= quota.qps) {
          return {
            cost: totalCost,
            allowed: false,
            reason: `模型 ${params.model} QPS 已达上限 (${quota.qps})`,
          };
        }
        this.requestTimestamps.push(now);
      }
    }

    // 记录使用
    this.usageRecords.push({
      model: params.model,
      timestamp: new Date(),
      tokens: params.tokens,
      cost: totalCost,
      taskType: params.taskType,
    });

    this.dailyCost += totalCost;

    // 检查是否需要告警
    const alertNeeded = budgetRatio >= this.config.dailyBudget.alertThreshold;

    return {
      cost: totalCost,
      allowed: true,
      reason: alertNeeded 
        ? `警告：已达到每日预算的${(budgetRatio * 100).toFixed(0)}%` 
        : undefined,
    };
  }

  /**
   * 获取当前使用统计
   */
  getStats() {
    this.checkDailyReset();

    const modelStats: Record<string, { requests: number; tokens: number; cost: number }> = {};
    
    for (const record of this.usageRecords) {
      if (!modelStats[record.model]) {
        modelStats[record.model] = { requests: 0, tokens: 0, cost: 0 };
      }
      modelStats[record.model].requests++;
      modelStats[record.model].tokens += record.tokens;
      modelStats[record.model].cost += record.cost;
    }

    const budgetRatio = this.dailyCost / this.config.dailyBudget.limit;

    return {
      dailyCost: this.dailyCost,
      dailyBudget: this.config.dailyBudget.limit,
      budgetUsagePercent: (budgetRatio * 100).toFixed(1),
      totalRequests: this.usageRecords.length,
      modelStats,
      lastReset: this.lastResetDate,
      alerts: budgetRatio >= this.config.dailyBudget.alertThreshold 
        ? [`警告：预算使用率已达${(budgetRatio * 100).toFixed(1)}%`] 
        : [],
    };
  }

  /**
   * 预测今日总成本
   */
  predictDailyCost() {
    this.checkDailyReset();
    
    const now = new Date();
    const secondsPassed = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const totalSeconds = 86400;
    
    if (secondsPassed === 0 || this.usageRecords.length === 0) {
      return this.dailyCost;
    }

    // 简单线性预测
    const projectedCost = (this.dailyCost / secondsPassed) * totalSeconds;
    return projectedCost;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CostMonitorConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.dailyCost = 0;
    this.usageRecords = [];
    this.requestTimestamps = [];
    this.lastResetDate = new Date().toDateString();
  }
}

// 导出单例实例
export const costMonitor = new CostMonitor();
