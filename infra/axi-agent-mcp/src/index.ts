/**
 * Axi Agent MCP service
 * 暴露 swarm_chat（自动选模型）、swarm_chat_with_model（指定模型）、swarm_analyze_task（仅分析任务类型）
 * 增强版：支持置信度评分、动态参数配置、成本监控
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  selectModel,
  getFallbackChain,
  isSwarmModel,
  SWARM_MODELS,
  getModelParams,
} from "./model-router.js";
import { chat } from "./api-client.js";
import { costMonitor } from "./cost-monitor.js";
import { validateResponse } from "./validator.js";
import { errorHandler } from "./error-handler.js";
import { logger } from "./logger.js";
import {
  parseWorkflowDefinition,
  getBuiltinWorkflow,
  listBuiltinWorkflows,
  createWorkflowExecutor,
} from "./workflow/index.js";
import { createFileSystemTools, FileSystemTools } from "./tools/file-system.js";
import { CodebaseIndexer } from "./codebase/indexer.js";
import { createTechStackDetector } from "./tools/tech-stack-detector.js";
import { createAgentScheduler } from "./agents/scheduler.js";
import { createGitTools } from "./tools/git-tools.js";
import { createCITools } from "./tools/ci-tools.js";
import { fileLockManager } from "./concurrency/file-lock.js";
import { createProjectAnalyzer } from "./tools/project-analyzer.js";

// 新增：Agent 系统增强
import { recommendAgent, listAvailableAgents, getAgentsByCategory } from "./agents/recommender.js";
import { AGENT_ROLES } from "./agents/agent-roles.js";

// 新增：工作流系统增强
import { recommendWorkflow, listAvailableWorkflows, filterWorkflowsByCategory, getCategories as getWorkflowCategories } from "./workflow/recommender.js";

// 新增：技能系统
import { skillLoader, BUILTIN_SKILLS } from "./skills/index.js";

// 新增：治理层
import { QUALITY_GATES, getGatesByType } from "./governance/index.js";
import { getEmbedding } from "./embedding-client.js";
import { validateWithGates } from "./validator.js";

// 新增：动态 Agent 系统
import {
  createSwarmForTask,
  executeAgentSwarm,
  generateAgentRoles,
} from "./agents/dynamic-agent.js";

// 数据库模块
import { 
  DatabaseManager, 
  loadDatabaseConfig,
  VectorStore,
  SmartCache,
  CodeStore,
} from "./database/index.js";

const server = new McpServer({
  name: "axi-agent-mcp",
  version: "1.1.0",
});

// 工具：根据任务内容自动选模型并调用 API
server.registerTool(
  "swarm_chat",
  {
    title: "Swarm 对话（自动选模型）",
    description:
      "根据任务内容自动选择最合适的模型并调用你的 API 进行对话。支持 8 个模型：qwen3.5-plus、qwen3-max-2026-01-23、qwen3-coder-next、qwen3-coder-plus、MiniMax-M2.5、glm-5、glm-4.7、kimi-k2.5。",
    inputSchema: z.object({
      message: z.string().describe("用户消息或任务描述"),
      systemPrompt: z.string().optional().describe("可选系统提示"),
      temperature: z.number().optional().describe("可选的温度参数（0-1）"),
      maxTokens: z.number().optional().describe("可选的最大 token 数"),
    }),
  },
  async ({ message, systemPrompt, temperature, maxTokens }) => {
    const startTime = Date.now();
    const selection = selectModel(message);
    
    const trace = logger.startTrace("swarm_chat", {
      model: selection.model,
      taskType: selection.taskType || "unknown",
    });

    const messages = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: message },
    ];

    logger.info("task_analyzed", {
      taskType: selection.taskType,
      confidence: selection.confidence,
      matchedKeywords: selection.matchedKeywords,
    }, selection.model);

    // 使用动态参数或用户指定参数
    const defaultParams = getModelParams(selection.model, selection.taskType);
    const params = {
      temperature: temperature ?? defaultParams.temperature,
      max_tokens: maxTokens ?? defaultParams.max_tokens,
    };

    // 成本监控预检查
    const costCheck = costMonitor.recordUsage({
      model: selection.model,
      tokens: params.max_tokens / 4, // 估算 tokens
      taskType: selection.taskType,
    });

    if (!costCheck.allowed) {
      const stats = costMonitor.getStats();
      return { 
        content: [{ 
          type: "text" as const, 
          text: `❌ 请求被阻止：${costCheck.reason}\n\n当前预算使用：${stats.budgetUsagePercent}%` 
        }] 
      };
    }

    // 检查熔断器状态
    const circuitCheck = errorHandler.checkCircuitBreaker(selection.model);
    if (!circuitCheck.allowed) {
      return { 
        content: [{ 
          type: "text" as const, 
          text: `⚠️ 熔断器保护：模型 ${selection.model} 暂时不可用\n状态：${circuitCheck.state.state}\n建议：稍后重试或切换模型` 
        }] 
      };
    }

    let result = await chat({ 
      model: selection.model, 
      messages,
      ...params,
    });
    let usedModel = selection.model;

    // 处理失败和降级
    if (!result.success && result.error) {
      const error = new Error(result.error);
      errorHandler.recordFailure(selection.model, error);
      
      const errorType = errorHandler.classifyError(error);
      const handleResult = errorHandler.handleError({
        model: selection.model,
        error,
        errorType,
        retryCount: 0,
        timestamp: new Date(),
      });

      if (handleResult.shouldRetry && handleResult.fallbackModel) {
        // 尝试降级模型
        result = await chat({ 
          model: handleResult.fallbackModel, 
          messages,
          ...params,
        });
        
        if (result.success) {
          usedModel = handleResult.fallbackModel;
          errorHandler.recordSuccess(usedModel);
        }
      }

      // 如果降级失败，尝试降级链
      if (!result.success) {
        const chain = getFallbackChain(selection.model);
        for (const m of chain) {
          if (m === handleResult.fallbackModel) continue; // 跳过已尝试的
          
          const fallbackCostCheck = costMonitor.recordUsage({
            model: m,
            tokens: params.max_tokens / 4,
            taskType: selection.taskType,
          });
          
          if (fallbackCostCheck.allowed) {
            result = await chat({ model: m, messages, ...params });
            usedModel = m;
            if (result.success) {
              errorHandler.recordSuccess(usedModel);
              break;
            } else {
              errorHandler.recordFailure(m, new Error(result.error || "Unknown"));
            }
          }
        }
      }
    } else {
      // 成功时记录
      errorHandler.recordSuccess(usedModel);
      
      // Level 1 基础验证
      const validationResult = await validateResponse(result.content || "", {
        level: 1,
        model: usedModel,
        taskType: selection.taskType,
      });

      // 添加验证元数据
      if (!validationResult.passed) {
        result.content = `${result.content}\n\n⚠️ 验证警告：${validationResult.details.join("; ")}`;
      }
    }

    const metaParts = [
      `任务类型：${selection.taskType}`,
      `使用模型：${usedModel}`,
      `置信度：${(selection.confidence * 100).toFixed(0)}%`,
    ];
    
    if (selection.matchedKeywords.length > 0) {
      metaParts.push(`匹配关键词：${selection.matchedKeywords.join(", ")}`);
    }
    
    metaParts.push(selection.reasoning);
    
    if (costCheck.reason) {
      metaParts.push(`⚠️ ${costCheck.reason}`);
    }

    const meta = `[${metaParts.join(" | ")}]`;

    const text = result.success
      ? `${meta}\n\n${result.content ?? ""}`
      : `${meta}\n\n错误：${result.error ?? "未知错误"}`;

    // 记录请求结果
    const duration = Date.now() - startTime;
    logger.recordRequest({
      model: usedModel,
      taskType: selection.taskType,
      duration,
      success: result.success,
      error: result.error,
    });

    logger.endTrace(trace, result.success ? "success" : "error", result.error || undefined);

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：指定模型对话
server.registerTool(
  "swarm_chat_with_model",
  {
    title: "Swarm 对话（指定模型）",
    description: "使用指定模型调用 API。可选模型：" + SWARM_MODELS.join(", "),
    inputSchema: z.object({
      model: z.string().describe("模型标识，如 qwen3-coder-next"),
      message: z.string().describe("用户消息"),
      systemPrompt: z.string().optional().describe("可选系统提示"),
      temperature: z.number().optional().describe("可选的温度参数（0-1）"),
      maxTokens: z.number().optional().describe("可选的最大 token 数"),
    }),
  },
  async ({ model, message, systemPrompt, temperature, maxTokens }) => {
    const actualModel = isSwarmModel(model) ? model : "qwen3.5-plus";
    const messages = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user" as const, content: message },
    ];

    // 使用动态参数或用户指定参数
    const defaultParams = getModelParams(actualModel);
    const params = {
      temperature: temperature ?? defaultParams.temperature,
      max_tokens: maxTokens ?? defaultParams.max_tokens,
    };

    let result = await chat({ model: actualModel, messages, ...params });
    let usedModel = actualModel;

    if (!result.success) {
      const chain = getFallbackChain(actualModel);
      for (const m of chain) {
        result = await chat({ model: m, messages, ...params });
        usedModel = m;
        if (result.success) break;
      }
    }

    const text = result.success
      ? `[模型：${usedModel}]\n\n${result.content ?? ""}`
      : `[模型：${usedModel}] 错误：${result.error ?? "未知错误"}`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：仅分析任务类型与推荐模型（不调用 API）
server.registerTool(
  "swarm_analyze_task",
  {
    title: "Swarm 任务分析",
    description: "根据任务描述分析任务类型并返回推荐模型与备选列表，不调用 API。",
    inputSchema: z.object({
      message: z.string().describe("任务或用户输入"),
    }),
  },
  async ({ message }) => {
    const selection = selectModel(message);
    const params = getModelParams(selection.model, selection.taskType);
    
    const text = [
      `任务类型：${selection.taskType}`,
      `推荐模型：${selection.model}`,
      `备选模型：${selection.fallback.join(" → ")}`,
      `置信度：${(selection.confidence * 100).toFixed(0)}%`,
      `推理：${selection.reasoning}`,
      selection.matchedKeywords.length ? `匹配关键词：${selection.matchedKeywords.join(", ")}` : "",
      `建议参数：temperature=${params.temperature.toFixed(1)}, max_tokens=${params.max_tokens}`,
    ]
      .filter(Boolean)
      .join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：获取使用统计信息
server.registerTool(
  "swarm_get_stats",
  {
    title: "Swarm 使用统计",
    description: "获取蜂群系统的使用统计信息，包括请求次数、模型使用分布、成本监控、错误统计等。",
    inputSchema: z.object({}),
  },
  async () => {
    const costStats = costMonitor.getStats();
    const predictedCost = costMonitor.predictDailyCost();
    const errorStats = errorHandler.getErrorStats();
    
    const text = [
      `📊 蜂群系统统计`,
      `━━━━━━━━━━━━━━━━━━`,
      ``,
      `💰 成本监控:`,
      `  今日成本：$${costStats.dailyCost.toFixed(4)} / $${costStats.dailyBudget.toFixed(2)}`,
      `  预算使用率：${costStats.budgetUsagePercent}%`,
      `  预测今日总成本：$${predictedCost.toFixed(2)}`,
      ``,
      `📈 模型使用分布:`,
      ...Object.entries(costStats.modelStats).map(
        ([model, data]) => `  • ${model}: ${data.requests}次 | ${data.tokens} tokens | $${data.cost.toFixed(4)}`
      ),
      ``,
      `⚠️ 错误统计 (最近 1 小时):`,
      `  总错误数：${errorStats.recentErrors}`,
      `  按类型：${Object.entries(errorStats.errorsByType).map(([k, v]) => `${k}:${v}`).join(", ") || "无"}`,
      `  按模型：${Object.entries(errorStats.errorsByModel).map(([k, v]) => `${k}:${v}`).join(", ") || "无"}`,
      `  熔断器状态：${Object.entries(errorStats.circuitBreakerStates).map(([k, v]) => `${k}:${v}`).join(", ") || "全部正常"}`,
      ``,
      `总请求数：${costStats.totalRequests}`,
      `统计重置时间：${costStats.lastReset}`,
      ...(costStats.alerts.length > 0 ? [``, `⚠️ 告警：${costStats.alerts.join(" | ")}`] : []),
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：重置熔断器
server.registerTool(
  "swarm_reset_circuit_breaker",
  {
    title: "Swarm 重置熔断器",
    description: "重置指定模型的熔断器状态，使其恢复正常服务。",
    inputSchema: z.object({
      model: z.string().optional().describe("模型标识，不填则重置所有模型"),
    }),
  },
  async ({ model }) => {
    if (model) {
      errorHandler.resetCircuitBreaker(model);
      logger.info("circuit_breaker_reset", { model });
      return { 
        content: [{ 
          type: "text" as const, 
          text: `✓ 已重置模型 ${model} 的熔断器状态` 
        }] 
      };
    } else {
      // 重置所有模型
      for (const m of SWARM_MODELS) {
        errorHandler.resetCircuitBreaker(m);
      }
      logger.info("circuit_breakers_reset_all");
      return { 
        content: [{ 
          type: "text" as const, 
          text: `✓ 已重置所有模型的熔断器状态` 
        }] 
      };
    }
  }
);

// 工具：获取性能指标
server.registerTool(
  "swarm_get_metrics",
  {
    title: "Swarm 性能指标",
    description: "获取蜂群系统的性能指标，包括响应时间、成功率等。",
    inputSchema: z.object({
      windowMs: z.number().optional().describe("时间窗口（毫秒），默认 60000"),
    }),
  },
  async ({ windowMs }) => {
    const metrics = logger.getPerformanceMetrics(windowMs);
    
    const text = [
      `⚡ 性能指标`,
      `━━━━━━━━━━━━━━━━━━`,
      `平均响应时间：${metrics.avgResponseTime.toFixed(0)}ms`,
      `P95 响应时间：${metrics.p95ResponseTime.toFixed(0)}ms`,
      `P99 响应时间：${metrics.p99ResponseTime.toFixed(0)}ms`,
      `成功率：${(metrics.successRate * 100).toFixed(1)}%`,
      `请求速率：${metrics.requestsPerMinute.toFixed(1)} 次/分钟`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：获取最近日志
server.registerTool(
  "swarm_get_logs",
  {
    title: "Swarm 日志查询",
    description: "获取最近的系统日志，支持按级别过滤。",
    inputSchema: z.object({
      limit: z.number().optional().describe("返回日志条数，默认 50"),
      level: z.enum(["info", "warn", "error", "debug"]).optional().describe("日志级别过滤"),
    }),
  },
  async ({ limit = 50, level }) => {
    const logs = logger.getRecentLogs(limit, level);
    
    if (logs.length === 0) {
      return { 
        content: [{ 
          type: "text" as const, 
          text: level ? `未找到 '${level}' 级别的日志` : "暂无日志" 
        }] 
      };
    }

    const text = logs.map((log) => {
      const time = log.timestamp.toLocaleTimeString("zh-CN");
      const levelIcon = {
        info: "ℹ️",
        warn: "⚠️",
        error: "❌",
        debug: "🔍",
      }[log.level];
      
      const parts = [
        `[${time}] ${levelIcon} [${log.level.toUpperCase()}] ${log.event}`,
      ];
      
      if (log.model) parts.push(`模型：${log.model}`);
      if (log.taskType) parts.push(`任务：${log.taskType}`);
      if (log.duration) parts.push(`耗时：${log.duration}ms`);
      if (log.error) parts.push(`错误：${log.error}`);
      
      return parts.join(" | ");
    }).join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：执行工作流
server.registerTool(
  "swarm_execute_workflow",
  {
    title: "Swarm 执行工作流",
    description: "执行一个多步骤的工作流。支持内置工作流或自定义工作流定义。",
    inputSchema: z.object({
      workflowName: z.string().optional().describe("内置工作流名称，如 code_review, data_analysis 等"),
      workflowDefinition: z.string().optional().describe("自定义工作流 YAML/JSON 定义"),
      input: z.string().describe("工作流输入"),
      variables: z.record(z.any()).optional().describe("额外变量"),
    }),
  },
  async ({ workflowName, workflowDefinition, input, variables }) => {
    try {
      let workflow;

      // 获取工作流定义
      if (workflowName) {
        const builtin = getBuiltinWorkflow(workflowName);
        if (!builtin) {
          const available = listBuiltinWorkflows()
            .map((w) => w.name)
            .join(", ");
          return {
            content: [{
              type: "text" as const,
              text: `❌ 未找到内置工作流 "${workflowName}"\n\n可用工作流：${available}`,
            }],
          };
        }
        workflow = builtin;
      } else if (workflowDefinition) {
        workflow = parseWorkflowDefinition(workflowDefinition);
      } else {
        return {
          content: [{
            type: "text" as const,
            text: "❌ 必须指定 workflowName 或 workflowDefinition",
          }],
        };
      }

      logger.info("workflow_start", {
        workflow: workflow.name,
        steps: workflow.steps.length,
      });

      // 创建工作流执行器
      const executor = createWorkflowExecutor(workflow, {
        maxRetries: 1,
        timeout: 600000, // 10 分钟
        variables,
      });

      // 执行工作流
      const result = await executor.execute(input);

      // 格式化输出
      const output = [
        `📋 工作流执行结果`,
        `━━━━━━━━━━━━━━━━━━`,
        `工作流：${workflow.name}`,
        `状态：${result.status === "completed" ? "✅ 完成" : result.status === "failed" ? "❌ 失败" : "⚠️ 取消"}`,
        `总耗时：${(result.totalDuration / 1000).toFixed(1)}秒`,
        `步骤数：${result.stepCount}`,
        ``,
        `📊 步骤详情:`,
      ];

      for (const [stepId, stepResult] of Object.entries(result.results)) {
        const step = workflow.steps.find((s) => s.id === stepId);
        output.push(
          ``,
          `**步骤 ${stepId}** (${step?.model || "unknown"})`,
          `  模型：${stepResult.model || "N/A"}`,
          `  状态：${stepResult.success ? "✅" : "❌"}`,
          `  耗时：${stepResult.duration}ms`,
          `  输出：${typeof stepResult.output === "string" ? stepResult.output.substring(0, 200) + (stepResult.output.length > 200 ? "..." : "") : JSON.stringify(stepResult.output).substring(0, 200)}`,
        );
        if (stepResult.error) {
          output.push(`  错误：${stepResult.error}`);
        }
      }

      if (result.finalOutput) {
        output.push(``, `━━━━━━━━━━━━━━━━━━`, `📝 最终输出:`, result.finalOutput);
      }

      if (result.error) {
        output.push(``, `❌ 错误：${result.error}`);
      }

      return {
        content: [{
          type: "text" as const,
          text: output.join("\n"),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 工作流执行失败：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：列出内置工作流
server.registerTool(
  "swarm_list_workflows",
  {
    title: "Swarm 列出工作流",
    description: "列出所有可用的内置工作流模板。",
    inputSchema: z.object({}),
  },
  async () => {
    const workflows = listBuiltinWorkflows();
    
    const text = [
      `📋 内置工作流模板`,
      `━━━━━━━━━━━━━━━━━━`,
      ``,
      ...workflows.map((w) => [
        `**${w.name}**`,
        `  ${w.description || "无描述"}`,
        `  标签：${w.tags?.join(", ") || "无"}`,
        ``,
      ].join("\n")),
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// 工具：验证工作流定义
server.registerTool(
  "swarm_validate_workflow",
  {
    title: "Swarm 验证工作流",
    description: "验证自定义工作流定义是否有效。",
    inputSchema: z.object({
      workflowDefinition: z.string().describe("工作流 YAML/JSON 定义"),
      format: z.enum(["yaml", "json"]).optional().describe("定义格式"),
    }),
  },
  async ({ workflowDefinition, format = "yaml" }) => {
    try {
      const workflow = parseWorkflowDefinition(workflowDefinition, format);
      
      const text = [
        `✅ 工作流定义有效`,
        `━━━━━━━━━━━━━━━━━━`,
        ``,
        `名称：${workflow.name}`,
        `描述：${workflow.description || "无"}`,
        `版本：${workflow.version || "1.0.0"}`,
        `步骤数：${workflow.steps.length}`,
        `输出格式：${workflow.outputFormat || "text"}`,
        ``,
        `📊 步骤列表:`,
        ...workflow.steps.map((s, i) => `  ${i + 1}. ${s.id} (${s.model})`),
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 工作流定义无效:\n${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 文件系统工具实例（延迟初始化）
let fsTools: FileSystemTools | null = null;
let codebaseIndex: CodebaseIndexer | null = null;

// 工具：读取文件
server.registerTool(
  "swarm_read_file",
  {
    title: "Swarm 读取文件",
    description: "读取指定文件的内容。需要提供文件路径。",
    inputSchema: z.object({
      path: z.string().describe("文件路径（相对于项目根目录）"),
      projectRoot: z.string().optional().describe("项目根目录路径"),
    }),
  },
  async ({ path, projectRoot }) => {
    try {
      const tools = getFileSystemTools(projectRoot);
      const result = await tools.readFile(path);

      if (!result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ 读取失败：${result.error}`,
          }],
        };
      }

      const stats = result.stats;
      const text = [
        `📄 文件：${result.path}`,
        `大小：${stats ? (stats.size / 1024).toFixed(2) : '?'} KB`,
        `修改时间：${stats ? stats.modified.toLocaleString("zh-CN") : '?'}`,
        ``,
        `--- 文件内容 ---`,
        result.content || "(空文件)",
        `--- 结束 ---`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：写入文件
server.registerTool(
  "swarm_write_file",
  {
    title: "Swarm 写入文件",
    description: "创建或覆盖文件。会先备份现有文件。",
    inputSchema: z.object({
      path: z.string().describe("文件路径"),
      content: z.string().describe("文件内容"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ path, content, projectRoot }) => {
    try {
      const tools = getFileSystemTools(projectRoot);
      const result = await tools.writeFile(path, content);

      if (!result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ 写入失败：${result.error}`,
          }],
        };
      }

      const text = [
        `✅ 文件已写入`,
        `路径：${result.path}`,
        `大小：${(content.length / 1024).toFixed(2)} KB`,
        result.backupPath ? `备份：${result.backupPath}` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：修改文件
server.registerTool(
  "swarm_modify_file",
  {
    title: "Swarm 修改文件",
    description: "智能修改文件内容（查找替换）。会先备份现有文件。",
    inputSchema: z.object({
      path: z.string().describe("文件路径"),
      replacements: z.array(z.object({
        search: z.string().describe("要查找的内容"),
        replace: z.string().describe("替换为"),
      })).describe("替换规则列表"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ path, replacements, projectRoot }) => {
    try {
      const tools = getFileSystemTools(projectRoot);
      const result = await tools.modifyFile(path, replacements);

      if (!result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ 修改失败：${result.error}`,
          }],
        };
      }

      const text = [
        `✅ 文件已修改`,
        `路径：${result.path}`,
        `变更数：${result.changes?.length || 0}`,
        result.backupPath ? `备份：${result.backupPath}` : "",
        ``,
        `变更详情:`,
        ...(result.changes || []).map((c: { line: number; oldLine?: string; newLine: string }) => 
          `  第 ${c.line} 行:\n    - ${c.oldLine || 'N/A'}\n    + ${c.newLine}`
        ),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：列出目录结构
server.registerTool(
  "swarm_list_directory",
  {
    title: "Swarm 列出目录",
    description: "列出项目目录结构。",
    inputSchema: z.object({
      path: z.string().optional().describe("目录路径，默认为项目根目录"),
      maxDepth: z.number().optional().describe("最大深度，默认 3"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ path, maxDepth = 3, projectRoot }) => {
    try {
      const tools = getFileSystemTools(projectRoot);
      const structure = await tools.listDirectory(path || "", { maxDepth });

      if (!structure) {
        return {
          content: [{
            type: "text" as const,
            text: "❌ 无法列出目录",
          }],
        };
      }

      const formatStructure = (node: { type: string; name: string; children?: any[] }, indent: number = 0): string => {
        const prefix = "  ".repeat(indent);
        const icon = node.type === "directory" ? "📁" : "📄";
        let result = `${prefix}${icon} ${node.name}`;
        
        if (node.children && node.children.length > 0) {
          result += "\n" + node.children
            .map((child: any) => formatStructure(child, indent + 1))
            .join("\n");
        }
        
        return result;
      };

      return {
        content: [{
          type: "text" as const,
          text: formatStructure(structure),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：搜索文件
server.registerTool(
  "swarm_search_files",
  {
    title: "Swarm 搜索文件",
    description: "按文件名模式搜索文件。",
    inputSchema: z.object({
      pattern: z.string().describe("文件模式，如 *.ts, *.tsx, user.*.ts"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ pattern, projectRoot }) => {
    try {
      const tools = getFileSystemTools(projectRoot);
      const files = await tools.searchFiles(pattern);

      if (files.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `未找到匹配 "${pattern}" 的文件`,
          }],
        };
      }

      const text = [
        `找到 ${files.length} 个匹配 "${pattern}" 的文件:`,
        ``,
        ...files.map((f: string) => `  - ${f}`),
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：代码库搜索
server.registerTool(
  "swarm_search_code",
  {
    title: "Swarm 代码搜索",
    description: "在代码库中搜索文本内容（使用 ripgrep）。",
    inputSchema: z.object({
      query: z.string().describe("搜索内容"),
      filePattern: z.string().optional().describe("文件模式，如 *.ts"),
      maxResults: z.number().optional().describe("最大结果数，默认 50"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ query, filePattern, maxResults = 50, projectRoot }) => {
    try {
      const indexer = getCodebaseIndexer(projectRoot || process.cwd());
      const results = await indexer.searchCode(query, {
        filePattern: filePattern || undefined,
        maxResults,
      });

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `未找到匹配 "${query}" 的代码`,
          }],
        };
      }

      const text = [
        `找到 ${results.length} 个匹配 "${query}" 的代码位置:`,
        ``,
        ...results.map((r, i) => [
          `${i + 1}. **${r.file}:${r.line}**`,
          `   \`${r.content.trim()}\``,
          ``,
        ].join("\n")),
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 错误：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：构建代码库索引
server.registerTool(
  "swarm_build_index",
  {
    title: "Swarm 构建代码索引",
    description: "构建整个代码库的索引，用于快速搜索和导航。",
    inputSchema: z.object({
      projectRoot: z.string().describe("项目根目录"),
    }),
  },
  async ({ projectRoot }) => {
    try {
      const indexer = getCodebaseIndexer(projectRoot);
      
      const startTime = Date.now();
      const index = await indexer.buildIndex();
      const duration = Date.now() - startTime;

      const text = [
        `✅ 代码库索引构建完成`,
        ``,
        `项目根目录：${index.rootPath}`,
        `耗时：${(duration / 1000).toFixed(1)} 秒`,
        `索引文件数：${index.files.size}`,
        `符号数量：${index.symbolTable.size}`,
        `构建时间：${index.buildTime.toLocaleString("zh-CN")}`,
        ``,
        `📊 文件类型分布:`,
      ];

      // 统计文件类型
      const extStats: Record<string, number> = {};
      for (const path of index.files.keys()) {
        const ext = path.split(".").pop() || "unknown";
        extStats[ext] = (extStats[ext] || 0) + 1;
      }

      text.push(
        ...Object.entries(extStats)
          .sort((a, b) => b[1] - a[1])
          .map(([ext, count]) => `  - .${ext}: ${count} 个文件`),
      );

      return { content: [{ type: "text" as const, text }] } as any;
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 构建索引失败：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：分析工作空间所有项目
server.registerTool(
  "swarm_analyze_workspace",
  {
    title: "Swarm 工作空间分析",
    description: "扫描工作空间所有项目，分析架构、技术栈和问题。",
    inputSchema: z.object({
      workspaceRoot: z.string().optional().describe("工作空间根目录，默认为当前目录"),
    }),
  },
  async ({ workspaceRoot }) => {
    try {
      const root = workspaceRoot || process.cwd();
      const analyzer = createProjectAnalyzer(root);
      const projects = await analyzer.scanProjects();
      const report = analyzer.generateReport(projects);

      return {
        content: [{
          type: "text" as const,
          text: report,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 分析失败：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// 工具：检测项目技术栈
server.registerTool(
  "swarm_detect_tech_stack",
  {
    title: "Swarm 技术栈检测",
    description: "自动识别项目使用的技术栈，包括框架、库、工具等。",
    inputSchema: z.object({
      projectRoot: z.string().describe("项目根目录"),
    }),
  },
  async ({ projectRoot }) => {
    try {
      const detector = createTechStackDetector(projectRoot);
      const techStack = await detector.detect();
      const report = detector.generateReport(techStack);

      return {
        content: [{
          type: "text" as const,
          text: report,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text" as const,
          text: `❌ 检测失败：${error instanceof Error ? error.message : String(error)}`,
        }],
      };
    }
  }
);

// Git 工具
server.registerTool(
  "swarm_git_status",
  {
    title: "Swarm Git 状态",
    description: "获取 Git 仓库的当前状态。",
    inputSchema: z.object({
      repoPath: z.string().describe("Git 仓库路径"),
    }),
  },
  async ({ repoPath }) => {
    try {
      const git = createGitTools(repoPath);
      const status = await git.getStatus();
      
      const text = [
        `📊 Git 状态`,
        `分支：${status.branch}${status.upstream ? ` (${status.upstream})` : ""}`,
        status.ahead > 0 ? `⬆️ 领先 ${status.ahead} 个提交` : "",
        status.behind > 0 ? `⬇️ 落后 ${status.behind} 个提交` : "",
        ``,
        `变更文件:`,
        `  已暂存：${status.changes.staged.length}`,
        `  未暂存：${status.changes.unstaged.length}`,
        `  未跟踪：${status.changes.untracked.length}`,
        status.clean ? `\n✅ 工作区干净` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 错误：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_git_commit",
  {
    title: "Swarm Git 提交",
    description: "提交代码变更。",
    inputSchema: z.object({
      repoPath: z.string().describe("Git 仓库路径"),
      message: z.string().describe("提交信息"),
      all: z.boolean().optional().describe("是否添加 -a 参数"),
    }),
  },
  async ({ repoPath, message, all }) => {
    try {
      const git = createGitTools(repoPath);
      const hash = await git.commit({ message, all });
      
      return {
        content: [{ type: "text" as const, text: `✅ 提交成功\nHash: ${hash}\n信息：${message}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 提交失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_git_create_branch",
  {
    title: "Swarm Git 创建分支",
    description: "创建新的 Git 分支。",
    inputSchema: z.object({
      repoPath: z.string().describe("Git 仓库路径"),
      branchName: z.string().describe("分支名称"),
    }),
  },
  async ({ repoPath, branchName }) => {
    try {
      const git = createGitTools(repoPath);
      await git.createFeatureBranch(branchName);
      
      return {
        content: [{ type: "text" as const, text: `✅ 分支已创建：${branchName}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 创建失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_generate_mr_description",
  {
    title: "Swarm 生成 MR 描述",
    description: "生成 Merge Request / Pull Request 描述模板。",
    inputSchema: z.object({
      repoPath: z.string().describe("Git 仓库路径"),
      title: z.string().describe("MR 标题"),
      description: z.string().describe("MR 描述"),
      sourceBranch: z.string().describe("源分支"),
      targetBranch: z.string().describe("目标分支"),
    }),
  },
  async ({ repoPath, title, description, sourceBranch, targetBranch }) => {
    try {
      const git = createGitTools(repoPath);
      const mrDesc = await git.createMRDescription({
        title,
        description,
        sourceBranch,
        targetBranch,
      });
      
      return {
        content: [{ type: "text" as const, text: mrDesc }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 生成失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// CI/CD 工具
server.registerTool(
  "swarm_run_lint",
  {
    title: "Swarm 运行 Lint",
    description: "运行代码检查工具。",
    inputSchema: z.object({
      projectRoot: z.string().describe("项目根目录"),
      fix: z.boolean().optional().describe("是否自动修复"),
    }),
  },
  async ({ projectRoot, fix }) => {
    try {
      const ci = createCITools(projectRoot);
      const result = await ci.runLint({ fix });
      
      const text = [
        `🧪 Lint 结果`,
        `命令：${result.command}`,
        `耗时：${(result.duration / 1000).toFixed(1)}秒`,
        ``,
        result.success ? `✅ 通过` : `❌ 失败`,
        `错误：${result.totalErrors}`,
        `警告：${result.totalWarnings}`,
        ``,
        result.files.length > 0 ? `问题文件:\n${result.files.map(f => `  - ${f.filePath} (${f.messages.length} 个问题)`).join("\n")}` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 运行失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_run_test",
  {
    title: "Swarm 运行测试",
    description: "运行测试套件。",
    inputSchema: z.object({
      projectRoot: z.string().describe("项目根目录"),
      coverage: z.boolean().optional().describe("是否包含覆盖率"),
    }),
  },
  async ({ projectRoot, coverage }) => {
    try {
      const ci = createCITools(projectRoot);
      const result = await ci.runTest({ coverage });
      
      const text = [
        `🧪 测试结果`,
        `命令：${result.command}`,
        `耗时：${(result.duration / 1000).toFixed(1)}秒`,
        ``,
        result.success ? `✅ 全部通过` : `❌ 失败`,
        `总计：${result.total}`,
        `通过：${result.passed}`,
        `失败：${result.failed}`,
        `跳过：${result.skipped}`,
        coverage && result.coverage ? `\n覆盖率:\n  行：${result.coverage.lines}%\n  函数：${result.coverage.functions}%\n  分支：${result.coverage.branches}%` : "",
        result.failures.length > 0 ? `\n失败的测试:\n${result.failures.map(f => `  - ${f.name}\n    ${f.error}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 运行失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_autofix_lint",
  {
    title: "Swarm 自动修复 Lint",
    description: "自动修复代码检查错误。",
    inputSchema: z.object({
      projectRoot: z.string().describe("项目根目录"),
      maxAttempts: z.number().optional().describe("最大尝试次数"),
    }),
  },
  async ({ projectRoot, maxAttempts }) => {
    try {
      const ci = createCITools(projectRoot);
      const result = await ci.autoFixLint({ maxAttempts });
      
      const text = [
        `🔧 自动修复结果`,
        `尝试次数：${result.attempts}`,
        result.success ? `✅ 修复成功` : `❌ 修复失败`,
        `剩余错误：${result.remainingErrors}`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 修复失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// 文件锁工具
server.registerTool(
  "swarm_get_lock_stats",
  {
    title: "Swarm 文件锁状态",
    description: "获取文件锁的统计信息。",
    inputSchema: z.object({}),
  },
  async () => {
    const stats = fileLockManager.getStats();
    
    const text = [
      `🔒 文件锁统计`,
      `活跃锁：${stats.activeLocks}`,
      `等待中：${stats.waitingCount}`,
      ``,
      Object.entries(stats.locksByOwner).length > 0
        ? `按所有者:\n${Object.entries(stats.locksByOwner).map(([owner, count]) => `  - ${owner}: ${count}`).join("\n")}`
        : "无活跃锁",
    ].filter(Boolean).join("\n");

    return { content: [{ type: "text" as const, text }] };
  }
);

// ==================== 新增：Agent 系统工具 ====================

server.registerTool(
  "swarm_list_agents",
  {
    title: "Swarm 列出 Agent",
    description: "列出所有可用的专业 Agent，支持按类别筛选。",
    inputSchema: z.object({
      category: z.enum(["architecture", "development", "quality", "specialized"]).optional().describe("Agent 类别"),
    }),
  },
  async ({ category }) => {
    try {
      const agents = category 
        ? getAgentsByCategory(category)
        : listAvailableAgents();
      
      const text = [
        `🤖 可用 Agent${category ? ` (${category})` : ""}`,
        `总数：${agents.length}`,
        ``,
        ...agents.map(agent => [
          `**${agent.name}** (${agent.id})`,
          `  ${agent.description}`,
          `  首选模型：${agent.preferredModel}`,
          `  技能：${agent.skills.join(", ")}`,
          `  用途：${agent.useCases.join(", ")}`,
          ``,
        ]).flat(),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_recommend_agent",
  {
    title: "Swarm 推荐 Agent",
    description: "根据任务描述智能推荐最合适的专业 Agent。",
    inputSchema: z.object({
      task: z.string().describe("任务描述"),
      projectRoot: z.string().optional().describe("项目根目录（用于技术栈分析）"),
    }),
  },
  async ({ task, projectRoot }) => {
    try {
      let techStack;
      if (projectRoot) {
        const techDetector = createTechStackDetector(projectRoot);
        techStack = await techDetector.detect();
      }
      
      const recommendation = recommendAgent(task, techStack);
      
      const text = [
        `🎯 Agent 推荐结果`,
        ``,
        `**推荐 Agent**: ${recommendation.agentName} (\`${recommendation.agentId}\`)`,
        `**置信度**: ${(recommendation.confidence * 100).toFixed(1)}%`,
        ``,
        `**推荐理由**: ${recommendation.reason}`,
        ``,
        `**匹配关键词**: ${recommendation.matchedKeywords.join(", ") || "无"}`,
        ``,
        recommendation.alternativeAgents.length > 0
          ? `**备选 Agent**:\n${recommendation.alternativeAgents.map(a => `  - ${a}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 推荐失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// ==================== 新增：动态 Agent 蜂群工具 ====================

server.registerTool(
  "swarm_create_dynamic_agents",
  {
    title: "Swarm 动态创建 Agent 团队",
    description: "根据任务描述自动生成多个 specialized sub-agents，实现自组织结构（参考 Kimi K2.5 Agent Swarm）。",
    inputSchema: z.object({
      task: z.string().describe("任务描述"),
      maxAgents: z.number().optional().describe("最大 Agent 数量，默认 10"),
      requireDebate: z.boolean().optional().describe("是否需要多视角辩论，默认 false"),
      domain: z.string().optional().describe("领域背景（可选）"),
      coordinationStrategy: z.enum(["parallel", "sequential", "debate", "map_reduce"]).optional().describe("协调策略，默认 parallel"),
    }),
  },
  async ({ task, maxAgents, requireDebate, domain, coordinationStrategy }) => {
    try {
      const swarm = await createSwarmForTask(task, {
        maxAgents,
        requireDebate,
        domain,
        coordinationStrategy,
      });

      const text = [
        `🐝 Agent 蜂群创建成功`,
        ``,
        `**蜂群 ID**: ${swarm.swarmId}`,
        `**主任务**: ${task}`,
        `**协调策略**: ${swarm.coordinationStrategy}`,
        `**Agent 数量**: ${swarm.agents.length}`,
        ``,
        `## Agent 列表`,
        ...swarm.agents.map((a, i) => `### ${i + 1}. ${a.name} (\`${a.role}\`)`),
        ``,
        `**下一步**: 使用 \`swarm_execute_swarm\` 执行此蜂群任务`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 创建失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_execute_swarm",
  {
    title: "Swarm 执行 Agent 蜂群",
    description: "执行已创建的 Agent 蜂群任务，支持并行、辩论、Map-Reduce 等协调策略。",
    inputSchema: z.object({
      task: z.string().describe("任务描述"),
      maxAgents: z.number().optional().describe("最大 Agent 数量，默认 10"),
      requireDebate: z.boolean().optional().describe("是否需要多视角辩论，默认 false"),
      domain: z.string().optional().describe("领域背景（可选）"),
      coordinationStrategy: z.enum(["parallel", "sequential", "debate", "map_reduce"]).optional().describe("协调策略，默认 parallel"),
      maxConcurrent: z.number().optional().describe("最大并发数，默认 10"),
    }),
  },
  async ({ task, maxAgents, requireDebate, domain, coordinationStrategy, maxConcurrent }) => {
    try {
      const swarm = await createSwarmForTask(task, {
        maxAgents,
        requireDebate,
        domain,
        coordinationStrategy,
      });

      const result = await executeAgentSwarm({
        ...swarm,
        maxConcurrent,
      });

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `❌ 执行失败：${result.error}` }],
        };
      }

      const text = [
        `✅ Agent 蜂群执行完成`,
        ``,
        `**总耗时**: ${(result.totalDuration / 1000).toFixed(2)}s`,
        `**Agent 数量**: ${result.agentResults.length}`,
        ``,
        `## 各 Agent 输出`,
        ``,
        ...result.agentResults.map((r) => `### ${r.agentName}\n\n${r.output}\n`),
        ``,
        `---`,
        ``,
        `## 综合输出`,
        ``,
        result.mainOutput,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 执行失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_generate_agent_roles",
  {
    title: "Swarm 生成 Agent 角色",
    description: "仅生成 Agent 角色定义（不执行），用于查看系统会创建哪些 specialized sub-agents。",
    inputSchema: z.object({
      task: z.string().describe("任务描述"),
      maxAgents: z.number().optional().describe("最大 Agent 数量，默认 10"),
      requireDebate: z.boolean().optional().describe("是否需要多视角辩论，默认 false"),
      domain: z.string().optional().describe("领域背景（可选）"),
    }),
  },
  async ({ task, maxAgents, requireDebate, domain }) => {
    try {
      const agents = await generateAgentRoles(task, { maxAgents, requireDebate, domain });

      const text = [
        `🎯 生成的 Agent 角色`,
        ``,
        `**任务**: ${task}`,
        `**Agent 数量**: ${agents.length}`,
        ``,
        ...agents.map((a, i) =>
          [
            `### ${i + 1}. ${a.name} (\`${a.role}\`)`,
            ``,
            `**ID**: ${a.id}`,
            `**描述**: ${a.description}`,
            `**专长**: ${a.specialties.join(", ")}`,
            `**模型**: ${a.model}`,
            ``,
            `**System Prompt**:\n\`\`\`\n${a.systemPrompt}\n\`\`\``,
          ].join("\n")
        ),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 生成失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// ==================== 新增：工作流系统工具 ====================

server.registerTool(
  "swarm_list_workflow_catalog",
  {
    title: "Swarm 列出推荐工作流目录",
    description: "列出所有可用的工作流，支持按类别筛选。",
    inputSchema: z.object({
      category: z.enum(["code_quality", "development", "data", "content", "optimization"]).optional().describe("工作流类别"),
    }),
  },
  async ({ category }) => {
    try {
      const workflows = category
        ? filterWorkflowsByCategory(category)
        : listAvailableWorkflows();
      
      const text = [
        `🔄 可用工作流${category ? ` (${category})` : ""}`,
        `总数：${workflows.length}`,
        ``,
        ...workflows.map(workflow => [
          `**${workflow.name}** - ${workflow.description}`,
          `  类别：${workflow.category}`,
          `  难度：${workflow.difficulty}`,
          `  预估时间：${(workflow.estimatedDuration / 60).toFixed(1)} 分钟`,
          `  步骤数：${workflow.steps.length}`,
          `  步骤：${workflow.steps.map(s => s.id).join(" → ")}`,
          ``,
        ]).flat(),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_recommend_workflow",
  {
    title: "Swarm 推荐工作流",
    description: "根据任务描述智能推荐最合适的工作流。",
    inputSchema: z.object({
      task: z.string().describe("任务描述"),
      projectRoot: z.string().optional().describe("项目根目录（用于技术栈分析）"),
    }),
  },
  async ({ task, projectRoot }) => {
    try {
      let techStack;
      if (projectRoot) {
        const techDetector = createTechStackDetector(projectRoot);
        techStack = await techDetector.detect();
      }
      
      const recommendation = recommendWorkflow(task, techStack);
      
      const text = [
        `🎯 工作流推荐结果`,
        ``,
        `**推荐工作流**: ${recommendation.workflowName} (\`${recommendation.workflowId}\`)`,
        `**类别**: ${recommendation.category}`,
        `**置信度**: ${(recommendation.confidence * 100).toFixed(1)}%`,
        `**预估时间**: ${(recommendation.estimatedDuration / 60).toFixed(1)} 分钟`,
        ``,
        `**推荐理由**: ${recommendation.reason}`,
        ``,
        `**匹配关键词**: ${recommendation.matchedKeywords.join(", ") || "无"}`,
        ``,
        recommendation.alternativeWorkflows.length > 0
          ? `**备选工作流**:\n${recommendation.alternativeWorkflows.map(w => `  - ${w}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 推荐失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// ==================== 新增：技能系统工具 ====================

server.registerTool(
  "swarm_list_skills",
  {
    title: "Swarm 列出技能",
    description: "列出所有可用的技能。",
    inputSchema: z.object({
      category: z.enum(["analysis", "generation", "validation", "transformation", "optimization"]).optional().describe("技能类别"),
    }),
  },
  async ({ category }) => {
    try {
      const skills = category
        ? BUILTIN_SKILLS.filter(s => s.category === category)
        : BUILTIN_SKILLS;
      
      const text = [
        `🛠️  可用技能${category ? ` (${category})` : ""}`,
        `总数：${skills.length}`,
        ``,
        ...skills.map(skill => [
          `**${skill.name}** (\`${skill.id}\`)`,
          `  ${skill.description}`,
          `  类别：${skill.category}`,
          `  预估时间：${skill.estimatedDuration || "未知"} 秒`,
          `  标签：${skill.tags?.join(", ") || "无"}`,
          ``,
        ]).flat(),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_execute_skill",
  {
    title: "Swarm 执行技能",
    description: "执行指定的技能（如代码审查、文档生成等）。",
    inputSchema: z.object({
      skillId: z.enum(BUILTIN_SKILLS.map(s => s.id) as [string, ...string[]]).describe("技能 ID"),
      input: z.record(z.string(), z.any()).describe("技能输入参数"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ skillId, input, projectRoot }) => {
    try {
      const context = {
        projectRoot: projectRoot || process.cwd(),
      };
      
      const result = await skillLoader.executeSkill(skillId, input, context);
      
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `❌ 执行失败：${result.error}` }],
        };
      }
      
      const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
      const text = [
        `✅ 技能执行成功`,
        `技能：${skill?.name || skillId}`,
        `耗时：${(result.duration || 0).toFixed(1)}ms`,
        ``,
        `**结果**:\n${JSON.stringify(result.data, null, 2)}`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 执行失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// ==================== 新增：治理层工具 ====================

server.registerTool(
  "swarm_list_gates",
  {
    title: "Swarm 列出质量门控",
    description: "列出所有可用的质量门控。",
    inputSchema: z.object({
      type: z.enum(["quality_check", "security_check", "performance_check", "compliance_check"]).optional().describe("门控类型"),
    }),
  },
  async ({ type }) => {
    try {
      const gates = type
        ? getGatesByType(type)
        : QUALITY_GATES;
      
      const text = [
        `🚧 可用质量门控${type ? ` (${type})` : ""}`,
        `总数：${gates.length}`,
        ``,
        ...gates.map(gate => [
          `**${gate.name}** (\`${gate.id}\`)`,
          `  ${gate.description}`,
          `  类型：${gate.type}`,
          `  阻断：${gate.blocked ? "是" : "否"}`,
          `  阈值：${JSON.stringify(gate.thresholds)}`,
          ``,
        ]).flat(),
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_validate_with_gates",
  {
    title: "Swarm 质量门控验证",
    description: "使用质量门控验证内容（代码、文档等）。",
    inputSchema: z.object({
      content: z.string().describe("待验证的内容"),
      gateIds: z.array(z.enum(QUALITY_GATES.map(g => g.id) as [string, ...string[]])).optional().describe("要使用的门控 ID 列表，默认使用所有门控"),
      projectRoot: z.string().optional().describe("项目根目录"),
    }),
  },
  async ({ content, gateIds, projectRoot }) => {
    try {
      const gates = gateIds
        ? QUALITY_GATES.filter(g => gateIds.includes(g.id))
        : QUALITY_GATES;
      
      const result = await validateWithGates(content, {
        level: 1,
        gates,
        context: { projectRoot },
      });
      
      const text = [
        `🔍 质量门控验证结果`,
        ``,
        `**验证状态**: ${result.passed ? "✅ 通过" : "❌ 未通过"}`,
        `**置信度**: ${(result.confidence * 100).toFixed(1)}%`,
        ``,
        result.gateResults && result.gateResults.length > 0
          ? [
              `**门控详情**:\n`,
              ...result.gateResults.map((gateResult, i) => [
                `${i + 1}. **${gates[i].name}** - ${gateResult.passed ? "✅ 通过" : "❌ 未通过"}`,
                `   得分：${gateResult.score}/100`,
                `   阻断：${gateResult.blocked ? "是" : "否"}`,
                gateResult.issues.length > 0 ? `   问题:\n${gateResult.issues.map(i => `     - ${i}`).join("\n")}` : "",
                gateResult.suggestions.length > 0 ? `   建议:\n${gateResult.suggestions.map(s => `     - ${s}`).join("\n")}` : "",
                ``,
              ]).flat(),
            ]
          : [],
        result.details.length > 0 ? `**详细信息**:\n${result.details.map(d => `  - ${d}`).join("\n")}` : "",
        result.suggestions && result.suggestions.length > 0 ? `\n**修复建议**:\n${result.suggestions.map(s => `  - ${s}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 验证失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// ==================== 数据库模块工具 ====================

// 数据库管理器（延迟初始化）
let dbManager: DatabaseManager | null = null;
let vectorStore: VectorStore | null = null;
let smartCache: SmartCache | null = null;
let codeStore: CodeStore | null = null;

// 初始化数据库
async function initializeDatabase() {
  if (dbManager) {
    return;
  }

  try {
    const config = loadDatabaseConfig();
    dbManager = new DatabaseManager(config);
    
    // 仅在环境变量配置了数据库时才连接
    if (process.env.DB_POSTGRESQL_HOST || process.env.DB_MONGODB_URI || process.env.DB_REDIS_HOST) {
      await dbManager.connect();
      
      // 初始化向量存储
      if (dbManager.getPostgresPool()) {
        vectorStore = new VectorStore(dbManager.getPostgresPool());
        await vectorStore.createTable();
      }
      
      // 初始化缓存
      if (dbManager.getRedisClient()) {
        smartCache = new SmartCache(dbManager.getRedisClient());
      }
      
      // 初始化代码存储
      if (dbManager.getMongoDb()) {
        codeStore = new CodeStore(dbManager.getMongoDb());
        await codeStore.createIndexes();
      }
      
      logger.info("database_initialized", {
        postgresql: !!dbManager.getPostgresPool(),
        mongodb: !!dbManager.getMongoDb(),
        redis: !!dbManager.getRedisClient(),
      });
    } else {
      logger.info("database_skipped", { reason: "未配置环境变量" });
    }
  } catch (error) {
    logger.error("database_init_failed", error instanceof Error ? error.message : String(error));
    // 不抛出异常，允许服务继续运行
  }
}

server.registerTool(
  "swarm_db_stats",
  {
    title: "Swarm 数据库统计",
    description: "获取数据库连接和存储统计信息。",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      await initializeDatabase();
      
      if (!dbManager || !dbManager.isConnected()) {
        return {
          content: [{ type: "text" as const, text: "数据库未连接或未配置" }],
        };
      }
      
      const stats = dbManager.getStats();
      const text = [
        `📊 数据库统计`,
        ``,
        `**连接状态**: ${dbManager.isConnected() ? "✅ 已连接" : "❌ 未连接"}`,
        ``,
        `**数据库**:\n- PostgreSQL: ${stats.postgresql ? "✅" : "❌"}\n- MongoDB: ${stats.mongodb ? "✅" : "❌"}\n- Redis: ${stats.redis ? "✅" : "❌"}`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_vector_search",
  {
    title: "Swarm 向量搜索",
    description: "使用向量相似度搜索代码或文档。",
    inputSchema: z.object({
      query: z.string().describe("搜索查询"),
      limit: z.number().optional().describe("返回结果数量，默认 10"),
    }),
  },
  async ({ query, limit }) => {
    try {
      await initializeDatabase();
      
      if (!vectorStore) {
        return {
          content: [{ type: "text" as const, text: "向量存储未初始化（需要 PostgreSQL + pgvector）" }],
        };
      }

      const topK = Math.min(Math.max(limit ?? 10, 1), 50);
      let embedding: number[] | null = null;
      try {
        embedding = await getEmbedding(query);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        return {
          content: [{
            type: "text" as const,
            text: [
              `🔍 向量搜索`,
              `查询：${query}`,
              ``,
              `❌ 文本向量化失败（请配置 Embedding API）：${errMsg}`,
              ``,
              `可选配置：SWARM_EMBEDDING_API_BASE_URL、SWARM_EMBEDDING_MODEL（如 text-embedding-v3）、SWARM_API_KEY`,
            ].join("\n"),
          }],
        };
      }

      if (!embedding || embedding.length === 0) {
        return {
          content: [{ type: "text" as const, text: `🔍 向量搜索\n查询：${query}\n\n❌ 未获取到向量，请检查 Embedding API 返回格式。` }],
        };
      }

      const results = await vectorStore.similaritySearch(embedding, topK);
      const lines = [
        `🔍 向量搜索`,
        `查询：${query}`,
        `返回数量：${results.length}`,
        ``,
      ];
      if (results.length === 0) {
        lines.push("未找到相似内容。可先使用「写入向量」类能力向表中插入文档后再搜索。");
      } else {
        results.forEach((r, i) => {
          lines.push(`--- 结果 ${i + 1} (相似度 ${(r.similarity ?? 0).toFixed(4)}) ---`);
          lines.push(r.content);
          if (r.metadata && Object.keys(r.metadata).length > 0) {
            lines.push(`元数据: ${JSON.stringify(r.metadata)}`);
          }
          lines.push("");
        });
      }
      const text = lines.join("\n").trimEnd();

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 搜索失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_vector_upsert",
  {
    title: "Swarm 向量写入",
    description: "将一段文本向量化并写入向量库，便于后续向量搜索。",
    inputSchema: z.object({
      content: z.string().describe("要写入的文本内容"),
      metadata: z.record(z.unknown()).optional().describe("可选元数据（JSON 对象）"),
    }),
  },
  async ({ content, metadata }) => {
    try {
      await initializeDatabase();
      if (!vectorStore) {
        return {
          content: [{ type: "text" as const, text: "向量存储未初始化（需要 PostgreSQL + pgvector）" }],
        };
      }
      const embedding = await getEmbedding(content);
      if (!embedding || embedding.length === 0) {
        return {
          content: [{ type: "text" as const, text: "❌ 文本向量化失败，请配置 SWARM_EMBEDDING_MODEL 与 Embedding API。" }],
        };
      }
      const id = await vectorStore.insert({ content, embedding, metadata });
      return {
        content: [{ type: "text" as const, text: `✅ 已写入向量库，id: ${id}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 写入失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_cache_stats",
  {
    title: "Swarm 缓存统计",
    description: "获取 Redis 缓存统计信息。",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      await initializeDatabase();
      
      if (!smartCache) {
        return {
          content: [{ type: "text" as const, text: "缓存未初始化（需要 Redis）" }],
        };
      }
      
      const stats = await smartCache.stats();
      const text = [
        `📊 缓存统计`,
        ``,
        `**总键数**: ${stats.totalKeys}`,
        `**内存使用**: ${(stats.memoryUsage / 1024).toFixed(2)} KB`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

server.registerTool(
  "swarm_code_stats",
  {
    title: "Swarm 代码库统计",
    description: "获取 MongoDB 代码存储的统计信息。",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      await initializeDatabase();
      
      if (!codeStore) {
        return {
          content: [{ type: "text" as const, text: "代码存储未初始化（需要 MongoDB）" }],
        };
      }
      
      const stats = await codeStore.stats();
      const text = [
        `📊 代码库统计`,
        ``,
        `**总文件数**: ${stats.totalFiles}`,
        `**总行数**: ${stats.totalLines.toLocaleString()}`,
        ``,
        `**按语言**:\n${Object.entries(stats.byLanguage).map(([lang, count]) => `  - ${lang}: ${count}`).join("\n")}`,
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `❌ 获取失败：${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
);

// 辅助函数
function getFileSystemTools(projectRoot?: string): FileSystemTools {
  if (!projectRoot) {
    throw new Error("必须指定 projectRoot 参数");
  }
  
  if (!fsTools || true) { // 总是创建新的实例以支持不同项目
    fsTools = createFileSystemTools(projectRoot);
  }
  
  return fsTools;
}

function getCodebaseIndexer(projectRoot: string): CodebaseIndexer {
  if (!codebaseIndex || true) {
    codebaseIndex = new CodebaseIndexer(projectRoot);
  }
  return codebaseIndex;
}

// 启动文件锁清理
fileLockManager.startCleanupInterval();

const transport = new StdioServerTransport();
await server.connect(transport);
