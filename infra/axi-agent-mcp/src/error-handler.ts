/**
 * 错误处理与降级策略增强模块
 * 功能：
 * - 多级降级策略
 * - 熔断机制
 * - 错误分类与重试
 * - 降级日志
 */

export type ErrorType = 
  | "timeout"
  | "rate_limit"
  | "api_error"
  | "network_error"
  | "auth_error"
  | "unknown";

export interface ErrorContext {
  model: string;
  error: Error;
  errorType: ErrorType;
  retryCount: number;
  timestamp: Date;
}

export interface FallbackStrategy {
  on_error: ErrorType | "any";
  fallback: "MiniMax-M2.5" | "qwen3-coder-next" | "qwen3-coder-plus" | "qwen3-max-2026-01-23" | "qwen3.5-plus" | "glm-5" | "glm-4.7" | "kimi-k2.5";
  timeout_ms?: number;
  retry_count?: number;
}

export interface ModelFallbackPolicy {
  model: string;
  strategies: FallbackStrategy[];
}

export interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: Date | null;
  state: "closed" | "open" | "half_open";
  lastStateChange: Date;
}

// 默认降级策略配置
const DEFAULT_FALLBACK_POLICIES: ModelFallbackPolicy[] = [
  {
    model: "qwen3-coder-next",
    strategies: [
      { on_error: "timeout", fallback: "qwen3-coder-plus", timeout_ms: 3000, retry_count: 2 },
      { on_error: "rate_limit", fallback: "qwen3-coder-plus", retry_count: 2 },
      { on_error: "any", fallback: "qwen3.5-plus" },
    ],
  },
  {
    model: "qwen3-coder-plus",
    strategies: [
      { on_error: "timeout", fallback: "qwen3.5-plus", timeout_ms: 3000 },
      { on_error: "any", fallback: "qwen3.5-plus" },
    ],
  },
  {
    model: "qwen3-max-2026-01-23",
    strategies: [
      { on_error: "timeout", fallback: "glm-5", timeout_ms: 5000, retry_count: 1 },
      { on_error: "any", fallback: "glm-5" },
    ],
  },
  {
    model: "MiniMax-M2.5",
    strategies: [
      { on_error: "timeout", fallback: "glm-5", timeout_ms: 3000 },
      { on_error: "any", fallback: "glm-5" },
    ],
  },
  {
    model: "kimi-k2.5",
    strategies: [
      { on_error: "timeout", fallback: "qwen3-max-2026-01-23", timeout_ms: 5000 },
      { on_error: "any", fallback: "qwen3-max-2026-01-23" },
    ],
  },
];

// 熔断器配置
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5, // 连续失败次数阈值
  resetTimeout: 60000, // 熔断后重置时间（ms）
  halfOpenRequests: 1, // 半开状态允许的请求数
};

export class ErrorHandler {
  private policies: Map<string, ModelFallbackPolicy> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private errorLogs: ErrorContext[] = [];

  constructor(policies?: ModelFallbackPolicy[]) {
    const allPolicies = policies || DEFAULT_FALLBACK_POLICIES;
    for (const policy of allPolicies) {
      this.policies.set(policy.model, policy);
      this.circuitBreakers.set(policy.model, {
        failureCount: 0,
        lastFailureTime: null,
        state: "closed",
        lastStateChange: new Date(),
      });
    }
  }

  /**
   * 分类错误类型
   */
  classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes("timeout") || message.includes("timed out")) {
      return "timeout";
    }
    if (message.includes("rate limit") || message.includes("too many requests")) {
      return "rate_limit";
    }
    if (message.includes("unauthorized") || message.includes("authentication")) {
      return "auth_error";
    }
    if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
      return "network_error";
    }
    if (message.includes("api") || message.includes("server")) {
      return "api_error";
    }
    
    return "unknown";
  }

  /**
   * 检查熔断器状态
   */
  checkCircuitBreaker(model: string): { allowed: boolean; state: CircuitBreakerState } {
    const state = this.circuitBreakers.get(model);
    if (!state) {
      return { allowed: true, state: { failureCount: 0, lastFailureTime: null, state: "closed", lastStateChange: new Date() } };
    }

    const now = Date.now();

    if (state.state === "open") {
      // 检查是否可以进入半开状态
      if (state.lastFailureTime && now - state.lastFailureTime.getTime() >= CIRCUIT_BREAKER_CONFIG.resetTimeout) {
        state.state = "half_open";
        state.lastStateChange = new Date();
        return { allowed: true, state };
      }
      return { allowed: false, state };
    }

    if (state.state === "half_open") {
      // 半开状态允许有限请求
      return { allowed: true, state };
    }

    // closed 状态
    return { allowed: true, state };
  }

  /**
   * 记录成功
   */
  recordSuccess(model: string) {
    const state = this.circuitBreakers.get(model);
    if (state) {
      state.failureCount = 0;
      state.state = "closed";
      state.lastStateChange = new Date();
    }
  }

  /**
   * 记录失败
   */
  recordFailure(model: string, error: Error) {
    const state = this.circuitBreakers.get(model);
    if (state) {
      state.failureCount++;
      state.lastFailureTime = new Date();

      if (state.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        state.state = "open";
        state.lastStateChange = new Date();
      }
    }

    // 记录错误日志
    const errorContext: ErrorContext = {
      model,
      error,
      errorType: this.classifyError(error),
      retryCount: 0,
      timestamp: new Date(),
    };
    
    this.errorLogs.push(errorContext);
    
    // 限制日志大小
    if (this.errorLogs.length > 1000) {
      this.errorLogs = this.errorLogs.slice(-500);
    }
  }

  /**
   * 获取降级策略
   */
  getFallbackStrategy(model: string, errorType: ErrorType): FallbackStrategy | null {
    const policy = this.policies.get(model);
    if (!policy) return null;

    // 查找匹配的策略
    for (const strategy of policy.strategies) {
      if (strategy.on_error === errorType || strategy.on_error === "any") {
        return strategy;
      }
    }

    return null;
  }

  /**
   * 处理错误并返回降级建议
   */
  handleError(context: ErrorContext): {
    shouldRetry: boolean;
    fallbackModel?: "MiniMax-M2.5" | "qwen3-coder-next" | "qwen3-coder-plus" | "qwen3-max-2026-01-23" | "qwen3.5-plus" | "glm-5" | "glm-4.7" | "kimi-k2.5";
    retryCount?: number;
    reason: string;
  } {
    const { model, errorType } = context;

    // 检查熔断器
    const circuitState = this.checkCircuitBreaker(model);
    if (!circuitState.allowed) {
      return {
        shouldRetry: false,
        reason: `熔断器已打开：${model} 连续失败 ${circuitState.state.failureCount} 次`,
      };
    }

    // 获取降级策略
    const strategy = this.getFallbackStrategy(model, errorType);
    if (strategy) {
      return {
        shouldRetry: true,
        fallbackModel: strategy.fallback,
        retryCount: strategy.retry_count || 1,
        reason: `触发降级策略：${errorType} → ${strategy.fallback}`,
      };
    }

    // 默认不重试
    return {
      shouldRetry: false,
      reason: `无匹配的降级策略 for ${errorType}`,
    };
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const now = Date.now();
    const recentErrors = this.errorLogs.filter(
      (log) => now - log.timestamp.getTime() < 3600000 // 最近 1 小时
    );

    const errorByType: Record<string, number> = {};
    const errorByModel: Record<string, number> = {};

    for (const err of recentErrors) {
      errorByType[err.errorType] = (errorByType[err.errorType] || 0) + 1;
      errorByModel[err.model] = (errorByModel[err.model] || 0) + 1;
    }

    const circuitStates: Record<string, string> = {};
    for (const [model, state] of this.circuitBreakers.entries()) {
      circuitStates[model] = state.state;
    }

    return {
      totalErrors: this.errorLogs.length,
      recentErrors: recentErrors.length,
      errorsByType: errorByType,
      errorsByModel: errorByModel,
      circuitBreakerStates: circuitStates,
    };
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(model: string) {
    const state = this.circuitBreakers.get(model);
    if (state) {
      state.failureCount = 0;
      state.state = "closed";
      state.lastStateChange = new Date();
      state.lastFailureTime = null;
    }
  }

  /**
   * 清除错误日志
   */
  clearErrorLogs() {
    this.errorLogs = [];
  }
}

// 导出单例实例
export const errorHandler = new ErrorHandler();
