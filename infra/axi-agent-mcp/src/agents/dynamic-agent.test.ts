/**
 * 动态 Agent 系统单元测试
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../api-client.js", () => ({
  chat: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
    const prompt = options.messages.at(-1)?.content ?? "";

    if (prompt.includes("现在请为上述任务设计 Agent 团队")) {
      return {
        success: true,
        content: JSON.stringify([
          {
            id: "supporter",
            name: "Support Engineer",
            role: "supporter",
            description: "支持方案并提出落地路径",
            systemPrompt: "你负责给出支持视角和执行建议。",
            specialties: ["planning", "implementation"],
            model: "qwen3-coder-next",
          },
          {
            id: "skeptic",
            name: "Skeptical Reviewer",
            role: "skeptical_critic",
            description: "质疑风险和隐藏成本",
            systemPrompt: "你负责从风险视角审查方案。",
            specialties: ["risk", "architecture"],
            model: "qwen3-coder-next",
          },
          {
            id: "builder",
            name: "Implementation Builder",
            role: "implementation_engineer",
            description: "补齐工程实现细节",
            systemPrompt: "你负责把方案转成可执行步骤。",
            specialties: ["coding", "testing"],
            model: "qwen3-coder-next",
          },
        ]),
      };
    }

    if (prompt.includes("请输出综合结论")) {
      return { success: true, content: "综合结论：保留共识，标记风险，并给出下一步。" };
    }

    return { success: true, content: "本地 mock agent 输出", tokens: 12 };
  }),
}));

import {
  generateAgentRoles,
  createDynamicAgent,
  createSwarmForTask,
  executeAgentSwarm,
} from "./dynamic-agent.js";

describe("generateAgentRoles", () => {
  it("应为简单任务生成至少 1 个 Agent", async () => {
    const agents = await generateAgentRoles("用 React 写一个登录组件", {
      maxAgents: 3,
    });
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("id");
    expect(agents[0]).toHaveProperty("name");
    expect(agents[0]).toHaveProperty("systemPrompt");
  });

  it("应为复杂任务生成多个 Agent", async () => {
    const agents = await generateAgentRoles(
      "设计一个电商平台，包含用户系统、商品管理、订单流程、支付集成",
      { maxAgents: 5 }
    );
    expect(agents.length).toBeGreaterThan(1);
    expect(agents.length).toBeLessThanOrEqual(5);
  });

  it("requireDebate 时应包含不同立场的 Agent", async () => {
    const agents = await generateAgentRoles(
      "评估是否应该将单体应用迁移到微服务架构",
      {
        maxAgents: 5,
        requireDebate: true,
      }
    );
    expect(agents.length).toBeGreaterThan(1);
    // 验证有不同角色（如支持者、质疑者）
    const roleNames = agents.map((a) => a.role.toLowerCase());
    const hasDebate =
      roleNames.some((r) => r.includes("support") || r.includes("pro")) ||
      roleNames.some((r) => r.includes("skeptical") || r.includes("critic"));
    expect(hasDebate).toBe(true);
  });
});

describe("createDynamicAgent", () => {
  it("应能创建 Agent 实例", () => {
    const config = {
      id: "test_agent",
      name: "Test Agent",
      role: "tester",
      description: "测试 Agent",
      systemPrompt: "你是一个测试 Agent。",
      model: "qwen3-coder-next",
      temperature: 0.5,
      maxTokens: 1024,
      specialties: ["testing"],
    };
    const agent = createDynamicAgent(config);
    expect(agent).toHaveProperty("config");
    expect(agent).toHaveProperty("execute");
    expect(typeof agent.execute).toBe("function");
  });
});

describe("createSwarmForTask", () => {
  it("应创建完整的蜂群定义", async () => {
    const swarm = await createSwarmForTask("写一个 Todo 应用", {
      maxAgents: 3,
    });
    expect(swarm).toHaveProperty("swarmId");
    expect(swarm).toHaveProperty("mainTask");
    expect(swarm.agents.length).toBeGreaterThan(0);
    expect(swarm.agents.length).toBeLessThanOrEqual(3);
    expect(swarm).toHaveProperty("coordinationStrategy");
  });

  it("应支持不同的协调策略", async () => {
    const swarmDebate = await createSwarmForTask("评估技术方案", {
      maxAgents: 4,
      requireDebate: true,
      coordinationStrategy: "debate",
    });
    expect(swarmDebate.coordinationStrategy).toBe("debate");

    const swarmParallel = await createSwarmForTask("批量处理数据", {
      coordinationStrategy: "parallel",
    });
    expect(swarmParallel.coordinationStrategy).toBe("parallel");
  });
});

describe("executeAgentSwarm", () => {
  it("应能执行并行策略的蜂群", async () => {
    const swarm = await createSwarmForTask("解释什么是递归", {
      maxAgents: 2,
      coordinationStrategy: "parallel",
    });

    const result = await executeAgentSwarm(swarm);
    expect(result.success).toBe(true);
    expect(result.agentResults.length).toBeGreaterThan(0);
    expect(result.mainOutput).toBeDefined();
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("应能执行辩论策略的蜂群", async () => {
    const swarm = await createSwarmForTask(
      "是否应该在项目中使用 TypeScript",
      {
        maxAgents: 3,
        requireDebate: true,
        coordinationStrategy: "debate",
      }
    );

    const result = await executeAgentSwarm(swarm);
    expect(result.success).toBe(true);
    expect(result.agentResults.length).toBeGreaterThan(1);
    // 辩论策略应有综合结论
    const hasSynthesizer = result.agentResults.some(
      (r) => r.agentName.includes("Moderator") || r.agentId === "synthesizer"
    );
    expect(hasSynthesizer).toBe(true);
  }, 30000);
});
