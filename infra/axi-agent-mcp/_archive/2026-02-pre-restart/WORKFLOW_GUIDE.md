# 工作流引擎使用指南

## 概述

工作流引擎支持多步骤任务链的自动执行，每个步骤可以使用不同的模型，并支持数据传递和转换。

## 内置工作流

### 1. code_review - 代码审查

**用途**: 自动分析代码、提出问题、给出建议

**步骤**:
1. `analyze` (kimi-k2.5): 分析代码结构和潜在问题
2. `questions` (qwen3-max-2026-01-23): 提出关键问题
3. `suggestions` (qwen3-coder-next): 给出改进建议

**示例**:
```
/swarm_execute_workflow
  workflowName: code_review
  input: |
    function add(a, b) {
      return a + b;
    }
```

### 2. data_analysis - 数据分析

**用途**: 数据理解、统计分析、可视化建议

**步骤**:
1. `understand` (kimi-k2.5): 分析数据结构
2. `analyze` (qwen3-coder-next): 生成分析代码
3. `visualize` (qwen3-coder-next): 生成可视化代码

### 3. content_creation - 内容创作

**用途**: 大纲、草稿、润色

**步骤**:
1. `outline` (qwen3-max-2026-01-23): 创建大纲
2. `draft` (glm-5): 撰写草稿
3. `polish` (MiniMax-M2.5): 润色内容

### 4. bug_fix - Bug 修复

**用途**: 问题诊断、定位原因、修复方案

**步骤**:
1. `diagnose` (qwen3-max-2026-01-23): 诊断问题
2. `locate` (qwen3-coder-next): 定位代码
3. `fix` (qwen3-coder-next): 提供修复方案

---

## 自定义工作流

### YAML 格式示例

```yaml
name: my_workflow
description: 我的自定义工作流
version: 1.0.0
outputFormat: markdown
steps:
  - id: step1
    model: qwen3-max-2026-01-23
    prompt: 分析以下需求：{{input}}
  - id: step2
    model: qwen3-coder-next
    inputFrom: previous
    prompt: 基于分析结果生成代码：{{previous.output}}
  - id: step3
    model: glm-5
    inputFrom: step1
    prompt: 编写文档：{{previous.output}}
```

### JSON 格式示例

```json
{
  "name": "my_workflow",
  "description": "我的自定义工作流",
  "version": "1.0.0",
  "steps": [
    {
      "id": "step1",
      "model": "qwen3-max-2026-01-23",
      "prompt": "分析以下需求：{{input}}"
    },
    {
      "id": "step2",
      "model": "qwen3-coder-next",
      "inputFrom": "previous",
      "prompt": "基于分析结果生成代码：{{previous.output}}"
    }
  ]
}
```

---

## 高级功能

### 1. 变量替换

在 prompt 中使用 `{{variable}}` 语法：

```yaml
steps:
  - id: analyze
    model: kimi-k2.5
    prompt: |
      请分析以下代码：
      代码：{{code}}
      语言：{{language}}
```

### 2. 数据转换 (transform)

使用 TypeScript 代码转换输出：

```yaml
steps:
  - id: fetch
    model: qwen3-coder-next
    prompt: 获取数据
    transform: |
      // 将输出转换为 JSON
      const data = JSON.parse(output);
      return { items: data.items, total: data.total };
```

### 3. 错误处理

```yaml
name: robust_workflow
fallbackOnError: error_handler  # 失败时跳转到错误处理步骤
steps:
  - id: main
    model: qwen3-max-2026-01-23
    prompt: 主任务
  - id: error_handler
    model: qwen3-max-2026-01-23
    prompt: 处理错误：{{main.error}}
```

### 4. 重试机制

```yaml
steps:
  - id: unstable_step
    model: qwen3-coder-next
    prompt: 执行任务
    retryCount: 3  # 失败时重试 3 次
    timeout: 60000  # 超时 60 秒
```

---

## 可用工具

### swarm_list_workflows
列出所有内置工作流模板

### swarm_execute_workflow
执行工作流
- `workflowName`: 内置工作流名称
- `workflowDefinition`: 自定义工作流 YAML/JSON
- `input`: 工作流输入
- `variables`: 额外变量

### swarm_validate_workflow
验证工作流定义是否有效
- `workflowDefinition`: 工作流定义
- `format`: yaml 或 json

---

## 最佳实践

1. **步骤粒度**: 每个步骤应该完成一个明确的任务
2. **模型选择**: 根据任务类型选择最合适的模型
3. **错误处理**: 关键步骤应该配置 fallbackOnError
4. **超时设置**: 长运行步骤应该设置 timeout
5. **数据传递**: 使用 inputFrom 明确指定数据来源
6. **变量命名**: 使用有意义的变量名提高可读性

---

## 示例场景

### 场景 1: 自动化代码审查

```yaml
name: pr_review
steps:
  - id: diff_analysis
    model: kimi-k2.5
    prompt: 分析以下代码变更：{{diff}}
  - id: security_check
    model: qwen3-coder-next
    inputFrom: previous
    prompt: 检查安全问题：{{previous.output}}
  - id: performance_check
    model: qwen3-coder-next
    prompt: 检查性能问题
  - id: summary
    model: glm-5
    inputFrom: previous
    prompt: 生成审查总结
```

### 场景 2: 智能客服

```yaml
name: customer_support
steps:
  - id: understand
    model: glm-5
    prompt: 理解用户问题：{{user_message}}
  - id: search_kb
    model: kimi-k2.5
    inputFrom: previous
    prompt: 从知识库查找答案
  - id: generate_response
    model: MiniMax-M2.5
    inputFrom: previous
    prompt: 生成友好回复
```

### 场景 3: 数据报告生成

```yaml
name: report_generation
steps:
  - id: extract_data
    model: qwen3-coder-next
    prompt: 从数据库提取数据
  - id: analyze
    model: qwen3-max-2026-01-23
    inputFrom: previous
    prompt: 分析数据趋势
  - id: visualize
    model: qwen3-coder-next
    inputFrom: previous
    prompt: 生成图表代码
  - id: write_report
    model: glm-5
    inputFrom: previous
    prompt: 撰写报告
```

---

## 性能优化

1. **并行执行**: 独立步骤可以并行执行（未来版本支持）
2. **缓存**: 相同输入可以缓存结果（未来版本支持）
3. **批量处理**: 多个输入可以批量处理
4. **超时控制**: 合理设置 timeout 避免长时间等待

---

## 故障排除

### 问题 1: 步骤失败
- 检查模型是否可用
- 检查 inputFrom 引用是否正确
- 查看日志中的详细错误信息

### 问题 2: 变量替换失败
- 检查变量名是否正确
- 确保变量已定义
- 使用 `{{previous.output}}` 获取上一步输出

### 问题 3: transform 执行错误
- 检查 TypeScript 语法
- 确保有 return 语句
- 检查变量作用域

---

## 更新日志

### v2.0.0 (2026-02-25)
- ✅ 初始版本发布
- ✅ 支持 4 个内置工作流
- ✅ 支持自定义工作流
- ✅ 支持变量替换
- ✅ 支持 transform 转换
- ✅ 支持错误处理和重试

### 计划中
- ⏳ 并行步骤执行
- ⏳ 结果缓存
- ⏳ 条件分支
- ⏳ 循环支持
- ⏳ 子工作流
