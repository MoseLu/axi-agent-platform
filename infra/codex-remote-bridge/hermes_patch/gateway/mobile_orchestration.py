"""Mobile-first Codex intent helpers for the Hermes gateway.

This module is deliberately pure: it does not know about WebSockets, Hermes
runner objects, or local Codex state. The gateway owns I/O and calls these
helpers to classify common WeCom utterances and format indexed mobile replies.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional


MOBILE_DISPLAY_TZ = timezone(timedelta(hours=8))


CODEX_MOBILE_INTENTS = {
    "list_projects",
    "list_project_sessions",
    "resume_session",
    "new_session",
    "history_summary",
    "list_capabilities",
    "use_capability",
    "running_tasks_status",
    "current_status",
    "mobile_help",
    "codex_task",
    "hermes_chat",
}


def detect_mobile_intent(text: str) -> str:
    value = str(text or "").strip()
    compact = re.sub(r"\s+", "", value.lower())
    if not compact:
        return "hermes_chat"
    if _looks_like_mobile_help_query(value):
        return "mobile_help"
    if _looks_like_capabilities_query(value):
        return "list_capabilities"
    if _looks_like_capability_use(value):
        return "use_capability"
    if _looks_like_history_query(value):
        return "history_summary"
    if _looks_like_new_session_request(value):
        return "new_session"
    if _looks_like_resume_session_request(value):
        return "resume_session"
    if _looks_like_project_sessions_query(value):
        return "list_project_sessions"
    if _looks_like_projects_query(value):
        return "list_projects"
    if _looks_like_running_tasks_status_query(value):
        return "running_tasks_status"
    if _looks_like_current_status_query(value):
        return "current_status"
    if _looks_like_codex_task(value):
        return "codex_task"
    return "hermes_chat"


def format_capability_selection(capabilities: Iterable[Dict[str, Any]]) -> str:
    items = list(capabilities)
    if not items:
        return "未发现当前 Codex 运行时可用插件或技能。"
    visible = items[:12]
    lines = [f"**Codex 能力（{len(items)} 个，显示 {len(visible)} 个）**", "", "可以说：选第1个，或“用 xxx 做 yyy”。"]
    for index, item in enumerate(visible, start=1):
        name = _compact(item.get("name") or item.get("invocation_label") or "-", 28)
        source = _source_label(item.get("source"))
        lines.append(f"{index}. `{name}` · {source}")
    return "\n".join(lines)


def format_history_selection(history: Dict[str, Any]) -> str:
    sessions = list(history.get("sessions") or [])
    if not sessions:
        return "没有找到匹配的 Codex 历史会话。"
    visible = sessions[:8]
    lines = [f"**Codex 历史（{len(sessions)} 个，显示 {len(visible)} 个）**", "", "可以说：接管第1个会话。"]
    for index, session in enumerate(visible, start=1):
        title = _compact(session.get("thread_name") or session.get("title") or "Untitled", 34)
        updated = _mobile_time(session.get("updated_at"))
        lines.append(f"{index}. `{updated}` · {title}")
    return "\n".join(lines)


def format_project_selection(selection: Dict[str, Any]) -> str:
    projects = list(selection.get("projects") or [])
    if not projects:
        return "未发现本机 Codex 项目。"
    visible = projects[:10]
    lines = [f"**Codex 项目（{len(projects)} 个）**", "", "可以说：选第2个项目、看看第二个。  "]
    for index, project in enumerate(visible, start=1):
        name = _compact(project.get("name") or "-", 30)
        session_count = len(project.get("sessions") or [])
        lines.append(f"{index}）{name}  ")
        lines.append(f"会话：{session_count} 个  ")
        lines.append("")
    return "\n".join(lines)


def format_session_selection(project: Dict[str, Any], sessions: Iterable[Dict[str, Any]]) -> str:
    items = list(sessions)
    project_name = _compact(project.get("name") or "-", 34)
    visible = items[:10]
    lines = [f"**{project_name} 会话（{len(items)} 个）**", "", "0）新建会话  ", ""]
    for index, session in enumerate(visible, start=1):
        title = _compact(session.get("thread_name") or session.get("title") or "Untitled", 34)
        updated = _mobile_time(session.get("updated_at"))
        lines.append(f"{index}）{title}  ")
        lines.append(f"时间：{updated}  ")
        lines.append("")
    if not items:
        lines.append("暂无已有会话。")
    lines.append("可以说：接管第1个会话，或新开一个会话。")
    return "\n".join(lines)


def format_new_session_prompt(project: Dict[str, Any]) -> str:
    project_name = _compact(project.get("name") or "-", 34)
    return "\n".join(
        [
            f"将在 {project_name} 新建 Codex App 会话。",
            "",
            "直接发送第一条需求即可开始。",
            "回复“取消”退出。",
        ]
    )


def format_session_bound(project: Dict[str, Any], session: Dict[str, Any]) -> str:
    project_name = _compact(project.get("name") or "-", 34)
    title = _compact(session.get("thread_name") or session.get("title") or "Untitled", 36)
    lines = [
        "已接管 Codex App 会话",
        "",
        f"项目：{project_name}",
        f"会话：{title}",
    ]
    reply_summary = _compact(session.get("last_assistant_summary") or "", 120)
    if reply_summary:
        lines.extend(["", f"最后回复：{reply_summary}"])
    lines.extend(["", "现在直接发需求即可继续。"])
    return "\n".join(lines)


def format_mobile_help() -> str:
    return "\n".join(
        [
            "你可以直接这样说：  ",
            "",
            "看看项目  ",
            "选第2个项目  ",
            "接管第1个会话  ",
            "新开一个会话  ",
            "现在接的是哪个会话  ",
            "现在有几个任务在跑  ",
            "继续修刚才的问题  ",
        ]
    )


def format_running_tasks_status(payload: Dict[str, Any]) -> str:
    tasks = list(payload.get("tasks") or [])
    active_count = payload.get("active_count")
    try:
        count = int(active_count)
    except (TypeError, ValueError):
        count = len(tasks)
    if count <= 0:
        return "现在没有检测到正在跑的 Codex App 任务。"
    visible = tasks[:8]
    lines = [f"现在有 {count} 个任务在跑。  "]
    for index, task in enumerate(visible, start=1):
        title = _compact(task.get("thread_name") or task.get("title") or task.get("id") or "Untitled", 34)
        cwd_name = _path_name(task.get("cwd"))
        suffix = f" · {cwd_name}" if cwd_name else ""
        lines.append(f"{index}）{title}{suffix}  ")
    if count > len(visible):
        lines.append(f"还有 {count - len(visible)} 个未显示。")
    return "\n".join(lines)


def format_running_task_status(task: Dict[str, Any], *, active: Optional[bool] = None, choice: Optional[int] = None) -> str:
    if not task:
        return "没有找到这个任务。请先发送“现在有几个任务在跑”。"
    title = _compact(task.get("thread_name") or task.get("title") or task.get("id") or "Untitled", 42)
    cwd_name = _path_name(task.get("cwd"))
    updated = _mobile_time(task.get("last_seen_at"))
    prefix = f"第 {choice} 个任务" if choice else "这个任务"
    if active is True:
        status = "还在跑"
    elif active is False:
        status = "最近 3 分钟没看到继续跑，可能已完成或停了"
    else:
        status = "状态未知"
    lines = [f"{prefix}：{status}。  ", f"会话：{title}  "]
    if cwd_name:
        lines.append(f"项目：{cwd_name}  ")
    if updated != "-":
        lines.append(f"最后活动：{updated}  ")
    return "\n".join(lines)


def find_capability_by_query(capabilities: Iterable[Dict[str, Any]], text: str) -> Optional[Dict[str, Any]]:
    query = _match_text(text)
    if not query:
        return None
    for item in capabilities:
        labels = {
            str(item.get("name") or ""),
            str(item.get("invocation_label") or ""),
            str(item.get("description") or ""),
        }
        for label in labels:
            normalized = _match_text(label)
            if len(normalized) >= 2 and normalized in query:
                return item
    return None


def build_capability_prompt(capability: Dict[str, Any], text: str) -> str:
    name = str(capability.get("invocation_label") or capability.get("name") or "").strip()
    description = str(capability.get("description") or "").strip()
    return (
        "# Requested Codex Capability\n"
        f"Use this Codex runtime capability if applicable: {name}\n"
        f"Description: {description or '-'}\n\n"
        "## User Task\n"
        f"{text}"
    )


def extract_choice_number(text: str) -> Optional[int]:
    value = str(text or "").strip()
    if not value:
        return None
    compact = re.sub(r"\s+", "", value)
    match = re.fullmatch(r"(?:选|选择|看|看看|打开|进入|接管|继续|用)?(?:第)?([0-9]{1,3})(?:个|项|号|项目|会话|技能)?", compact)
    if not match:
        match = re.search(r"(?:项目|会话|技能|第|选|选择|看|看看|打开|进入|接管|继续|用)([0-9]{1,3})(?:个|项|号|项目|会话|技能)?", compact)
    if match:
        return int(match.group(1))
    lead_match = re.search(r"^([0-9]{1,3})(?:个|项|号)?(?=.{0,12}(?:跑|运行|执行|任务|进度|状态|怎么样|怎样|如何|还在|完成|失败))", compact)
    if lead_match:
        return int(lead_match.group(1))
    zh_pattern = r"[零〇一二两三四五六七八九十]{1,4}"
    zh_match = re.fullmatch(rf"(?:选|选择|看|看看|打开|进入|接管|继续|用)?(?:第)?({zh_pattern})(?:个|项|号|项目|会话|技能)?", compact)
    if not zh_match:
        zh_match = re.search(rf"(?:项目|会话|技能|第|选|选择|看|看看|打开|进入|接管|继续|用)({zh_pattern})(?:个|项|号|项目|会话|技能)?", compact)
    if zh_match:
        return _chinese_choice_number(zh_match.group(1))
    return None


def extract_project_reference_number(text: str) -> Optional[int]:
    compact = re.sub(r"\s+", "", str(text or "").lower())
    if not compact:
        return None
    patterns = [
        r"(?:在|到|用|给|为|替|从)([0-9]{1,2})(?:中|里|上|项目|号项目|个项目)",
        r"(?:第)([0-9]{1,2})(?:个)?项目",
        r"(?:项目)([0-9]{1,2})",
        r"^([0-9]{1,2})(?:中|里).*(?:新建|新开|创建|新会话|new)",
    ]
    for pattern in patterns:
        match = re.search(pattern, compact, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def _looks_like_projects_query(text: str) -> bool:
    return bool(
        re.search(r"(codex|本机|本地|项目|projects?)", text, re.IGNORECASE)
        and re.search(r"(有哪些|有几个|几个|多少|数量|列表|列出|查看|查询|所有|全部|项目文件夹|list|show)", text, re.IGNORECASE)
        and not re.search(r"(会话|session)", text, re.IGNORECASE)
    )


def _looks_like_project_sessions_query(text: str) -> bool:
    return bool(
        re.search(r"(项目|project)", text, re.IGNORECASE)
        and re.search(r"(会话|session)", text, re.IGNORECASE)
        and re.search(r"(有哪些|有几个|几个|多少|数量|列表|列出|查看|查询|所有|全部|list|show)", text, re.IGNORECASE)
    )


def _looks_like_resume_session_request(text: str) -> bool:
    return bool(re.search(r"(继续|接管|恢复|resume).{0,24}(会话|session)", text, re.IGNORECASE))


def _looks_like_new_session_request(text: str) -> bool:
    return bool(re.search(r"(新开|新建|创建|开一个|新会话|new).{0,24}(会话|session|模块|功能|项目)?", text, re.IGNORECASE))


def _looks_like_history_query(text: str) -> bool:
    return bool(
        re.search(r"(这几天|最近|今天|昨天|本周|上周|历史|做了哪些|完成了哪些|改了哪些)", text, re.IGNORECASE)
        and re.search(r"(项目|会话|功能|codex|做了|完成|修改)", text, re.IGNORECASE)
    )


def _looks_like_capabilities_query(text: str) -> bool:
    return bool(
        re.search(r"(插件|技能|capabilit|skills?|plugins?)", text, re.IGNORECASE)
        and re.search(r"(有哪些|列表|列出|可用|查看|查询|list|show)", text, re.IGNORECASE)
    )


def _looks_like_capability_use(text: str) -> bool:
    return bool(re.search(r"(用|使用)\s*[^，,。\\s]+.{0,12}(插件|技能|skill|plugin)?", text, re.IGNORECASE))


def _looks_like_current_status_query(text: str) -> bool:
    return bool(
        re.fullmatch(r"\s*(当前会话|当前项目|当前状态|current session|current project|current status)\s*", text, re.IGNORECASE)
        or re.search(r"(现在|当前|正在|绑定).{0,12}(哪个|什么|哪一个)?.{0,12}(会话|项目|状态)", text, re.IGNORECASE)
    )


def _looks_like_running_tasks_status_query(text: str) -> bool:
    value = re.sub(r"\s+", "", str(text or "").lower())
    value = re.sub(r"^[0-9]{1,2}[)）.、]?", "", value)
    return bool(
        (
            re.search(r"(几个|多少|有几个|几条|多少个)", value, re.IGNORECASE)
            and re.search(r"(任务|task)", value, re.IGNORECASE)
            and re.search(r"(在跑|正在跑|运行|执行|跑着|active|running)", value, re.IGNORECASE)
        )
        or (
            re.search(r"(跑|运行|执行|任务|task)", value, re.IGNORECASE)
            and re.search(r"(怎么样|怎样|如何|进度|状态|到哪|到哪儿|结束|完成|完了|还在|成功|失败|卡住)", value, re.IGNORECASE)
        )
    )


def _looks_like_mobile_help_query(text: str) -> bool:
    return bool(
        re.fullmatch(
            r"\s*(帮助|怎么用|如何使用|能说什么|可以说什么|有哪些说法|有什么口令|使用说明|help|usage)\s*",
            text,
            re.IGNORECASE,
        )
    )


def _looks_like_codex_task(text: str) -> bool:
    return bool(
        re.search(r"(开发|实现|修改|修复|调试|测试|部署|提交|代码|功能|模块|git|pnpm|npm|pytest)", text, re.IGNORECASE)
    )


def _compact(value: Any, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"


def _mobile_time(value: Any) -> str:
    text = str(value or "-").strip()
    if not text or text == "-":
        return "-"
    parsed = _parse_mobile_datetime(text)
    if parsed is not None:
        return parsed.astimezone(MOBILE_DISPLAY_TZ).strftime("%m-%d %H:%M")
    text = re.sub(r"\.\d+", "", text).replace("T", " ")
    if text.endswith("Z"):
        text = text[:-1]
    match = re.match(r"\d{4}-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})", text)
    if match:
        return f"{match.group(1)}-{match.group(2)} {match.group(3)}:{match.group(4)}"
    return _compact(text, 16)


def _parse_mobile_datetime(value: str) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=MOBILE_DISPLAY_TZ)
    return parsed


def _source_label(value: Any) -> str:
    source = str(value or "").strip()
    labels = {
        "skill": "本地技能",
        "plugin_skill": "插件技能",
    }
    return labels.get(source, source or "-")


def _match_text(value: Any) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value or "").lower())


def _path_name(value: Any) -> str:
    text = str(value or "").rstrip("/")
    if not text:
        return ""
    return text.split("/")[-1] or text


def _chinese_choice_number(value: str) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    digits = {
        "零": 0,
        "〇": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    if text in digits:
        return digits[text]
    if text == "十":
        return 10
    if "十" in text:
        left, right = text.split("十", 1)
        tens = digits.get(left, 1 if left == "" else None)
        ones = digits.get(right, 0 if right == "" else None)
        if tens is None or ones is None:
            return None
        return tens * 10 + ones
    return None
