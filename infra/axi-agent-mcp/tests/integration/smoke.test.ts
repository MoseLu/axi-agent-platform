/**
 * 集成测试：核心模块联动（无需 MCP 服务器与真实 API）
 */
import { describe, it, expect } from "vitest";
import { recommendAgent } from "../../src/agents/recommender.js";
import { recommendWorkflow, listAvailableWorkflows } from "../../src/workflow/recommender.js";
import { codeQualityGate, getGatesByType } from "../../src/governance/quality-gates.js";
import { skillLoader, BUILTIN_SKILLS } from "../../src/skills/index.js";
import { getBuiltinWorkflow } from "../../src/workflow/index.js";

describe("集成：Agent + 工作流 + 门控 + 技能", () => {
  it("Agent 推荐 → 工作流推荐 链路", () => {
    const task = "用 React 写登录页并做代码审查";
    const agentRec = recommendAgent(task);
    expect(agentRec.agentId).toBeDefined();
    const workflowRec = recommendWorkflow(task);
    expect(workflowRec.workflowId).toBeDefined();
    expect(workflowRec.confidence).toBeGreaterThanOrEqual(0);
  });

  it("工作流列表与内置工作流可解析", () => {
    const list = listAvailableWorkflows();
    expect(list.length).toBeGreaterThan(0);
    const builtin = getBuiltinWorkflow("code_review");
    expect(builtin).toBeDefined();
    if (builtin) {
      expect(builtin.steps).toBeDefined();
      expect(builtin.steps.length).toBeGreaterThan(0);
    }
  });

  it("质量门控执行返回合法结构", async () => {
    const gates = getGatesByType("quality_check");
    expect(gates.length).toBeGreaterThan(0);
    const result = await codeQualityGate.execute({ code: "const x = 1;", coverage: 0.9 });
    expect(result.passed).toBeDefined();
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("技能加载与列表一致", async () => {
    const id = BUILTIN_SKILLS[0]?.id;
    if (!id) return;
    const skill = await skillLoader.loadSkill(id);
    expect(skill.id).toBe(id);
    const loaded = skillLoader.getLoadedSkills();
    expect(loaded.some((s) => s.id === id)).toBe(true);
  });
});
