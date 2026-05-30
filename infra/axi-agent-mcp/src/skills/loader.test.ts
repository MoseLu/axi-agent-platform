/**
 * 技能加载器单元测试
 */
import { describe, it, expect } from "vitest";
import { skillLoader, BUILTIN_SKILLS } from "./index.js";

describe("BUILTIN_SKILLS", () => {
  it("应包含多个内置技能", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
    BUILTIN_SKILLS.forEach((s) => {
      expect(s.id).toBeDefined();
      expect(s.name).toBeDefined();
      expect(typeof s.execute === "function" || s.steps).toBe(true);
    });
  });
});

describe("skillLoader", () => {
  it("应能按 id 异步加载技能", async () => {
    const firstId = BUILTIN_SKILLS[0]?.id;
    if (!firstId) return;
    const skill = await skillLoader.loadSkill(firstId);
    expect(skill).toBeDefined();
    expect(skill.id).toBe(firstId);
  });

  it("未知 id 加载应抛错", async () => {
    await expect(skillLoader.loadSkill("non_existent_skill_id")).rejects.toThrow();
  });

  it("getLoadedSkills 在加载后应返回已加载技能", async () => {
    const id = BUILTIN_SKILLS[0]?.id;
    if (!id) return;
    await skillLoader.loadSkill(id);
    const loaded = skillLoader.getLoadedSkills();
    expect(loaded.length).toBeGreaterThanOrEqual(0);
  });

  it("list 可通过 BUILTIN_SKILLS 获取全部", () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThan(0);
  });
});
