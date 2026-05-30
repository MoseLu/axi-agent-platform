/**
 * Agent 调度器
 * 根据任务类型和技术栈，智能分配专业 Agent
 */

import { createAgent, SpecialistAgent, AgentRole, listAgents } from "./specialists.js";
import { TechStackInfo } from "../tools/tech-stack-detector.js";
import { logger } from "../logger.js";

export interface TaskDefinition {
  id: string;
  description: string;
  type: "frontend" | "backend" | "database" | "devops" | "testing" | "general";
  priority: "high" | "medium" | "low";
  dependencies?: string[]; // 依赖的其他任务 ID
  estimatedDuration?: number; // 预估耗时（秒）
}

export interface AgentAssignment {
  taskId: string;
  agentRole: AgentRole;
  agent: SpecialistAgent;
  status: "pending" | "running" | "completed" | "failed";
  startTime?: Date;
  endTime?: Date;
  result?: any;
  error?: string;
}

export interface ScheduleResult {
  success: boolean;
  assignments: AgentAssignment[];
  totalDuration?: number;
  error?: string;
}

export class AgentScheduler {
  private techStack?: TechStackInfo;
  private agents: Map<AgentRole, SpecialistAgent> = new Map();
  private runningTasks: Map<string, AgentAssignment> = new Map();
  private completedTasks: Map<string, AgentAssignment> = new Map();
  private maxConcurrent = 3; // 最大并发数

  constructor(techStack?: TechStackInfo) {
    this.techStack = techStack;
    this.initializeAgents();
  }

  /**
   * 初始化 Agent 池
   */
  private initializeAgents() {
    const availableAgents = listAgents();
    
    // 根据技术栈预创建 Agent
    if (this.techStack?.frontend?.framework) {
      this.agents.set("frontend_dev", createAgent("frontend_dev"));
    }
    
    if (this.techStack?.backend?.framework) {
      this.agents.set("backend_dev", createAgent("backend_dev"));
    }
    
    if (this.techStack?.backend?.database) {
      this.agents.set("db_engineer", createAgent("db_engineer"));
    }
    
    if (this.techStack?.devops?.docker || this.techStack?.devops?.ci) {
      this.agents.set("devops_engineer", createAgent("devops_engineer"));
    }
    
    // 始终可用的通用 Agent
    this.agents.set("fullstack_dev", createAgent("fullstack_dev"));
    this.agents.set("qa_engineer", createAgent("qa_engineer"));
    this.agents.set("architect", createAgent("architect"));
    this.agents.set("git_specialist", createAgent("git_specialist"));
  }

  /**
   * 调度任务
   */
  async schedule(tasks: TaskDefinition[]): Promise<ScheduleResult> {
    const assignments: AgentAssignment[] = [];
    const startTime = Date.now();

    logger.info("scheduler_start", {
      taskCount: tasks.length,
      maxConcurrent: this.maxConcurrent,
    });

    try {
      // 1. 分析任务并分配 Agent
      for (const task of tasks) {
        const agentRole = this.selectAgentForTask(task);
        const assignment: AgentAssignment = {
          taskId: task.id,
          agentRole,
          agent: this.getAgent(agentRole),
          status: "pending",
        };
        assignments.push(assignment);
      }

      // 2. 按依赖关系排序
      const sortedAssignments = this.topologicalSort(assignments, tasks);

      // 3. 执行任务（考虑并发限制）
      await this.executeAssignments(sortedAssignments);

      const totalDuration = Date.now() - startTime;
      const success = assignments.every(a => a.status === "completed");

      logger.info("scheduler_complete", {
        success,
        totalDuration,
        completedCount: assignments.filter(a => a.status === "completed").length,
        failedCount: assignments.filter(a => a.status === "failed").length,
      });

      return {
        success,
        assignments,
        totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("scheduler_failed", errorMsg);

      return {
        success: false,
        assignments,
        error: errorMsg,
      };
    }
  }

  /**
   * 为任务选择合适的 Agent
   */
  private selectAgentForTask(task: TaskDefinition): AgentRole {
    // 根据任务类型选择
    switch (task.type) {
      case "frontend":
        return "frontend_dev";
      
      case "backend":
        return "backend_dev";
      
      case "database":
        return "db_engineer";
      
      case "devops":
        return "devops_engineer";
      
      case "testing":
        return "qa_engineer";
      
      case "general":
        // 根据优先级选择
        if (task.priority === "high") {
          return "architect"; // 高优先级任务由架构师处理
        }
        return "fullstack_dev";
      
      default:
        return "fullstack_dev";
    }
  }

  /**
   * 获取 Agent 实例
   */
  private getAgent(role: AgentRole): SpecialistAgent {
    let agent = this.agents.get(role);
    
    if (!agent) {
      // 如果指定角色的 Agent 不可用，降级使用全栈
      agent = this.agents.get("fullstack_dev")!;
    }
    
    return agent;
  }

  /**
   * 拓扑排序（处理依赖关系）
   */
  private topologicalSort(
    assignments: AgentAssignment[],
    tasks: TaskDefinition[]
  ): AgentAssignment[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const assignmentMap = new Map(assignments.map(a => [a.taskId, a]));
    const visited = new Set<string>();
    const result: AgentAssignment[] = [];

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (task?.dependencies) {
        for (const depId of task.dependencies) {
          visit(depId);
        }
      }

      const assignment = assignmentMap.get(taskId);
      if (assignment) {
        result.push(assignment);
      }
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  /**
   * 执行任务（带并发控制）
   */
  private async executeAssignments(assignments: AgentAssignment[]) {
    const pending = [...assignments];
    const running = new Set<AgentAssignment>();
    const results: Array<Promise<void>> = [];

    const runAssignment = async (assignment: AgentAssignment) => {
      assignment.status = "running";
      assignment.startTime = new Date();
      this.runningTasks.set(assignment.taskId, assignment);

      try {
        // 等待依赖任务完成
        const taskDef = assignments.find(a => a.taskId === assignment.taskId);
        if (taskDef) {
          const deps = this.getTaskDependencies(taskDef, assignments);
          await Promise.all(
            deps.map(dep => this.waitForTaskCompletion(dep.taskId))
          );
        }

        // 执行任务（这里简化处理，实际需要传递任务内容）
        // await assignment.agent.execute({...});
        
        assignment.status = "completed";
        assignment.endTime = new Date();
        this.completedTasks.set(assignment.taskId, assignment);
      } catch (error) {
        assignment.status = "failed";
        assignment.endTime = new Date();
        assignment.error = error instanceof Error ? error.message : String(error);
      } finally {
        running.delete(assignment);
        this.runningTasks.delete(assignment.taskId);
      }
    };

    while (pending.length > 0 || running.size > 0) {
      // 启动新任务（不超过最大并发数）
      while (pending.length > 0 && running.size < this.maxConcurrent) {
        const assignment = pending.shift()!;
        running.add(assignment);
        results.push(runAssignment(assignment));
      }

      // 等待至少一个任务完成
      if (results.length > 0) {
        await Promise.race(results);
        // 移除已完成的任务
        for (let i = results.length - 1; i >= 0; i--) {
          const result = results[i];
          const status = await Promise.race([
            result.then(() => "done"),
            Promise.resolve("pending").then(() => "pending")
          ]);
          if (status === "done") {
            results.splice(i, 1);
          }
        }
      } else if (running.size === 0) {
        break;
      }
    }

    await Promise.all(results);
  }

  /**
   * 获取任务的依赖
   */
  private getTaskDependencies(
    assignment: AgentAssignment,
    allAssignments: AgentAssignment[]
  ): AgentAssignment[] {
    const task = allAssignments.find(a => a.taskId === assignment.taskId);
    if (!task) return [];

    const deps: AgentAssignment[] = [];
    // 这里需要根据实际任务定义查找依赖
    return deps;
  }

  /**
   * 等待任务完成
   */
  private async waitForTaskCompletion(taskId: string): Promise<void> {
    const completed = this.completedTasks.get(taskId);
    if (completed) {
      if (completed.status === "failed") {
        throw new Error(`依赖任务 ${taskId} 失败：${completed.error}`);
      }
      return;
    }

    const running = this.runningTasks.get(taskId);
    if (running) {
      // 轮询等待
      while (!this.completedTasks.has(taskId) && !this.runningTasks.has(taskId)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.waitForTaskCompletion(taskId);
    }

    // 任务未开始，先启动
    // 这里简化处理
  }

  /**
   * 获取调度状态
   */
  getStatus() {
    return {
      running: Array.from(this.runningTasks.values()),
      completed: Array.from(this.completedTasks.values()),
      availableAgents: Array.from(this.agents.keys()),
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrent(max: number) {
    this.maxConcurrent = Math.max(1, max);
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const running = this.runningTasks.get(taskId);
    if (running) {
      // 这里需要实现取消逻辑
      return true;
    }
    return false;
  }
}

/**
 * 创建 Agent 调度器
 */
export function createAgentScheduler(techStack?: TechStackInfo): AgentScheduler {
  return new AgentScheduler(techStack);
}
