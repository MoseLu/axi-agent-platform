/**
 * 工作流 DSL 解析器和验证器
 */

import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowContext,
  WorkflowValidationError,
  BUILTIN_WORKFLOWS,
} from "./types.js";

/**
 * 解析 YAML/JSON 格式的工作流定义
 */
export function parseWorkflowDefinition(
  content: string,
  format: "yaml" | "json" = "yaml"
): WorkflowDefinition {
  try {
    let parsed: any;

    if (format === "json") {
      parsed = JSON.parse(content);
    } else {
      // 简单 YAML 解析（实际项目中建议使用 js-yaml 库）
      parsed = parseSimpleYaml(content);
    }

    return validateWorkflowDefinition(parsed);
  } catch (e) {
    throw new Error(
      `解析工作流定义失败：${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * 简单 YAML 解析器（支持基本格式）
 * 注意：生产环境应使用 js-yaml 库
 */
function parseSimpleYaml(yaml: string): any {
  // 这里实现一个简单的 YAML 解析器
  // 实际使用时建议安装：pnpm add js-yaml
  
  const result: any = {};
  const lines = yaml.split("\n");
  const stack: Array<{ obj: any; indent: number }> = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const key = match[2].trim();
    const value = match[3].trim();

    // 弹出比当前 indent 大的栈帧
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (value === "") {
      // 这是一个嵌套对象或数组
      parent[key] = {};
      stack.push({ obj: parent[key], indent });
    } else if (value.startsWith("-")) {
      // 数组
      parent[key] = [value.substring(1).trim()];
    } else {
      // 普通值
      parent[key] = parseValue(value);
    }
  }

  return result;
}

/**
 * 解析 YAML 值
 */
function parseValue(value: string): any {
  // 去除引号
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // 布尔值
  if (value === "true") return true;
  if (value === "false") return false;

  // 数字
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);

  // 字符串
  return value;
}

/**
 * 验证工作流定义
 */
export function validateWorkflowDefinition(
  def: any
): WorkflowDefinition {
  const errors: WorkflowValidationError[] = [];

  // 必填字段检查
  if (!def.name) {
    errors.push({
      stepId: "root",
      field: "name",
      message: "工作流名称是必填的",
    });
  }

  if (!def.steps || !Array.isArray(def.steps)) {
    errors.push({
      stepId: "root",
      field: "steps",
      message: "工作流步骤是必填的且必须是数组",
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `工作流验证失败:\n${errors.map((e) => `  - [${e.stepId}] ${e.field}: ${e.message}`).join("\n")}`
    );
  }

  // 验证每个步骤
  const validatedSteps: WorkflowStep[] = [];
  const stepIds = new Set<string>();

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    const stepErrors = validateStep(step, i, stepIds);
    errors.push(...stepErrors);

    if (stepErrors.length === 0) {
      validatedSteps.push(step);
    }
  }

  // 验证 inputFrom 引用
  for (const step of validatedSteps) {
    if (step.inputFrom && step.inputFrom !== "previous") {
      const exists = validatedSteps.some((s) => s.id === step.inputFrom);
      if (!exists) {
        errors.push({
          stepId: step.id,
          field: "inputFrom",
          message: `引用的步骤 "${step.inputFrom}" 不存在`,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `工作流验证失败:\n${errors.map((e) => `  - [${e.stepId}] ${e.field}: ${e.message}`).join("\n")}`
    );
  }

  return {
    ...def,
    steps: validatedSteps,
  } as WorkflowDefinition;
}

/**
 * 验证单个工作流步骤
 */
function validateStep(
  step: any,
  index: number,
  stepIds: Set<string>
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const stepId = step.id || `step_${index}`;

  // 检查必填字段
  if (!step.id) {
    errors.push({
      stepId: `step_${index}`,
      field: "id",
      message: "步骤 ID 是必填的",
    });
  } else {
    if (stepIds.has(step.id)) {
      errors.push({
        stepId: step.id,
        field: "id",
        message: `步骤 ID "${step.id}" 重复`,
      });
    }
    stepIds.add(step.id);
  }

  if (!step.model) {
    errors.push({
      stepId,
      field: "model",
      message: "模型是必填的",
    });
  }

  // 检查 prompt 或 inputFrom
  if (!step.prompt && !step.inputFrom) {
    errors.push({
      stepId,
      field: "prompt/inputFrom",
      message: "必须指定 prompt 或 inputFrom",
    });
  }

  // 验证 transform 代码（简单检查）
  if (step.transform) {
    if (!step.transform.includes("return")) {
      errors.push({
        stepId,
        field: "transform",
        message: "transform 代码必须包含 return 语句",
      });
    }
  }

  // 验证数值参数
  if (step.temperature !== undefined) {
    if (typeof step.temperature !== "number" || step.temperature < 0 || step.temperature > 1) {
      errors.push({
        stepId,
        field: "temperature",
        message: "temperature 必须在 0-1 之间",
      });
    }
  }

  if (step.maxTokens !== undefined) {
    if (typeof step.maxTokens !== "number" || step.maxTokens < 1) {
      errors.push({
        stepId,
        field: "maxTokens",
        message: "maxTokens 必须是正整数",
      });
    }
  }

  return errors;
}

/**
 * 获取内置工作流模板
 */
export function getBuiltinWorkflow(name: string): WorkflowDefinition | undefined {
  return BUILTIN_WORKFLOWS.find((w) => w.name === name);
}

/**
 * 列出所有内置工作流
 */
export function listBuiltinWorkflows(): Array<{
  name: string;
  description?: string;
  tags?: string[];
}> {
  return BUILTIN_WORKFLOWS.map((w) => ({
    name: w.name,
    description: w.description,
    tags: w.tags,
  }));
}

/**
 * 创建工作流上下文
 */
export function createWorkflowContext(
  workflowId: string,
  stepCount: number
): WorkflowContext {
  return {
    workflowId,
    variables: {},
    stepResults: {},
    currentStepIndex: 0,
    startTime: new Date(),
    status: "running",
  };
}
