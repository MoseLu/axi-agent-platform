/**
 * 质量门控单元测试
 */
import { describe, it, expect } from "vitest";
import {
  codeQualityGate,
  securityReviewGate,
  performanceReviewGate,
  getGatesByType,
  getGateById,
  QUALITY_GATES,
} from "./quality-gates.js";

describe("codeQualityGate", () => {
  it("应对简单代码通过", async () => {
    const result = await codeQualityGate.execute({
      code: "const x = 1;\nconst y = 2;\nreturn x + y;",
      coverage: 0.85,
    });
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("suggestions");
    expect(typeof result.score).toBe("number");
  });
});

describe("securityReviewGate", () => {
  it("应返回 GateResult 结构", async () => {
    const result = await securityReviewGate.execute({
      code: "function hello() { return 'world'; }",
    });
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("score");
    expect(Array.isArray(result.issues)).toBe(true);
  });
});

describe("performanceReviewGate", () => {
  it("应在 executionTime 超标时扣分", async () => {
    const result = await performanceReviewGate.execute({
      executionTime: 2000,
      memoryUsage: 50,
    });
    expect(result.score).toBeLessThan(100);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("getGatesByType", () => {
  it("应按类型返回门控列表", () => {
    const quality = getGatesByType("quality_check");
    expect(Array.isArray(quality)).toBe(true);
    quality.forEach((g) => expect(g.type).toBe("quality_check"));
  });
});

describe("getGateById", () => {
  it("应通过 id 返回门控", () => {
    const gate = getGateById("code_quality");
    expect(gate).toBeDefined();
    expect(gate?.id).toBe("code_quality");
  });
  it("未知 id 应返回 undefined", () => {
    expect(getGateById("unknown")).toBeUndefined();
  });
});

describe("QUALITY_GATES", () => {
  it("应包含至少 3 个门控", () => {
    expect(QUALITY_GATES.length).toBeGreaterThanOrEqual(3);
  });
});
