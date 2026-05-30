/**
 * 工作流 DSL 类型定义
 */

export interface WorkflowStep {
  id: string;
  model: string;
  prompt?: string;
  systemPrompt?: string;
  inputFrom?: string | "previous"; // 从前一步或指定步骤获取输入
  transform?: string; // TypeScript 代码片段，用于转换数据
  outputSchema?: Record<string, string>; // 期望的输出格式
  temperature?: number;
  maxTokens?: number;
  retryCount?: number;
  timeout?: number;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version?: string;
  steps: WorkflowStep[];
  fallbackOnError?: string; // 失败时回退到的步骤 ID
  outputFormat?: "text" | "json" | "markdown";
  tags?: string[];
}

export interface WorkflowContext {
  workflowId: string;
  variables: Record<string, any>;
  stepResults: Record<string, StepResult>;
  currentStepIndex: number;
  startTime: Date;
  endTime?: Date;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
}

export interface StepResult {
  stepId: string;
  model: string;
  input: any;
  output: any;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: Date;
  tokens?: number;
  cost?: number;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  status: "completed" | "failed" | "cancelled";
  results: Record<string, any>; // 每个步骤的输出
  finalOutput: any;
  totalDuration: number;
  totalCost?: number;
  stepCount: number;
  error?: string;
  context: WorkflowContext;
}

export interface WorkflowValidationError {
  stepId: string;
  field: string;
  message: string;
}

/**
 * 预定义的工作流模板
 */
export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    name: "code_review",
    description: "代码审查工作流：分析代码 → 提出问题 → 给出建议",
    version: "1.0.0",
    tags: ["code", "review"],
    steps: [
      {
        id: "analyze",
        model: "kimi-k2.5",
        prompt: "请分析以下代码的结构、功能和潜在问题：{{code}}",
        outputSchema: { summary: "string", issues: "array" },
      },
      {
        id: "questions",
        model: "qwen3-max-2026-01-23",
        inputFrom: "previous",
        prompt: "基于代码分析结果，提出 3-5 个关键问题：{{previous.output}}",
      },
      {
        id: "suggestions",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "针对代码问题和疑问，给出具体的改进建议和代码示例：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  {
    name: "data_analysis",
    description: "数据分析工作流：数据理解 → 统计分析 → 可视化建议",
    version: "1.0.0",
    tags: ["data", "analysis"],
    steps: [
      {
        id: "understand",
        model: "kimi-k2.5",
        prompt: "分析以下数据集的结构和特征：{{data}}",
      },
      {
        id: "analyze",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "基于数据理解，进行统计分析并生成 Python 分析代码：{{previous.output}}",
      },
      {
        id: "visualize",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "根据分析结果，生成数据可视化代码和图表说明：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  {
    name: "content_creation",
    description: "内容创作工作流：大纲 → 草稿 → 润色",
    version: "1.0.0",
    tags: ["content", "writing"],
    steps: [
      {
        id: "outline",
        model: "qwen3-max-2026-01-23",
        prompt: "为以下主题创建详细大纲：{{topic}}",
      },
      {
        id: "draft",
        model: "glm-5",
        inputFrom: "previous",
        prompt: "根据大纲撰写完整内容：{{previous.output}}",
      },
      {
        id: "polish",
        model: "MiniMax-M2.5",
        inputFrom: "previous",
        prompt: "润色以下内容，提升可读性和吸引力：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  {
    name: "bug_fix",
    description: "Bug 修复工作流：问题诊断 → 定位原因 → 修复方案",
    version: "1.0.0",
    tags: ["debug", "code"],
    steps: [
      {
        id: "diagnose",
        model: "qwen3-max-2026-01-23",
        prompt: "分析以下错误信息和现象，诊断可能的问题：{{error}}",
      },
      {
        id: "locate",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "基于诊断结果，定位问题代码并解释原因：{{previous.output}}\n\n相关代码：{{code}}",
      },
      {
        id: "fix",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "提供具体的修复方案和修改后的代码：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  // 新增 6 个生产级工作流
  {
    name: "security_audit",
    description: "安全审计：漏洞扫描 → 权限检查 → 加密审查 → 依赖分析 → 修复建议",
    version: "1.0.0",
    tags: ["security", "audit"],
    steps: [
      {
        id: "vulnerability_scan",
        model: "security_engineer",
        prompt: "扫描以下代码的安全漏洞（SQL 注入、XSS、CSRF 等）：{{code}}",
        outputSchema: { vulnerabilities: "array", severity: "string" },
      },
      {
        id: "permission_check",
        model: "security_engineer",
        inputFrom: "previous",
        prompt: "检查权限控制和认证授权逻辑：{{previous.output}}",
      },
      {
        id: "encryption_review",
        model: "security_engineer",
        inputFrom: "previous",
        prompt: "审查数据加密和敏感信息处理：{{previous.output}}",
      },
      {
        id: "dependency_analysis",
        model: "security_engineer",
        prompt: "分析项目依赖的安全性和已知漏洞",
      },
      {
        id: "remediation",
        model: "security_engineer",
        inputFrom: "previous",
        prompt: "提供详细的安全修复建议和代码示例：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  {
    name: "performance_optimization",
    description: "性能优化：瓶颈分析 → 优化方案 → 代码重构 → 验证测试",
    version: "1.0.0",
    tags: ["performance", "optimization"],
    steps: [
      {
        id: "bottleneck_analysis",
        model: "performance_specialist",
        prompt: "分析以下代码的性能瓶颈（时间复杂度、空间复杂度、I/O 等）：{{code}}",
        outputSchema: { bottlenecks: "array", impact: "string" },
      },
      {
        id: "optimization_plan",
        model: "performance_specialist",
        inputFrom: "previous",
        prompt: "基于瓶颈分析，制定性能优化方案：{{previous.output}}",
      },
      {
        id: "code_refactoring",
        model: "qwen3-coder-next",
        inputFrom: "previous",
        prompt: "根据优化方案重构代码：{{previous.output}}",
      },
      {
        id: "verification",
        model: "performance_specialist",
        inputFrom: "previous",
        prompt: "设计性能验证测试和基准对比：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  {
    name: "api_design",
    description: "API 设计：需求分析 → 接口定义 → 文档生成 → 示例代码",
    version: "1.0.0",
    tags: ["api", "design"],
    steps: [
      {
        id: "requirement_analysis",
        model: "architect",
        prompt: "分析以下 API 需求和业务场景：{{requirements}}",
        outputSchema: { endpoints: "array", operations: "array" },
      },
      {
        id: "interface_definition",
        model: "backend_dev",
        inputFrom: "previous",
        prompt: "设计 RESTful API 接口定义（路径、方法、参数、响应）：{{previous.output}}",
      },
      {
        id: "documentation",
        model: "documentation_writer",
        inputFrom: "previous",
        prompt: "生成完整的 API 文档（包含请求示例和响应示例）：{{previous.output}}",
      },
      {
        id: "example_code",
        model: "backend_dev",
        inputFrom: "previous",
        prompt: "生成 API 实现的示例代码：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  {
    name: "data_migration",
    description: "数据迁移：Schema 分析 → 迁移脚本 → 数据验证 → 回滚方案",
    version: "1.0.0",
    tags: ["database", "migration"],
    steps: [
      {
        id: "schema_analysis",
        model: "db_engineer",
        prompt: "分析当前数据库 Schema 和目标 Schema 的差异：{{current_schema}}\n\n目标：{{target_schema}}",
        outputSchema: { changes: "array", risks: "array" },
      },
      {
        id: "migration_script",
        model: "db_engineer",
        inputFrom: "previous",
        prompt: "编写数据迁移 SQL 脚本：{{previous.output}}",
      },
      {
        id: "validation",
        model: "db_engineer",
        inputFrom: "previous",
        prompt: "设计数据验证方案和完整性检查：{{previous.output}}",
      },
      {
        id: "rollback_plan",
        model: "db_engineer",
        inputFrom: "previous",
        prompt: "制定回滚方案和应急措施：{{previous.output}}",
      },
      {
        id: "execution_guide",
        model: "db_engineer",
        inputFrom: "previous",
        prompt: "编写迁移执行指南和注意事项：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  {
    name: "test_generation",
    description: "测试生成：代码分析 → 测试用例 → 单元测试 → 覆盖率检查",
    version: "1.0.0",
    tags: ["testing", "qa"],
    steps: [
      {
        id: "code_analysis",
        model: "qa_engineer",
        prompt: "分析以下代码的功能和边界条件：{{code}}",
        outputSchema: { functions: "array", edgeCases: "array" },
      },
      {
        id: "test_cases",
        model: "qa_engineer",
        inputFrom: "previous",
        prompt: "设计详细的测试用例（正常场景、边界场景、异常场景）：{{previous.output}}",
      },
      {
        id: "unit_tests",
        model: "qa_engineer",
        inputFrom: "previous",
        prompt: "编写单元测试代码（使用 Jest/Vitest）：{{previous.output}}",
      },
      {
        id: "coverage_check",
        model: "qa_engineer",
        inputFrom: "previous",
        prompt: "分析测试覆盖率并提出改进建议：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
  
  {
    name: "documentation",
    description: "文档生成：代码解析 → API 提取 → 示例编写 → 文档格式化",
    version: "1.0.0",
    tags: ["documentation", "writing"],
    steps: [
      {
        id: "code_parsing",
        model: "code_reviewer",
        prompt: "解析以下代码的结构和功能：{{code}}",
        outputSchema: { modules: "array", functions: "array", classes: "array" },
      },
      {
        id: "api_extraction",
        model: "documentation_writer",
        inputFrom: "previous",
        prompt: "提取公共 API 和接口定义：{{previous.output}}",
      },
      {
        id: "example_writing",
        model: "documentation_writer",
        inputFrom: "previous",
        prompt: "编写使用示例和最佳实践：{{previous.output}}",
      },
      {
        id: "formatting",
        model: "documentation_writer",
        inputFrom: "previous",
        prompt: "整理文档结构并格式化输出：{{previous.output}}",
      },
      {
        id: "review",
        model: "documentation_writer",
        inputFrom: "previous",
        prompt: "审查文档的完整性和可读性：{{previous.output}}",
      },
    ],
    outputFormat: "markdown",
  },
];
