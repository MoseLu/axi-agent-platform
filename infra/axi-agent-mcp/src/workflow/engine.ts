/**
 * 工作流执行引擎
 */

import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowContext,
  WorkflowExecutionResult,
  StepResult,
} from "./types.js";
import { chat } from "../api-client.js";
import { logger } from "../logger.js";
import { costMonitor } from "../cost-monitor.js";

/**
 * 创建工作流上下文
 */
function createWorkflowContext(workflowId: string, stepCount: number): WorkflowContext {
  return {
    workflowId,
    variables: {},
    stepResults: {},
    currentStepIndex: 0,
    startTime: new Date(),
    status: "running",
  };
}

export interface WorkflowExecutorOptions {
  maxRetries?: number;
  timeout?: number;
  variables?: Record<string, any>;
  stopOnError?: boolean;
}

export class WorkflowExecutor {
  private workflow: WorkflowDefinition;
  private options: WorkflowExecutorOptions;
  private context!: WorkflowContext;
  private abortController?: AbortController;

  constructor(
    workflow: WorkflowDefinition,
    options: WorkflowExecutorOptions = {}
  ) {
    this.workflow = workflow;
    this.options = {
      maxRetries: 1,
      timeout: 300000, // 5 分钟
      stopOnError: true,
      ...options,
    };
  }

  /**
   * 执行工作流
   */
  async execute(initialInput?: any): Promise<WorkflowExecutionResult> {
    const workflowId = `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.context = createWorkflowContext(workflowId, this.workflow.steps.length);
    this.abortController = new AbortController();

    if (this.options.variables) {
      this.context.variables = { ...this.options.variables, input: initialInput };
    } else {
      this.context.variables = { input: initialInput };
    }

    const trace = logger.startTrace("workflow_execution", {
      workflow: this.workflow.name,
      workflowId,
    });

    try {
      // 执行每个步骤
      for (let i = 0; i < this.workflow.steps.length; i++) {
        const step = this.workflow.steps[i];
        this.context.currentStepIndex = i;

        logger.info("workflow_step_start", {
          workflowId,
          stepId: step.id,
          stepIndex: i,
        }, step.model);

        const result = await this.executeStep(step, i);

        this.context.stepResults[step.id] = result;

        if (!result.success) {
          logger.error("workflow_step_failed", result.error || "未知错误", {
            workflowId,
            stepId: step.id,
          }, step.model);

          // 处理失败
          if (this.options.stopOnError !== false) {
            if (this.workflow.fallbackOnError) {
              // 跳转到回退步骤
              const fallbackIndex = this.workflow.steps.findIndex(
                (s) => s.id === this.workflow.fallbackOnError
              );
              if (fallbackIndex >= 0) {
                logger.info("workflow_fallback", {
                  workflowId,
                  fromStep: step.id,
                  toStep: this.workflow.fallbackOnError,
                });
                i = fallbackIndex - 1; // -1 因为循环会 +1
                continue;
              }
            }
            throw new Error(`步骤 "${step.id}" 执行失败：${result.error}`);
          }
        } else {
          logger.info("workflow_step_completed", {
            workflowId,
            stepId: step.id,
            duration: result.duration,
          }, step.model);
        }
      }

      this.context.status = "completed";
      this.context.endTime = new Date();

      const result = this.buildExecutionResult();
      
      logger.endTrace(trace, "success");
      logger.info("workflow_completed", {
        workflowId,
        duration: result.totalDuration,
        stepCount: result.stepCount,
      });

      return result;
    } catch (error) {
      this.context.status = "failed";
      this.context.endTime = new Date();
      this.context.error = error instanceof Error ? error.message : String(error);

      logger.endTrace(trace, "error", this.context.error);
      logger.error("workflow_failed", this.context.error, { workflowId });

      return this.buildExecutionResult();
    }
  }

  /**
   * 执行单个工作流步骤
   */
  private async executeStep(
    step: WorkflowStep,
    index: number
  ): Promise<StepResult> {
    const startTime = Date.now();
    let lastError: string | undefined;

    // 重试逻辑
    for (let attempt = 0; attempt <= (step.retryCount || this.options.maxRetries || 0); attempt++) {
      try {
        // 准备输入
        const input = this.prepareStepInput(step, index);

        // 渲染 prompt 中的变量
        const prompt = step.prompt ? this.renderPrompt(step.prompt, input) : undefined;

        // 检查超时
        const timeout = step.timeout || this.options.timeout || 300000;
        if (Date.now() - startTime > timeout) {
          throw new Error(`步骤执行超时（>${timeout}ms）`);
        }

        // 调用模型
        const messages = [
          ...(step.systemPrompt ? [{ role: "system" as const, content: step.systemPrompt }] : []),
          { role: "user" as const, content: prompt || JSON.stringify(input, null, 2) },
        ];

        const defaultParams = { temperature: 0.5, max_tokens: 4096 };
        const result = await chat({
          model: step.model,
          messages,
          temperature: step.temperature ?? defaultParams.temperature,
          max_tokens: step.maxTokens ?? defaultParams.max_tokens,
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        if (!result.success) {
          const errorMsg = result.error ?? "API 调用失败";
          throw new Error(errorMsg);
        }

        // 执行 transform（如果有）
        let output = result.content || "";
        if (step.transform) {
          output = await this.executeTransform(step.transform, {
            input,
            previous: this.getPreviousStepResult(index),
            output: result.content || "",
            variables: this.context!.variables,
          });
        }

        // 记录成本
        const estimatedTokens = (step.maxTokens || 4096) / 4;
        costMonitor.recordUsage({
          model: step.model,
          tokens: estimatedTokens,
          taskType: "workflow",
        });

        return {
          stepId: step.id,
          model: step.model,
          input,
          output,
          duration,
          success: true,
          timestamp: new Date(),
          tokens: estimatedTokens,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        
        if (attempt < (step.retryCount || this.options.maxRetries || 0)) {
          logger.warn("workflow_step_retry", {
            stepId: step.id,
            attempt: attempt + 1,
            error: lastError,
          }, step.model);
          
          // 重试前等待
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    const endTime = Date.now();
    return {
      stepId: step.id,
      model: step.model,
      input: this.prepareStepInput(step, index),
      output: null,
      duration: endTime - startTime,
      success: false,
      error: lastError,
      timestamp: new Date(),
    };
  }

  /**
   * 准备步骤输入
   */
  private prepareStepInput(step: WorkflowStep, index: number): any {
    if (!step.inputFrom) {
      // 没有指定输入来源，使用初始输入
      return this.context!.variables.input || {};
    }

    if (step.inputFrom === "previous") {
      // 使用上一步的输出
      return this.getPreviousStepResult(index);
    }

    // 使用指定步骤的输出
    const stepResult = this.context!.stepResults[step.inputFrom];
    return stepResult?.output || {};
  }

  /**
   * 获取上一步的结果
   */
  private getPreviousStepResult(currentIndex: number): any {
    if (currentIndex === 0) {
      return {};
    }
    const previousStep = this.workflow.steps[currentIndex - 1];
    return this.context!.stepResults[previousStep.id]?.output || {};
  }

  /**
   * 渲染 prompt 中的变量
   */
  private renderPrompt(prompt: string, variables: any): string {
    return prompt.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const keys = key.split(".");
      let value: any = variables;
      
      for (const k of keys) {
        value = value?.[k];
      }
      
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * 执行 transform 代码
   */
  private async executeTransform(
    transformCode: string,
    context: {
      input: any;
      previous?: any;
      output: string;
      variables: Record<string, any>;
    }
  ): Promise<any> {
    try {
      // 创建沙箱环境
      const sandbox = {
        input: context.input,
        previous: context.previous,
        output: context.output,
        variables: context.variables,
        console: {
          log: (...args: any[]) => logger.debug("transform_log", { args }),
        },
      };

      // 执行 transform 代码
      // 注意：生产环境应该使用更安全的沙箱
      const wrappedCode = `
        "use strict";
        const { input, previous, output, variables } = sandbox;
        ${transformCode}
      `;

      const vm = await import("node:vm");
      const contextObj = vm.createContext(sandbox);
      const script = new vm.Script(wrappedCode);
      const result = script.runInContext(contextObj, { timeout: 5000 });

      return result !== undefined ? result : context.output;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("transform_failed", errorMsg, { code: transformCode });
      throw new Error(`Transform 执行失败：${errorMsg}`);
    }
  }

  /**
   * 构建执行结果
   */
  private buildExecutionResult(): WorkflowExecutionResult {
    const results: Record<string, any> = {};
    let totalCost = 0;

    for (const [stepId, stepResult] of Object.entries(this.context!.stepResults)) {
      results[stepId] = stepResult.output;
      if (stepResult.cost) {
        totalCost += stepResult.cost;
      }
    }

    const finalOutput =
      this.workflow.steps.length > 0
        ? results[this.workflow.steps[this.workflow.steps.length - 1].id]
        : null;

    return {
      workflowId: this.context!.workflowId,
      status: this.context!.status === "running" ? "failed" : this.context!.status,
      results,
      finalOutput,
      totalDuration: this.context!.endTime
        ? this.context!.endTime.getTime() - this.context!.startTime.getTime()
        : 0,
      totalCost,
      stepCount: this.workflow.steps.length,
      error: this.context!.error,
      context: this.context!,
    };
  }

  /**
   * 中止执行
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.context) {
      this.context.status = "cancelled";
      this.context.endTime = new Date();
    }
  }
}

/**
 * 创建工作流执行器
 */
export function createWorkflowExecutor(
  workflow: WorkflowDefinition,
  options?: WorkflowExecutorOptions
): WorkflowExecutor {
  return new WorkflowExecutor(workflow, options);
}
