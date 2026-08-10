"""Legacy strategy compatibility classifier.

This module intentionally does not call a model or choose an execution
topology.  `strategy_mode` remains parse-compatible for existing clients, but
the Workflow Engine is the only authority allowed to turn normalized signals
into a task-execution-routing/v1 decision.
"""
from __future__ import annotations

from typing import Any, Dict


class StrategyPlanner:
    """Return deterministic advisory metadata for historical callers only."""

    def __init__(self, model_connector: Any = None):
        # Keep the argument so legacy construction sites do not break.  It is
        # deliberately never invoked: a model cannot choose tools, loops, or
        # subagents through this compatibility surface.
        self.model_connector = model_connector

    async def analyze_task(self, title: str, description: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Classify task text deterministically and return advisory signals.

        Consumers must submit the signals to the workflow routing contract;
        `recommended_type` is not an execution instruction.
        """
        advisory = self._heuristic_analysis(title, description)
        advisory.update(
            {
                "advisoryOnly": True,
                "controlFlowOwner": "workflow-engine",
                "routeSignals": self._route_signals(input_data),
            }
        )
        return advisory

    @staticmethod
    def _route_signals(input_data: Dict[str, Any]) -> Dict[str, bool]:
        """Expose only bounded classification inputs accepted by the workflow."""
        source = input_data if isinstance(input_data, dict) else {}
        return {
            "pathEnumerable": source.get("path_enumerable") is True,
            "localPathUnenumerable": source.get("local_path_unenumerable") is True,
            "readOnly": source.get("read_only") is True,
            "requestsCommand": source.get("requests_command") is True,
            "requestsWrite": source.get("requests_write") is True,
            "requestsExternalSideEffect": source.get("requests_external_side_effect") is True,
            "requestsPrivilegeEscalation": source.get("requests_privilege_escalation") is True,
        }

    @staticmethod
    def _heuristic_analysis(title: str, description: str) -> Dict[str, Any]:
        """Stable compatibility hints; the result never controls execution."""
        text = (title + (description or "")).lower()

        if any(keyword in text for keyword in ["开发", "代码", "implement", "feature", "bug"]):
            return {
                "recommended_type": "subagent",
                "complexity_score": 70,
                "reasoning": "检测到软件开发关键字；仅作为历史兼容建议，必须由工作流升级审批。",
            }
        if any(keyword in text for keyword in ["抓取", "海量", "批量", "scrape", "batch"]):
            return {
                "recommended_type": "cluster",
                "complexity_score": 80,
                "reasoning": "检测到批量处理关键字；仅作为历史兼容建议，不能创建并行子任务。",
            }
        if len(text) > 300 or any(keyword in text for keyword in ["复杂", "项目", "全栈", "system"]):
            return {
                "recommended_type": "hybrid",
                "complexity_score": 90,
                "reasoning": "检测到复杂性信号；仅作为历史兼容建议，不能选择混合执行拓扑。",
            }

        return {
            "recommended_type": "general",
            "complexity_score": 30,
            "reasoning": "默认通用建议；最终路由仍由工作流决定。",
        }
