/**
 * 工作流推荐系统
 * 基于任务描述和项目上下文智能推荐最合适的工作流
 */

import { WorkflowDefinition, BUILTIN_WORKFLOWS } from "./types.js";
import { TechStackInfo } from "../tools/tech-stack-detector.js";

export type WorkflowCategory =
  | "code_quality"      // 代码质量（review, security, test）
  | "development"       // 开发（bug_fix, api_design）
  | "data"             // 数据（data_analysis, data_migration）
  | "content"          // 内容（content_creation, documentation）
  | "optimization";    // 优化（performance_optimization）

export interface WorkflowMetadata extends WorkflowDefinition {
  category: WorkflowCategory;
  estimatedDuration: number; // 预估耗时（秒）
  difficulty: "beginner" | "intermediate" | "advanced";
}

export interface WorkflowRecommendation {
  workflowId: string;
  workflowName: string;
  category: WorkflowCategory;
  confidence: number; // 0-1 置信度
  reason: string;
  alternativeWorkflows: string[];
  matchedKeywords: string[];
  estimatedDuration: number;
}

/**
 * 关键词到工作流的映射
 */
const KEYWORD_WORKFLOW_MAP: Record<string, string[]> = {
  // 代码质量类
  "审查": ["code_review", "security_audit"],
  "review": ["code_review"],
  "安全": ["security_audit"],
  "security": ["security_audit"],
  "漏洞": ["security_audit"],
  "测试": ["test_generation"],
  "test": ["test_generation"],
  "单元": ["test_generation"],
  
  // 开发类
  "bug": ["bug_fix"],
  "修复": ["bug_fix"],
  "调试": ["bug_fix"],
  "debug": ["bug_fix"],
  "API": ["api_design"],
  "接口": ["api_design"],
  "设计": ["api_design"],
  
  // 数据类
  "数据": ["data_analysis", "data_migration"],
  "data": ["data_analysis", "data_migration"],
  "分析": ["data_analysis"],
  "analysis": ["data_analysis"],
  "迁移": ["data_migration"],
  "migration": ["data_migration"],
  "数据库": ["data_migration"],
  
  // 内容类
  "文档": ["documentation", "content_creation"],
  "document": ["documentation"],
  "content": ["content_creation"],
  "创作": ["content_creation"],
  "写作": ["content_creation"],
  
  // 优化类
  "性能": ["performance_optimization"],
  "performance": ["performance_optimization"],
  "优化": ["performance_optimization"],
  "optimization": ["performance_optimization"],
  "瓶颈": ["performance_optimization"],
};

/**
 * 工作流分类映射
 */
const WORKFLOW_CATEGORY_MAP: Record<string, WorkflowCategory> = {
  "code_review": "code_quality",
  "security_audit": "code_quality",
  "test_generation": "code_quality",
  "bug_fix": "development",
  "api_design": "development",
  "data_analysis": "data",
  "data_migration": "data",
  "documentation": "content",
  "content_creation": "content",
  "performance_optimization": "optimization",
};

/**
 * 工作流元数据
 */
const WORKFLOW_METADATA: Record<string, Omit<WorkflowMetadata, "name" | "description" | "version" | "steps" | "outputFormat" | "tags">> = {
  "code_review": {
    category: "code_quality",
    estimatedDuration: 180, // 3 分钟
    difficulty: "beginner",
  },
  "security_audit": {
    category: "code_quality",
    estimatedDuration: 300, // 5 分钟
    difficulty: "advanced",
  },
  "test_generation": {
    category: "code_quality",
    estimatedDuration: 240, // 4 分钟
    difficulty: "intermediate",
  },
  "bug_fix": {
    category: "development",
    estimatedDuration: 180,
    difficulty: "intermediate",
  },
  "api_design": {
    category: "development",
    estimatedDuration: 240,
    difficulty: "intermediate",
  },
  "data_analysis": {
    category: "data",
    estimatedDuration: 180,
    difficulty: "beginner",
  },
  "data_migration": {
    category: "data",
    estimatedDuration: 360, // 6 分钟
    difficulty: "advanced",
  },
  "documentation": {
    category: "content",
    estimatedDuration: 300,
    difficulty: "beginner",
  },
  "content_creation": {
    category: "content",
    estimatedDuration: 240,
    difficulty: "beginner",
  },
  "performance_optimization": {
    category: "optimization",
    estimatedDuration: 300,
    difficulty: "advanced",
  },
};

/**
 * 提取任务关键词
 */
function extractKeywords(task: string): string[] {
  const keywords: string[] = [];
  const normalizedTask = task.toLowerCase();
  
  for (const keyword of Object.keys(KEYWORD_WORKFLOW_MAP)) {
    if (normalizedTask.includes(keyword.toLowerCase())) {
      keywords.push(keyword);
    }
  }
  
  return keywords;
}

/**
 * 根据技术栈推荐工作流
 */
function recommendByTechStack(techStack: TechStackInfo): string[] {
  const recommendations: string[] = [];
  
  // 如果有数据库，可能涉及数据迁移
  if (techStack.backend?.database) {
    recommendations.push("data_migration");
  }
  
  // 如果有测试框架，可能需要测试生成
  if (techStack.testing) {
    recommendations.push("test_generation");
  }
  
  return recommendations;
}

/**
 * 计算置信度
 */
function calculateConfidence(
  workflowId: string,
  matchedKeywords: string[],
  difficulty?: string
): number {
  let confidence = 0.5; // 基础置信度
  
  // 每个匹配的关键词增加置信度
  confidence += matchedKeywords.length * 0.15;
  
  // 根据难度调整
  if (difficulty === "beginner") {
    confidence += 0.1; // 简单任务置信度更高
  } else if (difficulty === "advanced") {
    confidence -= 0.1; // 复杂任务降低置信度
  }
  
  return Math.min(1.0, Math.max(0.0, confidence));
}

/**
 * 生成推荐理由
 */
function generateReason(
  workflow: WorkflowDefinition,
  matchedKeywords: string[],
  confidence: number
): string {
  const reasons: string[] = [];
  
  if (matchedKeywords.length > 0) {
    reasons.push(`匹配关键词：${matchedKeywords.slice(0, 3).join(", ")}`);
  }
  
  reasons.push(`步骤数：${workflow.steps.length}`);
  
  if (confidence > 0.8) {
    reasons.push("高度匹配任务需求");
  } else if (confidence > 0.6) {
    reasons.push("适合处理此类任务");
  }
  
  return reasons.join("；");
}

/**
 * 推荐工作流
 */
export function recommendWorkflow(
  task: string,
  techStack?: TechStackInfo
): WorkflowRecommendation {
  const keywords = extractKeywords(task);
  const workflowScores: Map<string, { score: number; keywords: string[] }> = new Map();
  
  // 统计每个工作流的匹配分数
  for (const keyword of keywords) {
    const matchedWorkflows = KEYWORD_WORKFLOW_MAP[keyword] || [];
    for (const workflowId of matchedWorkflows) {
      const existing = workflowScores.get(workflowId) || { score: 0, keywords: [] };
      existing.score += 1;
      existing.keywords.push(keyword);
      workflowScores.set(workflowId, existing);
    }
  }
  
  // 考虑技术栈推荐
  if (techStack) {
    const techStackWorkflows = recommendByTechStack(techStack);
    for (const workflowId of techStackWorkflows) {
      const existing = workflowScores.get(workflowId) || { score: 0, keywords: [] };
      existing.score += 0.5;
      workflowScores.set(workflowId, existing);
    }
  }
  
  // 如果没有匹配，返回通用推荐
  if (workflowScores.size === 0) {
    const defaultWorkflow = BUILTIN_WORKFLOWS[0];
    return {
      workflowId: defaultWorkflow.name,
      workflowName: defaultWorkflow.name,
      category: WORKFLOW_CATEGORY_MAP[defaultWorkflow.name] || "development",
      confidence: 0.5,
      reason: "未检测到特定领域关键词，推荐通用工作流",
      alternativeWorkflows: BUILTIN_WORKFLOWS.slice(1, 4).map(w => w.name),
      matchedKeywords: [],
      estimatedDuration: 180,
    };
  }
  
  // 按分数排序
  const sortedWorkflows = Array.from(workflowScores.entries())
    .sort((a, b) => b[1].score - a[1].score);
  
  // 获取最佳匹配
  const [bestWorkflowId, bestMatch] = sortedWorkflows[0];
  const bestWorkflow = BUILTIN_WORKFLOWS.find(w => w.name === bestWorkflowId);
  
  if (!bestWorkflow) {
    throw new Error(`Workflow not found: ${bestWorkflowId}`);
  }
  
  const metadata = WORKFLOW_METADATA[bestWorkflowId];
  const confidence = calculateConfidence(
    bestWorkflowId,
    bestMatch.keywords,
    metadata?.difficulty
  );
  
  // 收集备选工作流
  const alternativeWorkflows = sortedWorkflows
    .slice(1, 4)
    .map(([id]) => {
      const workflow = BUILTIN_WORKFLOWS.find(w => w.name === id);
      return workflow?.name || id;
    });
  
  return {
    workflowId: bestWorkflow.name,
    workflowName: bestWorkflow.name,
    category: metadata?.category || WORKFLOW_CATEGORY_MAP[bestWorkflowId] || "development",
    confidence,
    reason: generateReason(bestWorkflow, bestMatch.keywords, confidence),
    alternativeWorkflows,
    matchedKeywords: bestMatch.keywords,
    estimatedDuration: metadata?.estimatedDuration || 180,
  };
}

/**
 * 获取工作流元数据
 */
export function getWorkflowMetadata(workflowName: string): WorkflowMetadata | undefined {
  const workflow = BUILTIN_WORKFLOWS.find(w => w.name === workflowName);
  if (!workflow) return undefined;
  
  const metadata = WORKFLOW_METADATA[workflowName];
  if (!metadata) return undefined;
  
  return {
    ...workflow,
    ...metadata,
  };
}

/**
 * 按分类筛选工作流
 */
export function filterWorkflowsByCategory(
  category: WorkflowCategory
): WorkflowMetadata[] {
  return BUILTIN_WORKFLOWS
    .map(workflow => {
      const metadata = WORKFLOW_METADATA[workflow.name];
      if (!metadata || metadata.category !== category) return null;
      
      return {
        ...workflow,
        ...metadata,
      } as WorkflowMetadata;
    })
    .filter((w): w is WorkflowMetadata => w !== null);
}

/**
 * 获取所有分类
 */
export function getCategories(): WorkflowCategory[] {
  return Array.from(new Set(Object.values(WORKFLOW_CATEGORY_MAP)));
}

/**
 * 获取所有可用工作流
 */
export function listAvailableWorkflows(): WorkflowMetadata[] {
  return BUILTIN_WORKFLOWS
    .map(workflow => {
      const metadata = WORKFLOW_METADATA[workflow.name];
      if (!metadata) return null;
      
      return {
        ...workflow,
        ...metadata,
      } as WorkflowMetadata;
    })
    .filter((w): w is WorkflowMetadata => w !== null);
}
