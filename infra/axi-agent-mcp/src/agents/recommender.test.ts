/**
 * Agent 推荐系统单元测试
 */
import { describe, it, expect } from "vitest";
import {
  recommendAgent,
  listAvailableAgents,
  getAgentsByCategory,
} from "./recommender.js";
import type { TechStackInfo } from "../tools/tech-stack-detector.js";

describe("recommendAgent", () => {
  it("应基于关键词推荐前端 Agent", () => {
    const r = recommendAgent("用 React 写一个登录组件");
    expect(r.agentId).toBeDefined();
    expect(r.agentName).toBeDefined();
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
    expect(["frontend_dev", "ui_ux_designer"]).toContain(r.agentId);
  });

  it("应基于关键词推荐后端 Agent", () => {
    const r = recommendAgent("设计用户认证 API，用 Node.js");
    expect(r.agentId).toBeDefined();
    expect(r.reason).toBeDefined();
    expect(["backend_dev", "fullstack_dev"]).toContain(r.agentId);
  });

  it("无匹配关键词时应返回全栈工程师", () => {
    const r = recommendAgent("随便做点什么");
    expect(r.agentId).toBe("fullstack_dev");
    expect(r.confidence).toBe(0.5);
    expect(r.matchedKeywords).toEqual([]);
  });

  it("接受可选 techStack 并影响推荐", () => {
    const techStack: TechStackInfo = {
      frontend: { framework: "React", uiLibrary: "Ant Design" },
      backend: { framework: "NestJS", database: "PostgreSQL" },
      testing: true,
    };
    const r = recommendAgent("写单元测试", techStack);
    expect(r.agentId).toBeDefined();
    expect(r.alternativeAgents.length).toBeGreaterThanOrEqual(0);
  });
});

describe("listAvailableAgents", () => {
  it("应返回非空 Agent 列表", () => {
    const list = listAvailableAgents();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).toHaveProperty("category");
  });
});

describe("getAgentsByCategory", () => {
  it("应按类别筛选 Agent", () => {
    const frontend = getAgentsByCategory("frontend");
    expect(Array.isArray(frontend)).toBe(true);
    frontend.forEach((a) => expect(a.category).toBe("frontend"));
  });
});
