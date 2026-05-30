/**
 * Agent 推荐系统
 * 基于任务描述和技术栈智能推荐最合适的 Agent
 */

import { AgentRoleMetadata, AGENT_ROLES, getAgentById } from "./agent-roles.js";
import { TechStackInfo } from "../tools/tech-stack-detector.js";

export interface AgentRecommendation {
  agentId: string;
  agentName: string;
  confidence: number; // 0-1 置信度
  reason: string;
  alternativeAgents: string[];
  matchedKeywords: string[];
}

/**
 * 关键词到 Agent 的映射
 */
const KEYWORD_AGENT_MAP: Record<string, string[]> = {
  // 架构类
  "架构": ["architect"],
  "设计": ["architect", "ui_ux_designer"],
  "技术选型": ["architect"],
  "系统": ["architect", "backend_dev"],
  "微服务": ["architect", "backend_dev", "devops_engineer"],
  
  // 前端
  "前端": ["frontend_dev", "ui_ux_designer"],
  "React": ["frontend_dev"],
  "Vue": ["frontend_dev"],
  "Angular": ["frontend_dev"],
  "TypeScript": ["frontend_dev", "backend_dev", "fullstack_dev"],
  "CSS": ["frontend_dev", "ui_ux_designer"],
  "组件": ["frontend_dev"],
  "界面": ["frontend_dev", "ui_ux_designer"],
  
  // 后端
  "后端": ["backend_dev"],
  "API": ["backend_dev", "fullstack_dev"],
  "Node.js": ["backend_dev"],
  "Go": ["backend_dev"],
  "Python": ["backend_dev", "data_engineer", "ml_engineer"],
  "数据库": ["db_engineer", "backend_dev"],
  "SQL": ["db_engineer"],
  "MongoDB": ["db_engineer"],
  "Redis": ["db_engineer", "backend_dev"],
  
  // 移动端
  "移动": ["mobile_developer"],
  "iOS": ["mobile_developer"],
  "Android": ["mobile_developer"],
  "React Native": ["mobile_developer"],
  "Flutter": ["mobile_developer"],
  "小程序": ["mobile_developer"],
  
  // DevOps
  "DevOps": ["devops_engineer"],
  "Docker": ["devops_engineer"],
  "Kubernetes": ["devops_engineer"],
  "K8s": ["devops_engineer"],
  "CI/CD": ["devops_engineer"],
  "部署": ["devops_engineer"],
  "容器": ["devops_engineer"],
  "云": ["devops_engineer"],
  
  // 数据
  "数据": ["data_engineer", "db_engineer"],
  "ETL": ["data_engineer"],
  "大数据": ["data_engineer"],
  "Spark": ["data_engineer"],
  "Kafka": ["data_engineer"],
  "数据仓库": ["data_engineer"],
  "数据湖": ["data_engineer"],
  
  // 机器学习
  "机器学习": ["ml_engineer"],
  "深度学习": ["ml_engineer"],
  "AI": ["ml_engineer", "prompt_engineer"],
  "LLM": ["ml_engineer", "prompt_engineer"],
  "模型": ["ml_engineer"],
  "训练": ["ml_engineer"],
  "MLOps": ["ml_engineer"],
  
  // 测试
  "测试": ["qa_engineer"],
  "单元测试": ["qa_engineer"],
  "集成测试": ["qa_engineer"],
  "E2E": ["qa_engineer"],
  "Cypress": ["qa_engineer"],
  "Jest": ["qa_engineer"],
  "pytest": ["qa_engineer"],
  
  // 安全
  "安全": ["security_engineer"],
  "漏洞": ["security_engineer"],
  "渗透": ["security_engineer"],
  "认证": ["security_engineer"],
  "授权": ["security_engineer"],
  "加密": ["security_engineer"],
  "OWASP": ["security_engineer"],
  
  // 代码质量
  "代码审查": ["code_reviewer", "tech_lead"],
  "Review": ["code_reviewer"],
  "重构": ["code_reviewer", "tech_lead"],
  "优化": ["performance_specialist", "code_reviewer"],
  "质量": ["code_reviewer", "qa_engineer"],
  "规范": ["code_reviewer", "tech_lead"],
  
  // Git
  "Git": ["git_specialist"],
  "分支": ["git_specialist"],
  "合并": ["git_specialist"],
  "PR": ["git_specialist"],
  "MR": ["git_specialist"],
  "提交": ["git_specialist"],
  
  // UI/UX
  "UI": ["ui_ux_designer"],
  "UX": ["ui_ux_designer"],
  "交互": ["ui_ux_designer"],
  "原型": ["ui_ux_designer"],
  "配色": ["ui_ux_designer"],
  "主题": ["ui_ux_designer"],
  
  // 性能
  "性能": ["performance_specialist"],
  "瓶颈": ["performance_specialist"],
  "速度": ["performance_specialist"],
  "延迟": ["performance_specialist"],
  "并发": ["performance_specialist", "backend_dev"],
  
  // 无障碍
  "无障碍": ["accessibility_specialist"],
  "WCAG": ["accessibility_specialist"],
  "辅助": ["accessibility_specialist"],
  "残障": ["accessibility_specialist"],
  
  // 文档
  "文档": ["documentation_writer"],
  "README": ["documentation_writer"],
  "API 文档": ["documentation_writer"],
  "手册": ["documentation_writer"],
  "教程": ["documentation_writer"],
  "说明": ["documentation_writer"],
  
  // 提示词
  "提示词": ["prompt_engineer"],
  "Prompt": ["prompt_engineer"],
  "LLM 优化": ["prompt_engineer"],
  "Few-shot": ["prompt_engineer"],
  
  // 全栈
  "全栈": ["fullstack_dev"],
  "前后端": ["fullstack_dev"],
  "Monorepo": ["fullstack_dev"],
};

/**
 * 任务类型到 Agent 类别的映射
 */
const TASK_TYPE_AGENT_MAP: Record<string, string[]> = {
  "architecture": ["architect", "tech_lead"],
  "development": ["frontend_dev", "backend_dev", "fullstack_dev"],
  "mobile": ["mobile_developer"],
  "database": ["db_engineer"],
  "devops": ["devops_engineer"],
  "data": ["data_engineer"],
  "ml": ["ml_engineer"],
  "testing": ["qa_engineer"],
  "security": ["security_engineer"],
  "quality": ["code_reviewer"],
  "design": ["ui_ux_designer"],
  "performance": ["performance_specialist"],
  "accessibility": ["accessibility_specialist"],
  "documentation": ["documentation_writer"],
  "prompt": ["prompt_engineer"],
};

/**
 * 分析任务描述，提取关键词
 */
function extractKeywords(task: string): string[] {
  const keywords: string[] = [];
  const normalizedTask = task.toLowerCase();
  
  // 匹配中英文关键词
  for (const keyword of Object.keys(KEYWORD_AGENT_MAP)) {
    if (normalizedTask.includes(keyword.toLowerCase())) {
      keywords.push(keyword);
    }
  }
  
  return keywords;
}

/**
 * 根据技术栈推荐 Agent
 */
function recommendByTechStack(techStack: TechStackInfo): string[] {
  const recommendations: string[] = [];
  
  // 前端框架
  if (techStack.frontend?.framework) {
    recommendations.push("frontend_dev");
    if (techStack.frontend.uiLibrary) {
      recommendations.push("ui_ux_designer");
    }
  }
  
  // 后端框架
  if (techStack.backend?.framework) {
    recommendations.push("backend_dev");
  }
  
  // 数据库
  if (techStack.backend?.database) {
    recommendations.push("db_engineer");
  }
  
  // DevOps
  if (techStack.devops?.docker) {
    recommendations.push("devops_engineer");
  }
  
  // 测试
  if (techStack.testing) {
    recommendations.push("qa_engineer");
  }
  
  return Array.from(new Set(recommendations));
}

/**
 * 计算 Agent 匹配置信度
 */
function calculateConfidence(
  agentId: string,
  matchedKeywords: string[],
  taskType?: string
): number {
  let confidence = 0.5; // 基础置信度
  
  // 每个匹配的关键词增加置信度
  confidence += matchedKeywords.length * 0.1;
  
  // 如果 Agent 是任务类型的首选
  if (taskType && TASK_TYPE_AGENT_MAP[taskType]?.includes(agentId)) {
    confidence += 0.2;
  }
  
  // 限制在 0-1 范围内
  return Math.min(1.0, Math.max(0.0, confidence));
}

/**
 * 生成推荐理由
 */
function generateReason(
  agent: AgentRoleMetadata,
  matchedKeywords: string[],
  confidence: number
): string {
  const reasons: string[] = [];
  
  if (matchedKeywords.length > 0) {
    reasons.push(`匹配关键词：${matchedKeywords.slice(0, 3).join(", ")}`);
  }
  
  reasons.push(`专长领域：${agent.skills.slice(0, 3).join(", ")}`);
  
  if (confidence > 0.8) {
    reasons.push("高度匹配任务需求");
  } else if (confidence > 0.6) {
    reasons.push("适合处理此类任务");
  }
  
  return reasons.join("；");
}

/**
 * 推荐 Agent
 */
export function recommendAgent(
  task: string,
  techStack?: TechStackInfo
): AgentRecommendation {
  const keywords = extractKeywords(task);
  const agentScores: Map<string, { score: number; keywords: string[] }> = new Map();
  
  // 统计每个 Agent 的匹配分数
  for (const keyword of keywords) {
    const matchedAgents = KEYWORD_AGENT_MAP[keyword] || [];
    for (const agentId of matchedAgents) {
      const existing = agentScores.get(agentId) || { score: 0, keywords: [] };
      existing.score += 1;
      existing.keywords.push(keyword);
      agentScores.set(agentId, existing);
    }
  }
  
  // 考虑技术栈推荐
  if (techStack) {
    const techStackAgents = recommendByTechStack(techStack);
    for (const agentId of techStackAgents) {
      const existing = agentScores.get(agentId) || { score: 0, keywords: [] };
      existing.score += 0.5; // 技术栈推荐权重较低
      agentScores.set(agentId, existing);
    }
  }
  
  // 如果没有匹配，返回通用推荐
  if (agentScores.size === 0) {
    const defaultAgent = getAgentById("fullstack_dev");
    return {
      agentId: "fullstack_dev",
      agentName: defaultAgent?.name || "全栈开发工程师",
      confidence: 0.5,
      reason: "未检测到特定领域关键词，推荐全栈工程师处理通用任务",
      alternativeAgents: ["backend_dev", "frontend_dev"],
      matchedKeywords: [],
    };
  }
  
  // 按分数排序
  const sortedAgents = Array.from(agentScores.entries())
    .sort((a, b) => b[1].score - a[1].score);
  
  // 获取最佳匹配
  const [bestAgentId, bestMatch] = sortedAgents[0];
  const bestAgent = getAgentById(bestAgentId);
  
  if (!bestAgent) {
    throw new Error(`Agent not found: ${bestAgentId}`);
  }
  
  const confidence = calculateConfidence(bestAgentId, bestMatch.keywords);
  
  // 收集备选 Agent
  const alternativeAgents = sortedAgents
    .slice(1, 4)
    .map(([id]) => {
      const agent = getAgentById(id);
      return agent?.name || id;
    });
  
  return {
    agentId: bestAgent.id,
    agentName: bestAgent.name,
    confidence,
    reason: generateReason(bestAgent, bestMatch.keywords, confidence),
    alternativeAgents,
    matchedKeywords: bestMatch.keywords,
  };
}

/**
 * 批量推荐 Agent（用于多任务场景）
 */
export function batchRecommendAgents(
  tasks: Array<{ id: string; description: string }>,
  techStack?: TechStackInfo
): Array<{ taskId: string; recommendation: AgentRecommendation }> {
  return tasks.map((task) => ({
    taskId: task.id,
    recommendation: recommendAgent(task.description, techStack),
  }));
}

/**
 * 获取所有可用 Agent 列表
 */
export function listAvailableAgents(): AgentRoleMetadata[] {
  return AGENT_ROLES;
}

/**
 * 根据类别筛选 Agent
 */
export function getAgentsByCategory(
  category: AgentRoleMetadata["category"]
): AgentRoleMetadata[] {
  return AGENT_ROLES.filter((agent) => agent.category === category);
}
