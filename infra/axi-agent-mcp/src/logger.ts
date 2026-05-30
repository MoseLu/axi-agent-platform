/**
 * 可观测性模块 - 日志记录与追踪
 * 功能：
 * - 结构化日志记录
 * - 请求追踪
 * - 性能监控
 * - 日志导出
 */

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  event: string;
  model?: string;
  taskType?: string;
  duration?: number;
  data?: Record<string, any>;
  error?: string;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: "pending" | "success" | "error";
  tags?: Record<string, string>;
  error?: string;
}

export interface PerformanceMetrics {
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  successRate: number;
  requestsPerMinute: number;
}

class Logger {
  private logs: LogEntry[] = [];
  private traces: Map<string, TraceSpan[]> = new Map();
  private maxLogs = 10000;
  private startTime = Date.now();
  private requestCount = 0;

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 记录日志
   */
  log(entry: Omit<LogEntry, "id" | "timestamp">): string {
    const logEntry: LogEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date(),
    };

    this.logs.push(logEntry);

    // 限制日志大小
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs / 2);
    }

    // 控制台输出（仅 warn 和 error）
    if (entry.level === "error" || entry.level === "warn") {
      console.warn(`[${entry.level.toUpperCase()}] ${entry.event}`, entry.data || "", entry.error || "");
    }

    return logEntry.id;
  }

  /**
   * 记录信息日志
   */
  info(event: string, data?: Record<string, any>, model?: string): string {
    return this.log({
      level: "info",
      event,
      data,
      model,
    });
  }

  /**
   * 记录调试日志
   */
  debug(event: string, data?: Record<string, any>, model?: string): string {
    return this.log({
      level: "debug",
      event,
      data,
      model,
    });
  }

  /**
   * 记录警告日志
   */
  warn(event: string, data?: Record<string, any>, model?: string): string {
    return this.log({
      level: "warn",
      event,
      data,
      model,
    });
  }

  /**
   * 记录错误日志
   */
  error(event: string, error: Error | string, data?: Record<string, any>, model?: string): string {
    return this.log({
      level: "error",
      event,
      error: error instanceof Error ? error.message : String(error),
      data,
      model,
    });
  }

  /**
   * 开始追踪
   */
  startTrace(operation: string, tags?: Record<string, string>): TraceSpan {
    const traceId = this.generateId();
    const spanId = `span-${this.generateId()}`;

    const span: TraceSpan = {
      traceId,
      spanId,
      operation,
      startTime: new Date(),
      status: "pending",
      tags,
    };

    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, []);
    }
    this.traces.get(traceId)!.push(span);

    return span;
  }

  /**
   * 结束追踪
   */
  endTrace(span: TraceSpan, status: "success" | "error", error?: string) {
    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = status;
    if (error) {
      span.error = error;
    }
  }

  /**
   * 记录请求
   */
  recordRequest(params: {
    model: string;
    taskType: string;
    duration: number;
    success: boolean;
    error?: string;
  }) {
    this.requestCount++;
    
    this.log({
      level: params.success ? "info" : "error",
      event: params.success ? "request_completed" : "request_failed",
      model: params.model,
      taskType: params.taskType,
      duration: params.duration,
      error: params.error,
    });
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(windowMs: number = 60000): PerformanceMetrics {
    const now = Date.now();
    const recentLogs = this.logs.filter(
      (log) => log.duration !== undefined && now - log.timestamp.getTime() < windowMs
    );

    const durations = recentLogs.map((log) => log.duration!).sort((a, b) => a - b);
    const successCount = this.logs.filter(
      (log) => log.event === "request_completed" && now - log.timestamp.getTime() < windowMs
    ).length;
    const failCount = this.logs.filter(
      (log) => log.event === "request_failed" && now - log.timestamp.getTime() < windowMs
    ).length;

    const total = successCount + failCount;
    const successRate = total > 0 ? successCount / total : 1;

    const avgResponseTime = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    return {
      avgResponseTime,
      p95ResponseTime: durations[p95Index] || 0,
      p99ResponseTime: durations[p99Index] || 0,
      successRate,
      requestsPerMinute: (this.requestCount / ((now - this.startTime) / 60000)),
    };
  }

  /**
   * 获取追踪详情
   */
  getTrace(traceId: string): TraceSpan[] | undefined {
    return this.traces.get(traceId);
  }

  /**
   * 获取最近日志
   */
  getRecentLogs(limit: number = 100, level?: LogEntry["level"]): LogEntry[] {
    let logs = this.logs.slice(-limit);
    if (level) {
      logs = logs.filter((log) => log.level === level);
    }
    return logs.reverse(); // 最新的在前
  }

  /**
   * 导出日志（JSON 格式）
   */
  exportLogs(format: "json" | "csv" = "json"): string {
    if (format === "json") {
      return JSON.stringify(this.logs, null, 2);
    }

    // CSV 格式
    const headers = ["id", "timestamp", "level", "event", "model", "taskType", "duration", "error"];
    const rows = this.logs.map((log) =>
      [
        log.id,
        log.timestamp.toISOString(),
        log.level,
        log.event,
        log.model || "",
        log.taskType || "",
        log.duration?.toString() || "",
        log.error || "",
      ].join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }

  /**
   * 清除日志
   */
  clearLogs() {
    this.logs = [];
    this.traces.clear();
    this.requestCount = 0;
    this.startTime = Date.now();
  }
}

// 导出单例实例
export const logger = new Logger();
