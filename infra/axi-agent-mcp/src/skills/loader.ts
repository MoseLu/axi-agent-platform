/**
 * 技能加载器
 * 支持按需加载技能，减少初始 token 消耗
 */

import { SkillDefinition, SkillContext, SkillResult, SkillExecutionOptions } from "./types.js";
import { BUILTIN_SKILLS } from "./builtin-skills.js";
import { logger } from "../logger.js";

export class SkillLoader {
  private loadedSkills: Map<string, SkillDefinition> = new Map();
  private executionHistory: Map<string, SkillResult[]> = new Map();

  /**
   * 加载单个技能
   */
  async loadSkill(skillId: string): Promise<SkillDefinition> {
    // 检查是否已加载
    const existing = this.loadedSkills.get(skillId);
    if (existing) {
      return existing;
    }
    
    // 查找技能定义
    const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    
    // 加载技能
    this.loadedSkills.set(skillId, skill);
    
    logger.info("skill_loaded", {
      skillId,
      loadedCount: this.loadedSkills.size,
      totalCount: BUILTIN_SKILLS.length,
    });
    
    return skill;
  }

  /**
   * 批量加载技能
   */
  async loadSkills(skillIds: string[]): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = [];
    
    for (const skillId of skillIds) {
      try {
        const skill = await this.loadSkill(skillId);
        skills.push(skill);
      } catch (error) {
        logger.warn("skill_load_failed", {
          skillId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    return skills;
  }

  /**
   * 执行技能
   */
  async executeSkill(
    skillId: string,
    input: any,
    context: SkillContext,
    options?: SkillExecutionOptions
  ): Promise<SkillResult> {
    const startTime = Date.now();
    
    // 加载技能
    const skill = await this.loadSkill(skillId);
    
    // 执行技能
    try {
      const result = await skill.execute(input, context);
      
      // 记录执行历史
      this.recordExecution(skillId, result);
      
      logger.info("skill_executed", {
        skillId,
        success: result.success,
        duration: result.duration || Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      const result: SkillResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
      
      this.recordExecution(skillId, result);
      
      return result;
    }
  }

  /**
   * 记录执行历史
   */
  private recordExecution(skillId: string, result: SkillResult) {
    const history = this.executionHistory.get(skillId) || [];
    history.push(result);
    
    // 保留最近 10 次执行记录
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    this.executionHistory.set(skillId, history);
  }

  /**
   * 获取已加载的技能
   */
  getLoadedSkills(): SkillDefinition[] {
    return Array.from(this.loadedSkills.values());
  }

  /**
   * 获取技能执行统计
   */
  getExecutionStats(skillId?: string): {
    totalExecutions: number;
    successRate: number;
    avgDuration: number;
    bySkill: Record<string, { executions: number; successRate: number; avgDuration: number }>;
  } {
    const bySkill: Record<string, any> = {};
    let totalExecutions = 0;
    let totalSuccess = 0;
    let totalDuration = 0;
    
    for (const [id, history] of this.executionHistory.entries()) {
      const executions = history.length;
      const success = history.filter(r => r.success).length;
      const duration = history.reduce((sum, r) => sum + (r.duration || 0), 0);
      
      bySkill[id] = {
        executions,
        successRate: executions > 0 ? (success / executions) * 100 : 0,
        avgDuration: executions > 0 ? duration / executions : 0,
      };
      
      totalExecutions += executions;
      totalSuccess += success;
      totalDuration += duration;
    }
    
    return {
      totalExecutions,
      successRate: totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 0,
      avgDuration: totalExecutions > 0 ? totalDuration / totalExecutions : 0,
      bySkill,
    };
  }

  /**
   * 计算技能加载的 token 节省
   */
  calculateTokenSavings(): {
    loadedSkills: number;
    totalSkills: number;
    reductionPercentage: number;
    estimatedTokenSavings: number;
  } {
    const loadedSkills = this.loadedSkills.size;
    const totalSkills = BUILTIN_SKILLS.length;
    const reductionPercentage = totalSkills > 0 ? ((totalSkills - loadedSkills) / totalSkills) * 100 : 0;
    
    // 估算每个技能平均消耗 500 tokens
    const estimatedTokenSavings = (totalSkills - loadedSkills) * 500;
    
    return {
      loadedSkills,
      totalSkills,
      reductionPercentage,
      estimatedTokenSavings,
    };
  }

  /**
   * 清空已加载的技能
   */
  clearLoadedSkills() {
    this.loadedSkills.clear();
    logger.info("skills_cleared", {
      clearedCount: this.loadedSkills.size,
    });
  }

  /**
   * 卸载技能
   */
  unloadSkill(skillId: string): boolean {
    const deleted = this.loadedSkills.delete(skillId);
    
    if (deleted) {
      logger.info("skill_unloaded", { skillId });
    }
    
    return deleted;
  }
}

// 导出单例实例
export const skillLoader = new SkillLoader();
