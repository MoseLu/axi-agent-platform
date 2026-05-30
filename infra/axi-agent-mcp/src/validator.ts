/**
 * 结果验证模块
 * 功能：
 * - 语法/格式校验（JSON Schema 验证）
 * - 多模型交叉验证
 * - 外部工具验证（代码执行、数学求值）
 * - 质量门控验证
 * - 置信度评分
 */

import { QualityGate, GateResult } from "./governance/types.js";

export interface ValidationResult {
  passed: boolean;
  confidence: number;
  details: string[];
  suggestions?: string[];
  gateResults?: GateResult[]; // 质量门控结果
}

export interface ValidationConfig {
  level: 1 | 2 | 3; // 1=基础验证，2=交叉验证，3=外部工具验证
  validators?: string[];
  gates?: QualityGate[]; // 质量门控
}

export interface EnhancedValidationResult extends ValidationResult {
  gateResults?: GateResult[];
}

/**
 * Level 1: 基础验证 - 语法/格式校验
 */
export function basicValidation(content: string, expectedFormat?: string): ValidationResult {
  const details: string[] = [];
  let passed = true;
  let confidence = 0.8;

  // 检查空响应
  if (!content || content.trim().length === 0) {
    return {
      passed: false,
      confidence: 0,
      details: ["响应内容为空"],
    };
  }

  // JSON 格式验证
  if (expectedFormat === "json" || content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      JSON.parse(content);
      details.push("JSON 格式验证通过");
    } catch (e) {
      passed = false;
      confidence = 0.3;
      details.push(`JSON 格式错误：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 代码格式验证（简单检查）
  if (expectedFormat === "code") {
    if (content.includes("function") || content.includes("const") || content.includes("import")) {
      details.push("代码结构检查通过");
    } else {
      confidence = 0.6;
      details.push("警告：未检测到典型代码结构");
    }
  }

  // 检查明显的错误标记
  if (content.includes("错误:") || content.includes("Error:") || content.includes("failed")) {
    confidence -= 0.2;
    details.push("警告：响应中包含错误标记");
  }

  return {
    passed,
    confidence: Math.max(confidence, 0),
    details,
  };
}

/**
 * Level 2: 交叉验证 - 比较多个模型的输出
 */
export async function crossValidation(
  responses: Array<{ model: string; content: string }>,
  similarityThreshold: number = 0.6
): Promise<ValidationResult> {
  const details: string[] = [];
  
  if (responses.length < 2) {
    return {
      passed: true,
      confidence: 0.7,
      details: ["仅一个响应，无法进行交叉验证"],
    };
  }

  // 简单文本相似度计算（基于词袋模型）
  const tokenize = (text: string) => {
    return text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  };

  const jaccardSimilarity = (a: string[], b: string[]) => {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(w => setB.has(w)).length;
    const union = new Set([...setA, ...setB]).size;
    return intersection / union;
  };

  let similarities: number[] = [];
  for (let i = 0; i < responses.length - 1; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      const tokensA = tokenize(responses[i].content);
      const tokensB = tokenize(responses[j].content);
      const sim = jaccardSimilarity(tokensA, tokensB);
      similarities.push(sim);
    }
  }

  const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
  const passed = avgSimilarity >= similarityThreshold;

  details.push(
    `比较了 ${responses.length} 个模型的输出`,
    `平均相似度：${(avgSimilarity * 100).toFixed(1)}%`,
    `阈值：${(similarityThreshold * 100).toFixed(0)}%`
  );

  if (passed) {
    details.push("✓ 多个模型输出一致性良好");
  } else {
    details.push("⚠ 模型输出差异较大，建议人工审查");
  }

  return {
    passed,
    confidence: passed ? 0.85 : 0.5,
    details,
    suggestions: passed 
      ? [] 
      : ["考虑使用更多模型进行验证", "检查问题是否有歧义"],
  };
}

/**
 * Level 3: 外部工具验证 - 代码执行验证
 */
export async function validateCodeExecution(
  code: string,
  language: string = "javascript"
): Promise<ValidationResult> {
  const details: string[] = [];
  
  if (language === "javascript") {
    try {
      // 简单的语法检查（不实际执行）
      new Function(code);
      details.push("✓ JavaScript 语法检查通过");
      return {
        passed: true,
        confidence: 0.9,
        details,
      };
    } catch (e) {
      details.push(`✗ JavaScript 语法错误：${e instanceof Error ? e.message : String(e)}`);
      return {
        passed: false,
        confidence: 0.2,
        details,
        suggestions: ["检查语法错误", "考虑使用 TypeScript"],
      };
    }
  }

  // 其他语言的简单检查
  if (language === "python") {
    // 简单检查 Python 语法特征
    const pythonKeywords = ["def ", "class ", "import ", "from ", "print(", "return "];
    const hasPythonFeatures = pythonKeywords.some(kw => code.includes(kw));
    
    if (hasPythonFeatures) {
      details.push("✓ 检测到 Python 代码特征");
      return {
        passed: true,
        confidence: 0.7,
        details,
      };
    } else {
      details.push("⚠ 未检测到明显的 Python 代码特征");
      return {
        passed: true,
        confidence: 0.5,
        details,
        suggestions: ["代码可能不完整"],
      };
    }
  }

  return {
    passed: true,
    confidence: 0.6,
    details: [`不支持 ${language} 的代码验证`],
  };
}

/**
 * Level 3: 数学验证 - 使用简单规则验证
 */
export function validateMathExpression(expression: string, expectedAnswer?: number): ValidationResult {
  const details: string[] = [];
  
  // 检查数学表达式格式
  const mathPattern = /^[\d+\-*/().\s]+$/;
  if (!mathPattern.test(expression)) {
    details.push("⚠ 表达式包含非数学字符");
  }

  try {
    // 安全地计算表达式（仅允许数学字符）
    if (mathPattern.test(expression)) {
      const result = Function('"use strict";return (' + expression + ")")();
      details.push(`计算结果：${result}`);
      
      if (expectedAnswer !== undefined) {
        const isCorrect = Math.abs(result - expectedAnswer) < 0.0001;
        if (isCorrect) {
          details.push("✓ 答案正确");
          return {
            passed: true,
            confidence: 0.95,
            details,
          };
        } else {
          details.push(`✗ 答案错误，期望：${expectedAnswer}`);
          return {
            passed: false,
            confidence: 0.1,
            details,
            suggestions: ["重新检查计算过程"],
          };
        }
      }
      
      return {
        passed: true,
        confidence: 0.8,
        details,
      };
    }
  } catch (e) {
    details.push(`✗ 表达式求值失败：${e instanceof Error ? e.message : String(e)}`);
    return {
      passed: false,
      confidence: 0.2,
      details,
      suggestions: ["检查表达式语法"],
    };
  }

  return {
    passed: true,
    confidence: 0.5,
    details: details.length > 0 ? details : ["无法验证复杂数学表达式"],
  };
}

/**
 * 综合验证入口函数
 */
export async function validateResponse(
  content: string,
  config: ValidationConfig & {
    model?: string;
    taskType?: string;
    expectedFormat?: string;
  }
): Promise<ValidationResult> {
  const { level, expectedFormat, taskType } = config;
  const results: ValidationResult[] = [];

  // Level 1: 基础验证（总是执行）
  const basicResult = basicValidation(content, expectedFormat);
  results.push(basicResult);

  if (!basicResult.passed && level === 1) {
    return basicResult;
  }

  // Level 2 & 3: 根据任务类型执行特定验证
  if (taskType === "code" && level >= 2) {
    const codeResult = await validateCodeExecution(content, "javascript");
    results.push(codeResult);
  }

  if (taskType === "math" && level >= 2) {
    // 提取数学表达式（简单实现）
    const mathMatch = content.match(/[\d+\-*/().\s]+/);
    if (mathMatch) {
      const mathResult = validateMathExpression(mathMatch[0]);
      results.push(mathResult);
    }
  }

  // 综合评分
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const allPassed = results.every(r => r.passed);
  const allDetails = results.flatMap(r => r.details);
  const allSuggestions = results.flatMap(r => r.suggestions || []);

  return {
    passed: allPassed,
    confidence: avgConfidence,
    details: allDetails,
    suggestions: allSuggestions.length > 0 ? allSuggestions : undefined,
  };
}

/**
 * 质量门控验证
 */
export async function validateWithGates(
  content: string,
  config: ValidationConfig & {
    gates?: QualityGate[];
    context?: any;
    expectedFormat?: string;
  }
): Promise<EnhancedValidationResult> {
  const { gates, context, expectedFormat } = config;
  
  // 1. 基础验证
  const basicResult = basicValidation(content, expectedFormat);
  
  // 2. 如果没有门控，返回基础验证结果
  if (!gates || gates.length === 0) {
    return basicResult;
  }
  
  // 3. 执行所有门控
  const gateResults: GateResult[] = [];
  let allPassed = true;
  let blocked = false;
  
  for (const gate of gates) {
    try {
      const result = await gate.execute({ content, ...context }, context);
      gateResults.push(result);
      
      if (!result.passed) {
        allPassed = false;
        if (result.blocked) {
          blocked = true;
          break; // 如果被阻断，立即停止
        }
      }
    } catch (error) {
      // 门控执行失败，记录为未通过
      gateResults.push({
        passed: false,
        score: 0,
        issues: [`门控执行失败：${error instanceof Error ? error.message : String(error)}`],
        suggestions: ["检查输入数据格式"],
        blocked: gate.blocked || false,
      });
      
      if (gate.blocked) {
        blocked = true;
        break;
      }
    }
  }
  
  // 4. 综合结果
  const gateScores = gateResults.map(r => r.score);
  const avgScore = gateScores.length > 0 
    ? gateScores.reduce((a, b) => a + b, 0) / gateScores.length 
    : 0;
  
  const allDetails = [
    ...basicResult.details,
    ...gateResults.flatMap(r => r.issues.map(i => `[门控] ${i}`)),
  ];
  
  const allSuggestions = [
    ...(basicResult.suggestions || []),
    ...gateResults.flatMap(r => r.suggestions.map(s => `[门控] ${s}`)),
  ];
  
  return {
    passed: basicResult.passed && allPassed && !blocked,
    confidence: (basicResult.confidence + avgScore / 100) / 2,
    details: allDetails,
    suggestions: allSuggestions.length > 0 ? allSuggestions : undefined,
    gateResults,
  };
}
