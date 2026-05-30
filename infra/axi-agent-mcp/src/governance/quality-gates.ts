/**
 * 质量门控实现
 */

import { QualityGate, GateResult, GateType } from "./types.js";

/**
 * 1. 代码质量检查门控
 */
export const codeQualityGate: QualityGate = {
  id: "code_quality",
  type: "quality_check",
  name: "代码质量检查",
  description: "检查代码复杂度、重复率、可维护性",
  thresholds: {
    minQualityScore: 0.7,
    maxComplexity: 10,
    minTestCoverage: 0.8,
  },
  blocked: true,
  execute: async (result: any, context?: any): Promise<GateResult> => {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;
    
    // 检查代码质量指标
    if (result.code) {
      const complexity = calculateComplexity(result.code);
      const duplication = calculateDuplication(result.code);
      const maintainability = calculateMaintainability(result.code);
      
      if (complexity > 10) {
        issues.push(`代码复杂度过高：${complexity}（建议 < 10）`);
        score -= 20;
        suggestions.push("考虑将复杂函数拆分为多个小函数");
      }
      
      if (duplication > 0.1) {
        issues.push(`代码重复率过高：${(duplication * 100).toFixed(1)}%（建议 < 10%）`);
        score -= 15;
        suggestions.push("提取重复代码为公共函数或模块");
      }
      
      if (maintainability < 0.7) {
        issues.push(`可维护性指数低：${(maintainability * 100).toFixed(1)}（建议 > 70%）`);
        score -= 15;
        suggestions.push("改进代码结构，增加注释，统一命名规范");
      }
    }
    
    // 检查测试覆盖率
    if (result.coverage !== undefined && result.coverage < 0.8) {
      issues.push(`测试覆盖率不足：${(result.coverage * 100).toFixed(1)}%（建议 > 80%）`);
      score -= 20;
      suggestions.push("增加单元测试覆盖边界条件");
    }
    
    return {
      passed: score >= 70,
      score: Math.max(0, score),
      issues,
      suggestions,
      blocked: score < 60, // 低于 60 分阻断
      metadata: {
        complexity: calculateComplexity(result.code || ""),
        duplication: calculateDuplication(result.code || ""),
        maintainability: calculateMaintainability(result.code || ""),
      },
    };
  },
};

/**
 * 2. 安全检查门控
 */
export const securityReviewGate: QualityGate = {
  id: "security_review",
  type: "security_check",
  name: "安全审查",
  description: "检测安全漏洞和风险",
  thresholds: {
    maxCriticalIssues: 0,
    maxHighIssues: 2,
  },
  blocked: true,
  execute: async (result: any, context?: any): Promise<GateResult> => {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;
    let criticalCount = 0;
    let highCount = 0;
    
    // 检查安全漏洞
    if (result.code) {
      const vulnerabilities = detectVulnerabilities(result.code);
      
      for (const vuln of vulnerabilities) {
        if (vuln.severity === "critical") {
          criticalCount++;
          issues.push(`[严重] ${vuln.description}`);
          score -= 30;
        } else if (vuln.severity === "high") {
          highCount++;
          issues.push(`[高危] ${vuln.description}`);
          score -= 15;
        } else if (vuln.severity === "medium") {
          issues.push(`[中等] ${vuln.description}`);
          score -= 5;
        }
        
        suggestions.push(vuln.recommendation);
      }
    }
    
    // 检查敏感信息
    if (result.code) {
      const sensitiveInfo = detectSensitiveInfo(result.code);
      if (sensitiveInfo.length > 0) {
        issues.push(`发现${sensitiveInfo.length}处敏感信息泄露风险`);
        score -= 20;
        suggestions.push("移除硬编码的密钥、密码等敏感信息，使用环境变量");
      }
    }
    
    return {
      passed: criticalCount === 0 && highCount <= 2 && score >= 60,
      score: Math.max(0, score),
      issues,
      suggestions,
      blocked: criticalCount > 0 || score < 50,
      metadata: {
        criticalIssues: criticalCount,
        highIssues: highCount,
        totalIssues: issues.length,
      },
    };
  },
};

/**
 * 3. 性能检查门控
 */
export const performanceReviewGate: QualityGate = {
  id: "performance_review",
  type: "performance_check",
  name: "性能审查",
  description: "检查性能瓶颈和优化空间",
  thresholds: {
    maxExecutionTime: 1000, // ms
    maxMemoryUsage: 100, // MB
    minOptimizationScore: 0.7,
  },
  blocked: false,
  execute: async (result: any, context?: any): Promise<GateResult> => {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 100;
    
    // 检查执行时间
    if (result.executionTime !== undefined) {
      if (result.executionTime > 1000) {
        issues.push(`执行时间过长：${result.executionTime}ms（建议 < 1000ms）`);
        score -= 20;
        suggestions.push("优化算法复杂度，减少不必要的计算");
      }
    }
    
    // 检查内存使用
    if (result.memoryUsage !== undefined) {
      if (result.memoryUsage > 100) {
        issues.push(`内存使用过高：${result.memoryUsage}MB（建议 < 100MB）`);
        score -= 15;
        suggestions.push("优化数据结构，及时释放不用的内存");
      }
    }
    
    // 检查性能瓶颈
    if (result.code) {
      const bottlenecks = detectPerformanceBottlenecks(result.code);
      
      for (const bottleneck of bottlenecks) {
        issues.push(`[性能瓶颈] ${bottleneck.description}`);
        score -= 10;
        suggestions.push(bottleneck.suggestion);
      }
    }
    
    return {
      passed: score >= 70,
      score: Math.max(0, score),
      issues,
      suggestions,
      blocked: score < 50,
      metadata: {
        executionTime: result.executionTime,
        memoryUsage: result.memoryUsage,
        bottlenecksCount: detectPerformanceBottlenecks(result.code || "").length,
      },
    };
  },
};

// 辅助函数（简化实现）

function calculateComplexity(code: string): number {
  // 简化实现：实际应该使用 cyclomatic complexity 算法
  const lines = code.split("\n").length;
  const branches = (code.match(/\b(if|else|switch|case|for|while)\b/g) || []).length;
  return Math.floor(lines / 10) + branches;
}

function calculateDuplication(code: string): number {
  // 简化实现：实际应该检测重复代码块
  return 0.05; // 假设 5% 重复率
}

function calculateMaintainability(code: string): number {
  // 简化实现：实际应该使用维护性指数算法
  const hasComments = (code.match(/\/\/|\/\*|\*\//g) || []).length > 0;
  const hasConsistentNaming = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(code.substring(0, 100));
  return (hasComments ? 0.3 : 0) + (hasConsistentNaming ? 0.3 : 0) + 0.4;
}

interface Vulnerability {
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  recommendation: string;
}

function detectVulnerabilities(code: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  
  // 检测 SQL 注入风险
  if (code.includes("execute(") || code.includes("query(")) {
    if (code.includes("+") && code.includes("'")) {
      vulnerabilities.push({
        severity: "critical",
        description: "可能存在 SQL 注入风险（字符串拼接 SQL）",
        recommendation: "使用参数化查询或 ORM",
      });
    }
  }
  
  // 检测 XSS 风险
  if (code.includes("innerHTML") || code.includes("document.write")) {
    vulnerabilities.push({
      severity: "high",
      description: "可能存在 XSS 风险（直接操作 DOM）",
      recommendation: "使用安全的 DOM 操作方法或转义用户输入",
    });
  }
  
  return vulnerabilities;
}

function detectSensitiveInfo(code: string): string[] {
  const sensitivePatterns = [
    /password\s*[:=]\s*['"][^'"]+['"]/gi,
    /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi,
    /secret\s*[:=]\s*['"][^'"]+['"]/gi,
    /token\s*[:=]\s*['"][^'"]+['"]/gi,
  ];
  
  const findings: string[] = [];
  for (const pattern of sensitivePatterns) {
    const matches = code.match(pattern);
    if (matches) {
      findings.push(...matches);
    }
  }
  
  return findings;
}

interface PerformanceBottleneck {
  description: string;
  suggestion: string;
}

function detectPerformanceBottlenecks(code: string): PerformanceBottleneck[] {
  const bottlenecks: PerformanceBottleneck[] = [];
  
  // 检测嵌套循环
  const nestedLoops = (code.match(/for\s*\([^)]+\)\s*\{[^}]*for\s*\([^)]+\)/g) || []).length;
  if (nestedLoops > 0) {
    bottlenecks.push({
      description: `发现${nestedLoops}处嵌套循环，可能导致 O(n²) 复杂度`,
      suggestion: "考虑使用哈希表优化或减少嵌套层级",
    });
  }
  
  // 检测大数组操作
  if (code.includes(".map(") && code.includes(".filter(") && code.includes(".reduce(")) {
    bottlenecks.push({
      description: "链式数组操作可能导致多次遍历",
      suggestion: "考虑合并操作或使用单次遍历",
    });
  }
  
  return bottlenecks;
}

/**
 * 所有质量门控
 */
export const QUALITY_GATES: QualityGate[] = [
  codeQualityGate,
  securityReviewGate,
  performanceReviewGate,
];

/**
 * 按类型筛选门控
 */
export function getGatesByType(type: GateType): QualityGate[] {
  return QUALITY_GATES.filter(gate => gate.type === type);
}

/**
 * 获取门控 by ID
 */
export function getGateById(id: string): QualityGate | undefined {
  return QUALITY_GATES.find(gate => gate.id === id);
}
