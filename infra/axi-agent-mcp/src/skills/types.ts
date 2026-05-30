/**
 * 技能系统类型定义
 */

import { TechStackInfo } from "../tools/tech-stack-detector.js";

export type SkillCategory = 
  | "analysis"       // 分析类（代码审查、性能分析）
  | "generation"     // 生成类（文档生成、测试生成）
  | "validation"     // 验证类（安全检查、质量检查）
  | "transformation" // 转换类（代码重构、格式转换）
  | "optimization";  // 优化类（性能优化、代码优化）

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  execute: (input: any, context: SkillContext) => Promise<any>;
  estimatedDuration?: number; // 预估执行时间（秒）
  tags?: string[];
}

export interface SkillContext {
  agentId?: string;
  workflowId?: string;
  projectRoot: string;
  techStack?: TechStackInfo;
  variables?: Record<string, any>;
}

export interface SkillResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
  tokens?: number;
  metadata?: Record<string, any>;
}

export interface SkillExecutionOptions {
  timeout?: number; // 超时时间（毫秒）
  retryCount?: number; // 重试次数
  validateOutput?: boolean; // 是否验证输出
}
