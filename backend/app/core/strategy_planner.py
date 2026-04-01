"""
策略规划器 - 自动评估任务复杂度并选择协作方案
"""
import json
import re
from typing import Dict, Any, Optional
from app.schemas.task import TaskType
from app.config import settings
from app.models.openai import OpenAIConnector, Message

class StrategyPlanner:
    def __init__(self, model_connector=None):
        # 如果未提供连接器，默认使用 Qwen 配置
        self.model_connector = model_connector or OpenAIConnector(
            api_key=settings.QWEN_API_KEY,
            base_url=settings.QWEN_API_URL,
            default_model=settings.QWEN_DEFAULT_MODEL
        )

    async def analyze_task(self, title: str, description: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        分析任务并推荐策略
        """
        prompt = f"""
        你是一个AI任务编排专家。请分析以下任务，并推荐最合适的协作策略。

        任务标题: {title}
        任务描述: {description}
        输入数据: {json.dumps(input_data, ensure_ascii=False)}

        协作策略选项:
        1. general: 简单任务，单个智能体即可完成，或简单的顺序执行。
        2. subagent: 中等难度任务，需要明确的规划者、执行者和质量评审（如代码开发）。
        3. cluster: 大规模并行任务，各子任务间高度解耦（如海量数据抓取、并行分析）。
        4. hybrid: 高难度复杂任务，需要划分为多个功能分组，每个分组内部可能还有子协作。

        请严格返回 JSON 格式结果（不要包含 markdown 代码块标记，直接返回内容），包含以下字段:
        - recommended_type: 上述选项对应的字符串。
        - complexity_score: 1-100 的评分。
        - reasoning: 推荐理由（中文）。
        - suggested_groups: 如果是 hybrid 或 cluster，建议的任务分组列表。
        """

        try:
            # 调用模型进行真实推理
            messages = [Message(role="user", content=prompt)]
            response = await self.model_connector.chat(
                messages=messages,
                temperature=0.1 # 降低随机性
            )
            
            content = response.content.strip()
            # 移除可能存在的 markdown 代码块标记
            content = re.sub(r'```json\s*|\s*```', '', content)
            
            result = json.loads(content)
            return result
            
        except Exception as e:
            print(f"Strategy analysis error (Real LLM): {e}")
            # 回退到启发式分析
            return self._heuristic_analysis(title, description)

    def _heuristic_analysis(self, title: str, description: str) -> Dict[str, Any]:
        """简单的启发式分析逻辑，作为 API 故障时的回退"""
        text = (title + (description or "")).lower()
        
        if any(kw in text for kw in ["开发", "代码", "implement", "feature", "bug"]):
            return {
                "recommended_type": "subagent",
                "complexity_score": 70,
                "reasoning": "检测到软件开发关键字，推荐使用专用的 SubAgent 工作流（回退方案）。"
            }
        elif any(kw in text for kw in ["抓取", "海量", "批量", "scrape", "batch"]):
            return {
                "recommended_type": "cluster",
                "complexity_score": 80,
                "reasoning": "检测到批量处理任务，推荐使用并行集群工作流（回退方案）。"
            }
        elif len(text) > 300 or any(kw in text for kw in ["复杂", "项目", "全栈", "system"]):
            return {
                "recommended_type": "hybrid",
                "complexity_score": 90,
                "reasoning": "描述内容较长或包含复杂项目关键字，推荐使用混合分组流（回退方案）。"
            }
        
        return {
            "recommended_type": "general",
            "complexity_score": 30,
            "reasoning": "默认使用通用的单智能体模式（回退方案）。"
        }
