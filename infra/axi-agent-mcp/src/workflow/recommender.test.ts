/**
 * 工作流推荐系统单元测试
 */
import { describe, it, expect } from "vitest";
import {
  recommendWorkflow,
  listAvailableWorkflows,
  filterWorkflowsByCategory,
  getCategories,
} from "./recommender.js";
import type { TechStackInfo } from "../tools/tech-stack-detector.js";

describe("recommendWorkflow", () => {
  it("应基于关键词推荐代码审查工作流", () => {
    const r = recommendWorkflow("对这段代码做 review 和审查");
    expect(r.workflowId).toBeDefined();
    expect(r.workflowName).toBeDefined();
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.estimatedDuration).toBeGreaterThan(0);
    expect(["code_review", "security_audit"]).toContain(r.workflowId);
  });

  it("应基于关键词推荐 bug 修复工作流", () => {
    const r = recommendWorkflow("修复一个 bug，调试崩溃问题");
    expect(r.workflowId).toBe("bug_fix");
  });

  it("无匹配时应返回默认工作流", () => {
    const r = recommendWorkflow("随便做点什么");
    expect(r.workflowId).toBeDefined();
    expect(r.confidence).toBe(0.5);
    expect(r.matchedKeywords).toEqual([]);
  });

  it("接受可选 techStack", () => {
    const techStack: TechStackInfo = {
      backend: { framework: "NestJS", database: "PostgreSQL" },
      testing: true,
    };
    const r = recommendWorkflow("数据迁移", techStack);
    expect(r.workflowId).toBeDefined();
  });
});

describe("listAvailableWorkflows", () => {
  it("应返回非空工作流列表", () => {
    const list = listAvailableWorkflows();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("filterWorkflowsByCategory", () => {
  it("应按类别筛选工作流", () => {
    const list = filterWorkflowsByCategory("code_quality");
    expect(Array.isArray(list)).toBe(true);
  });
});

describe("getCategories", () => {
  it("应返回分类列表", () => {
    const cats = getCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats.length).toBeGreaterThan(0);
  });
});
