/**
 * Agent 角色元数据
 * 用于 MCP 工具列表和 Agent 推荐系统
 */

export interface AgentRoleMetadata {
  id: string;
  name: string;
  description: string;
  category: "architecture" | "development" | "quality" | "specialized";
  preferredModel: string;
  skills: string[];
  useCases: string[];
}

export const AGENT_ROLES: AgentRoleMetadata[] = [
  // 架构类
  {
    id: "architect",
    name: "系统架构师",
    description: "负责系统架构设计、技术选型和性能优化",
    category: "architecture",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["系统架构", "技术选型", "性能优化", "可扩展性设计"],
    useCases: ["设计微服务架构", "技术栈选型", "系统性能规划"],
  },
  {
    id: "tech_lead",
    name: "技术总监",
    description: "负责代码审查、技术指导和项目管理",
    category: "architecture",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["代码审查", "技术指导", "项目管理", "团队协作"],
    useCases: ["代码审查", "技术方案评审", "团队技术指导"],
  },

  // 开发类
  {
    id: "frontend_dev",
    name: "前端开发工程师",
    description: "专注于前端开发和用户体验",
    category: "development",
    preferredModel: "qwen3-coder-next",
    skills: ["React", "Vue", "TypeScript", "CSS", "前端性能优化"],
    useCases: ["组件开发", "页面重构", "性能优化"],
  },
  {
    id: "backend_dev",
    name: "后端开发工程师",
    description: "专注于后端 API 和微服务开发",
    category: "development",
    preferredModel: "qwen3-coder-next",
    skills: ["Node.js", "Go", "Python", "API 设计", "微服务"],
    useCases: ["API 开发", "微服务设计", "数据库优化"],
  },
  {
    id: "fullstack_dev",
    name: "全栈开发工程师",
    description: "负责前后端协同开发和全链路优化",
    category: "development",
    preferredModel: "qwen3-coder-next",
    skills: ["全栈开发", "前后端联调", "Monorepo"],
    useCases: ["全功能开发", "前后端接口对接", "端到端测试"],
  },
  {
    id: "mobile_developer",
    name: "移动端开发工程师",
    description: "专注于 iOS、Android 和跨平台移动应用开发",
    category: "development",
    preferredModel: "qwen3-coder-next",
    skills: ["React Native", "Flutter", "iOS", "Android", "跨平台开发"],
    useCases: ["移动应用开发", "跨平台重构", "性能优化"],
  },
  {
    id: "db_engineer",
    name: "数据库工程师",
    description: "负责数据库设计、优化和数据管理",
    category: "development",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["数据库设计", "SQL 优化", "Migration", "ORM"],
    useCases: ["表结构设计", "SQL 调优", "数据迁移"],
  },
  {
    id: "devops_engineer",
    name: "DevOps 工程师",
    description: "负责 CI/CD、容器化和基础设施自动化",
    category: "development",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["Docker", "Kubernetes", "CI/CD", "云原生"],
    useCases: ["容器化部署", "CI/CD 流水线", "基础设施即代码"],
  },
  {
    id: "data_engineer",
    name: "数据工程师",
    description: "负责数据管道、ETL 和大数据处理",
    category: "development",
    preferredModel: "qwen3-coder-next",
    skills: ["ETL", "数据管道", "大数据处理", "数据仓库", "实时流处理"],
    useCases: ["数据管道构建", "ETL 流程设计", "实时数据处理"],
  },
  {
    id: "ml_engineer",
    name: "机器学习工程师",
    description: "负责机器学习模型训练、部署和 MLOps",
    category: "development",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["机器学习", "深度学习", "模型训练", "MLOps", "AI 应用"],
    useCases: ["模型训练调优", "AI 应用集成", "MLOps 部署"],
  },
  {
    id: "git_specialist",
    name: "Git 专家",
    description: "负责 Git 工作流、分支管理和代码审查流程",
    category: "development",
    preferredModel: "glm-5",
    skills: ["Git 操作", "分支管理", "代码提交规范", "MR/PR"],
    useCases: ["Git 工作流设计", "代码审查流程", "提交规范管理"],
  },

  // 质量类
  {
    id: "qa_engineer",
    name: "质量保证工程师",
    description: "负责测试策略、自动化测试和质量保障",
    category: "quality",
    preferredModel: "qwen3-coder-plus",
    skills: ["单元测试", "集成测试", "E2E 测试", "测试驱动开发"],
    useCases: ["单元测试编写", "测试用例设计", "测试自动化"],
  },
  {
    id: "security_engineer",
    name: "安全工程师",
    description: "负责安全审计、漏洞检测和安全评分",
    category: "quality",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["安全审计", "漏洞扫描", "渗透测试", "安全编码"],
    useCases: ["代码安全审计", "漏洞修复", "安全方案设计"],
  },
  {
    id: "code_reviewer",
    name: "代码审查专家",
    description: "负责代码质量分析、最佳实践检查和重构建议",
    category: "quality",
    preferredModel: "kimi-k2.5",
    skills: ["代码审查", "代码质量", "最佳实践", "重构建议"],
    useCases: ["代码质量评估", "重构方案设计", "编码规范检查"],
  },

  // 专家类
  {
    id: "ui_ux_designer",
    name: "UI/UX设计师",
    description: "负责用户界面设计、交互设计和用户体验优化",
    category: "specialized",
    preferredModel: "MiniMax-M2.5",
    skills: ["UI 设计", "配色方案", "交互设计", "用户体验优化", "原型设计"],
    useCases: ["界面设计", "用户体验优化", "设计系统建设"],
  },
  {
    id: "prompt_engineer",
    name: "提示词工程师",
    description: "负责 LLM 提示词设计、优化和效果调优",
    category: "specialized",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["提示词设计", "LLM 优化", "Few-shot Learning", "思维链"],
    useCases: ["提示词优化", "LLM 应用开发", "AI 行为调优"],
  },
  {
    id: "performance_specialist",
    name: "性能优化专家",
    description: "负责性能分析、瓶颈定位和优化策略",
    category: "specialized",
    preferredModel: "qwen3-max-2026-01-23",
    skills: ["性能分析", "瓶颈定位", "优化策略", "基准测试"],
    useCases: ["性能瓶颈分析", "优化方案设计", "性能基准测试"],
  },
  {
    id: "accessibility_specialist",
    name: "无障碍访问专家",
    description: "负责无障碍设计、WCAG 合规和辅助技术兼容性",
    category: "specialized",
    preferredModel: "glm-5",
    skills: ["无障碍设计", "WCAG 标准", "辅助技术", "包容性设计"],
    useCases: ["无障碍合规检查", "辅助技术适配", "包容性设计"],
  },
  {
    id: "documentation_writer",
    name: "技术文档专家",
    description: "负责技术文档撰写、API 文档和用户手册",
    category: "specialized",
    preferredModel: "glm-5",
    skills: ["技术文档", "API 文档", "用户手册", "教程编写"],
    useCases: ["API 文档编写", "用户指南撰写", "项目文档整理"],
  },
];

/**
 * 根据分类筛选 Agent
 */
export function filterAgentsByCategory(
  category: AgentRoleMetadata["category"]
): AgentRoleMetadata[] {
  return AGENT_ROLES.filter((agent) => agent.category === category);
}

/**
 * 根据技能搜索 Agent
 */
export function searchAgentsBySkill(skill: string): AgentRoleMetadata[] {
  const normalizedSkill = skill.toLowerCase();
  return AGENT_ROLES.filter((agent) =>
    agent.skills.some(
      (s) => s.toLowerCase().includes(normalizedSkill)
    )
  );
}

/**
 * 获取 Agent 详细信息
 */
export function getAgentById(id: string): AgentRoleMetadata | undefined {
  return AGENT_ROLES.find((agent) => agent.id === id);
}

/**
 * 获取所有分类
 */
export function getCategories(): AgentRoleMetadata["category"][] {
  return Array.from(
    new Set(AGENT_ROLES.map((agent) => agent.category))
  );
}
