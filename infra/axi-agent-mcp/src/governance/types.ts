/**
 * 治理层类型定义
 */

export type GateType =
  | "quality_check"      // 质量检查
  | "security_check"     // 安全检查
  | "performance_check"  // 性能检查
  | "compliance_check";  // 合规检查

export interface QualityGate {
  id: string;
  type: GateType;
  name: string;
  description: string;
  thresholds: Record<string, number | string>;
  execute: (result: any, context?: any) => Promise<GateResult>;
  blocked?: boolean; // 是否阻断流程
}

export interface GateResult {
  passed: boolean;
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
  blocked: boolean; // 是否阻断
  metadata?: Record<string, any>;
}

export interface GateContext {
  workflowId?: string;
  stepId?: string;
  agentId?: string;
  projectRoot?: string;
}
