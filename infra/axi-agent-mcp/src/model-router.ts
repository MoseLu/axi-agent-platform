/**
 * 任务类型识别与模型选择，与 .cursor/rules/multi-model-swarm.mdc 一致
 * 增强版：支持更多关键词、上下文感知、置信度评分
 */

export const SWARM_MODELS = [
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "qwen3-coder-next",
  "qwen3-coder-plus",
  "MiniMax-M2.5",
  "glm-5",
  "glm-4.7",
  "kimi-k2.5",
] as const;

export type SwarmModel = (typeof SWARM_MODELS)[number];

export type TaskType =
  | "code"
  | "reasoning"
  | "doc_zh"
  | "long_text"
  | "creative"
  | "math"
  | "data_analysis"
  | "general";

interface TaskRule {
  type: TaskType;
  keywords: string[];
  priorityKeywords?: string[]; // 高优先级关键词，匹配时置信度更高
  primary: SwarmModel;
  fallback: SwarmModel[];
  confidenceBoost?: number; // 匹配时的置信度提升
}

const RULES: TaskRule[] = [
  {
    type: "code",
    keywords: [
      "编写",
      "实现",
      "重构",
      "优化",
      "debug",
      "修复",
      "函数",
      "类",
      "组件",
      "API",
      "代码",
      "typescript",
      "vue",
      "react",
      "python",
      "go",
      "java",
      "javascript",
      "rust",
      "cpp",
      "编程",
      "开发",
      "测试",
      "单元测试",
      "接口",
      "模块",
      "服务",
      "后端",
      "前端",
      "全栈",
    ],
    priorityKeywords: ["实现", "编写", "开发", "编程"],
    primary: "qwen3-coder-next",
    fallback: ["qwen3-coder-plus", "qwen3.5-plus"],
    confidenceBoost: 0.15,
  },
  {
    type: "reasoning",
    keywords: [
      "架构",
      "设计",
      "分析",
      "方案",
      "决策",
      "评估",
      "优化策略",
      "推理",
      "规划",
      "策略",
      "系统性",
      "方法论",
      "最佳实践",
      "技术选型",
      "权衡",
      "对比",
      "优缺点",
    ],
    priorityKeywords: ["架构", "分析", "决策"], // 移除"设计"，避免与 creative 冲突
    primary: "qwen3-max-2026-01-23",
    fallback: ["glm-5", "kimi-k2.5"],
    confidenceBoost: 0.15,
  },
  {
    type: "doc_zh",
    keywords: [
      "文档",
      "说明",
      "注释",
      "README",
      "文档编写",
      "本地化",
      "中文",
      "翻译",
      "解释",
      "教程",
      "指南",
      "手册",
      "api 文档",
      "技术文档",
    ],
    priorityKeywords: ["文档", "说明", "翻译"],
    primary: "glm-5",
    fallback: ["glm-4.7", "kimi-k2.5"],
    confidenceBoost: 0.1,
  },
  {
    type: "long_text",
    keywords: [
      "审查",
      "分析报告",
      "总结",
      "长代码",
      "批量处理",
      "阅读",
      "理解",
      "提取",
      "摘要",
      "概括",
      "全文",
      "长篇",
      "pdf",
      "文件",
      "文章",
    ],
    priorityKeywords: ["审查", "分析", "总结", "摘要"],
    primary: "kimi-k2.5",
    fallback: ["qwen3-max-2026-01-23"],
    confidenceBoost: 0.1,
  },
  {
    type: "creative",
    keywords: [
      "UI 设计",
      "创意",
      "方案设计",
      "用户体验",
      "界面",
      "设计",
      "视觉",
      "配色",
      "布局",
      "交互",
      "原型",
      "wireframe",
      "mockup",
      "美学",
      "艺术",
      "风格",
    ],
    priorityKeywords: ["UI 设计", "创意", "设计", "界面"],
    primary: "MiniMax-M2.5",
    fallback: ["glm-5"],
    confidenceBoost: 0.15,
  },
  {
    type: "math",
    keywords: [
      "数学",
      "计算",
      "公式",
      "方程",
      "积分",
      "导数",
      "代数",
      "几何",
      "概率",
      "统计",
      "微积分",
      "线性代数",
      "数值",
      "运算",
    ],
    priorityKeywords: ["数学", "计算", "公式", "方程"],
    primary: "qwen3-max-2026-01-23",
    fallback: ["qwen3-coder-next", "qwen3.5-plus"],
    confidenceBoost: 0.2,
  },
  {
    type: "data_analysis",
    keywords: [
      "数据",
      "图表",
      "可视化",
      "报表",
      "dashboard",
      "分析",
      "统计",
      "趋势",
      "对比",
      "挖掘",
      "清洗",
      "处理",
      "excel",
      "csv",
      "json",
    ],
    priorityKeywords: ["数据", "图表", "可视化", "分析"],
    primary: "qwen3-coder-next",
    fallback: ["qwen3-max-2026-01-23", "qwen3.5-plus"],
    confidenceBoost: 0.1,
  },
  {
    type: "general",
    keywords: ["默认", "一般", "简单", "聊天", "问答"],
    primary: "qwen3.5-plus",
    fallback: ["glm-4.7"],
    confidenceBoost: 0,
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

export interface ModelSelectionResult {
  taskType: TaskType;
  model: SwarmModel;
  fallback: SwarmModel[];
  matchedKeywords: string[];
  confidence: number;
  reasoning: string;
}

// 任务类型优先级（当置信度相同时，优先级高的胜出）
const TASK_TYPE_PRIORITY: Record<TaskType, number> = {
  code: 7,
  reasoning: 5,
  doc_zh: 6,
  long_text: 6,
  creative: 8, // 创意任务优先级高
  math: 7,
  data_analysis: 6,
  general: 1,
};

/**
 * 根据用户输入识别任务类型并返回首选模型与备选列表
 * 增强版：支持置信度评分和推理说明
 */
export function selectModel(userInput: string): ModelSelectionResult {
  const normalized = normalize(userInput);
  const generalRule = RULES.find((r) => r.type === "general")!;

  const matches = RULES.filter((r) => r.type !== "general").map((rule) => {
    const matched = rule.keywords.filter((kw) =>
      normalized.includes(normalize(kw))
    );
    
    if (matched.length === 0) return null;

    // 计算置信度
    let confidence = 0.5 + Math.min(matched.length * 0.1, 0.3); // 基础置信度 + 匹配词数量加成
    
    // 优先关键词加成
    if (rule.priorityKeywords) {
      const priorityMatched = rule.priorityKeywords.filter((kw) =>
        normalized.includes(normalize(kw))
      );
      if (priorityMatched.length > 0) {
        confidence += rule.confidenceBoost ?? 0.15; // 提高优先关键词的权重
      }
    }

    // 如果匹配了 priorityKeywords，额外增加权重
    if (rule.priorityKeywords && rule.priorityKeywords.some(kw => normalized.includes(normalize(kw)))) {
      confidence += 0.1;
    }

    return {
      rule,
      matched,
      confidence: Math.min(confidence, 0.99),
      priority: TASK_TYPE_PRIORITY[rule.type],
    };
  }).filter(Boolean) as Array<{ rule: TaskRule; matched: string[]; confidence: number; priority: number }>;

  if (matches.length > 0) {
    // 先按置信度排序，置信度相同时按任务类型优先级排序
    matches.sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) > 0.01) {
        return b.confidence - a.confidence;
      }
      return b.priority - a.priority;
    });
    const best = matches[0];

    return {
      taskType: best.rule.type,
      model: best.rule.primary,
      fallback: best.rule.fallback,
      matchedKeywords: best.matched,
      confidence: best.confidence,
      reasoning: `匹配到${best.matched.length}个关键词，置信度${(best.confidence * 100).toFixed(0)}%`,
    };
  }

  return {
    taskType: generalRule.type,
    model: generalRule.primary,
    fallback: generalRule.fallback,
    matchedKeywords: [],
    confidence: 0.5,
    reasoning: "未匹配到特定任务类型，使用通用模型",
  };
}

/**
 * 降级链：当 primary 不可用时按顺序尝试
 */
const FALLBACK_CHAINS: Record<SwarmModel, SwarmModel[]> = {
  "qwen3-coder-next": ["qwen3-coder-plus", "qwen3.5-plus"],
  "qwen3-coder-plus": ["qwen3.5-plus"],
  "qwen3-max-2026-01-23": ["glm-5", "kimi-k2.5"],
  "qwen3.5-plus": ["glm-4.7"],
  "glm-5": ["glm-4.7", "qwen3.5-plus"],
  "glm-4.7": ["qwen3.5-plus"],
  "kimi-k2.5": ["qwen3-max-2026-01-23"],
  "MiniMax-M2.5": ["glm-5", "qwen3.5-plus"],
};

export function getFallbackChain(model: SwarmModel): SwarmModel[] {
  return FALLBACK_CHAINS[model] ?? [];
}

export function isSwarmModel(s: string): s is SwarmModel {
  return SWARM_MODELS.includes(s as SwarmModel);
}

/**
 * 获取模型参数建议
 */
export function getModelParams(model: SwarmModel, taskType?: TaskType): {
  temperature: number;
  max_tokens: number;
} {
  const baseParams: Record<SwarmModel, { temperature: number; max_tokens: number }> = {
    "qwen3-coder-next": { temperature: 0.3, max_tokens: 8192 },
    "qwen3-coder-plus": { temperature: 0.3, max_tokens: 8192 },
    "qwen3-max-2026-01-23": { temperature: 0.3, max_tokens: 8192 },
    "qwen3.5-plus": { temperature: 0.5, max_tokens: 4096 },
    "glm-5": { temperature: 0.5, max_tokens: 8192 },
    "glm-4.7": { temperature: 0.5, max_tokens: 4096 },
    "kimi-k2.5": { temperature: 0.3, max_tokens: 8192 },
    "MiniMax-M2.5": { temperature: 0.8, max_tokens: 4096 },
  };

  const params = baseParams[model];

  // 根据任务类型微调
  if (taskType === "creative") {
    return { ...params, temperature: Math.max(params.temperature, 0.8) };
  }
  if (taskType === "math" || taskType === "reasoning") {
    return { ...params, temperature: Math.min(params.temperature, 0.3) };
  }

  return params;
}
