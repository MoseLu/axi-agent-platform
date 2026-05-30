/**
 * 动态 Agent 创建系统
 * 根据任务描述自动生成 specialized sub-agents，实现自组织结构
 * 参考 Kimi K2.5 Agent Swarm 的 PARL（Parallel-Agent Reinforcement Learning）理念
 */

import { chat } from "../api-client.js";
import { logger } from "../logger.js";
import { AgentRole, AgentConfig, AgentResult, AgentContext } from "./specialists.js";

export interface DynamicAgentConfig {
  id: string;
  name: string;
  role: string; // 动态生成的角色名（如 "skeptical_vc", "veteran_pm"）
  description: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  specialties: string[];
  parentTaskId?: string; // 所属的主任务 ID（用于蜂群协作）
}

export interface AgentSwarmDefinition {
  swarmId: string;
  mainTask: string;
  agents: DynamicAgentConfig[];
  coordinationStrategy: "parallel" | "sequential" | "debate" | "map_reduce";
  maxConcurrent?: number;
}

export interface SwarmExecutionResult {
  success: boolean;
  mainOutput: string;
  agentResults: Array<{
    agentId: string;
    agentName: string;
    output: string;
    duration: number;
  }>;
  totalDuration: number;
  error?: string;
}

/**
 * 使用 LLM 自动生成 Agent 角色定义
 */
export async function generateAgentRoles(
  taskDescription: string,
  options?: {
    maxAgents?: number;
    requireDebate?: boolean;
    domain?: string;
  }
): Promise<DynamicAgentConfig[]> {
  const maxAgents = options?.maxAgents ?? 10;
  const requireDebate = options?.requireDebate ?? false;
  const domain = options?.domain;

  const prompt = `
你是一个专业的 AI 组织架构师，擅长根据任务需求设计最优的 Agent 团队结构。

## 任务描述
${taskDescription}

${domain ? `## 领域背景\n${domain}\n` : ""}

## 要求
1. 设计 ${maxAgents} 个以内 specialized sub-agents
2. 每个 Agent 必须有明确的角色定位和专长
3. 如果需要多视角辩论，确保包含不同立场（如：支持者、质疑者、中立评估者）
4. Agent 角色应该是具体的、有辨识度的（如 "skeptical_vc", "veteran_pm", "ethics_reviewer"）

## 输出格式（JSON）
请返回一个 JSON 数组，每个元素包含：
- id: string (短标识，如 "agent_1")
- name: string (角色名，如 "Skeptical VC", "Veteran PM")
- role: string (角色类型，如 "vc_investor", "product_manager")
- description: string (一句话描述)
- systemPrompt: string (完整的 system prompt，包含专长和工作规范)
- specialties: string[] (专长列表)
- model: string (推荐模型，如 "qwen3-max-2026-01-23" 用于推理，"qwen3-coder-next" 用于代码)

## 示例输出
[
  {
    "id": "agent_1",
    "name": "Skeptical VC",
    "role": "vc_investor",
    "description": "风险投资家，专注于质疑商业模式和单位经济",
    "systemPrompt": "你是一个经验丰富的风险投资家...",
    "specialties": ["单位经济分析", "市场评估", "商业模式"],
    "model": "qwen3-max-2026-01-23"
  }
]

现在请为上述任务设计 Agent 团队：
`.trim();

  try {
    const response = await chat({
      model: "qwen3-max-2026-01-23",
      messages: [
        { role: "system", content: "你是一个专业的 AI 组织架构师，擅长设计最优的多 Agent 协作结构。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    });

    if (!response.success || !response.content) {
      throw new Error(response.error || "生成 Agent 角色失败");
    }

    // 解析 JSON
    const content = response.content.trim();
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("响应中未找到 JSON 数组");
    }

    const agents = JSON.parse(jsonMatch[0]) as DynamicAgentConfig[];
    
    // 验证和补全
    return agents.slice(0, maxAgents).map((agent, index) => ({
      ...agent,
      id: agent.id || `agent_${index + 1}`,
      model: agent.model || "qwen3-coder-next",
      temperature: agent.temperature ?? 0.5,
      maxTokens: agent.maxTokens ?? 4096,
    }));
  } catch (error) {
    logger.error("generate_agent_roles_failed", error instanceof Error ? error : String(error));
    throw error;
  }
}

/**
 * 创建动态 Agent 实例
 */
export function createDynamicAgent(config: DynamicAgentConfig) {
  return {
    config,

    /**
     * 执行任务
     */
    async execute(context: AgentContext): Promise<AgentResult> {
      const startTime = Date.now();

      try {
        const response = await chat({
          model: config.model,
          messages: [
            { role: "system", content: config.systemPrompt },
            {
              role: "user",
              content: `任务：${context.input}\n\n` +
                `${context.files?.length ? `相关文件：${context.files.join(", ")}\n\n` : ""}` +
                `${context.constraints?.length ? `约束条件：${context.constraints.join("\n")}\n\n` : ""}` +
                `输出格式：${context.outputFormat || "text"}`,
            },
          ],
          temperature: config.temperature,
          max_tokens: config.maxTokens,
        });

        if (!response.success || !response.content) {
          return {
            success: false,
            output: "",
            duration: Date.now() - startTime,
            error: response.error,
          };
        }

        return {
          success: true,
          output: response.content,
          duration: Date.now() - startTime,
          tokens: response.tokens,
        };
      } catch (error) {
        return {
          success: false,
          output: "",
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 执行 Agent 蜂群任务
 */
export async function executeAgentSwarm(
  swarm: AgentSwarmDefinition
): Promise<SwarmExecutionResult> {
  const startTime = Date.now();
  const agentResults: SwarmExecutionResult["agentResults"] = [];

  try {
    // 根据协调策略执行
    if (swarm.coordinationStrategy === "parallel") {
      // 并行执行所有 Agent
      const maxConcurrent = swarm.maxConcurrent ?? 10;
      const batches: DynamicAgentConfig[][] = [];
      
      for (let i = 0; i < swarm.agents.length; i += maxConcurrent) {
        batches.push(swarm.agents.slice(i, i + maxConcurrent));
      }

      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(async (agentConfig) => {
            const agent = createDynamicAgent(agentConfig);
            const result = await agent.execute({
              taskId: `${swarm.swarmId}-${agentConfig.id}`,
              input: swarm.mainTask,
              outputFormat: "text",
            });

            return {
              agentId: agentConfig.id,
              agentName: agentConfig.name,
              output: result.output,
              duration: result.duration,
            };
          })
        );
        agentResults.push(...batchResults);
      }
    } else if (swarm.coordinationStrategy === "debate") {
      // 多视角辩论模式
      // 第一阶段：各 Agent 独立输出
      const independentResults = await Promise.all(
        swarm.agents.map(async (agentConfig) => {
          const agent = createDynamicAgent(agentConfig);
          return agent.execute({
            taskId: `${swarm.swarmId}-${agentConfig.id}`,
            input: swarm.mainTask,
            outputFormat: "text",
          });
        })
      );

      independentResults.forEach((result, index) => {
        agentResults.push({
          agentId: swarm.agents[index].id,
          agentName: swarm.agents[index].name,
          output: result.output,
          duration: result.duration,
        });
      });

      // 第二阶段：综合辩论结果
      const debatePrompt = `
你是一个公正的主持人，负责综合多位专家的意见。

## 原始任务
${swarm.mainTask}

## 各位专家的意见
${agentResults.map((r, i) => `### ${r.agentName}\n${r.output}`).join("\n\n")}

## 要求
1. 总结各方的核心观点
2. 指出共识和分歧
3. 给出综合性的结论和建议
4. 如果有冲突，说明权衡的依据

请输出综合结论：
`.trim();

      const synthesizer = await chat({
        model: "qwen3-max-2026-01-23",
        messages: [
          { role: "system", content: "你是一个公正的主持人，擅长综合多方意见并给出平衡的结论。" },
          { role: "user", content: debatePrompt },
        ],
        temperature: 0.5,
        max_tokens: 4096,
      });

      if (synthesizer.success && synthesizer.content) {
        agentResults.push({
          agentId: "synthesizer",
          agentName: "Debate Moderator",
          output: synthesizer.content,
          duration: Date.now() - startTime,
        });
      }
    } else {
      // sequential 或 map_reduce：顺序执行
      for (const agentConfig of swarm.agents) {
        const agent = createDynamicAgent(agentConfig);
        const result = await agent.execute({
          taskId: `${swarm.swarmId}-${agentConfig.id}`,
          input: swarm.mainTask,
          outputFormat: "text",
        });

        agentResults.push({
          agentId: agentConfig.id,
          agentName: agentConfig.name,
          output: result.output,
          duration: result.duration,
        });
      }
    }

    // 综合所有结果
    const mainOutput = agentResults.map((r) => `## ${r.agentName}\n${r.output}`).join("\n\n");

    return {
      success: true,
      mainOutput,
      agentResults,
      totalDuration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      mainOutput: "",
      agentResults,
      totalDuration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 快速创建一个针对任务的 Agent 蜂群
 */
export async function createSwarmForTask(
  taskDescription: string,
  options?: {
    maxAgents?: number;
    requireDebate?: boolean;
    domain?: string;
    coordinationStrategy?: AgentSwarmDefinition["coordinationStrategy"];
  }
): Promise<AgentSwarmDefinition> {
  const agents = await generateAgentRoles(taskDescription, options);

  return {
    swarmId: `swarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    mainTask: taskDescription,
    agents,
    coordinationStrategy: options?.coordinationStrategy || "parallel",
    maxConcurrent: options?.maxAgents ?? 10,
  };
}
