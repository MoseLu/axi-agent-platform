#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path


BRIDGE = Path("/root/.hermes/core/gateway/codex_bridge.py")
WECOM = Path("/root/.hermes/core/gateway/platforms/wecom.py")


def main() -> None:
    text = BRIDGE.read_text(encoding="utf-8")
    text = ensure_import(text)
    text = ensure_waiter_types(text)
    text = ensure_natural_message_pipeline(text)
    text = ensure_natural_control_pipeline(text)
    text = ensure_selection_states(text)
    text = ensure_numeric_selection_fallback(text)
    text = ensure_natural_choice_number(text)
    text = ensure_selection_state_ttl(text)
    text = ensure_selection_session_summary(text)
    text = ensure_request_helpers(text)
    text = ensure_running_tasks_status_helpers(text)
    text = ensure_new_session_project_resolution(text)
    text = ensure_history_helpers(text)
    text = ensure_mobile_formatters(text)
    text = ensure_app_session_summary_is_reply_only(text)
    BRIDGE.write_text(text, encoding="utf-8")

    wecom_text = WECOM.read_text(encoding="utf-8")
    wecom_text = ensure_wecom_proactive_markdown(wecom_text)
    WECOM.write_text(wecom_text, encoding="utf-8")


def ensure_import(text: str) -> str:
    required_names = [
        "build_capability_prompt",
        "detect_mobile_intent",
        "find_capability_by_query",
        "extract_project_reference_number",
        "format_capability_selection",
        "format_history_selection",
        "format_mobile_help",
        "format_new_session_prompt",
        "format_project_selection",
        "format_running_task_status",
        "format_running_tasks_status",
        "format_session_bound",
        "format_session_selection",
    ]
    import_match = re.search(r"from gateway\.mobile_orchestration import \(\n(?P<body>.*?)\n\)", text, re.DOTALL)
    if import_match:
        body = import_match.group("body")
        missing = [name for name in required_names if name not in body]
        existing = [name for name in re.findall(r"\b[A-Za-z_][A-Za-z0-9_]*\b", body) if name not in required_names]
        names = required_names + [name for name in existing if name not in required_names]
        new_body = "\n".join(f"    {name}," for name in names)
        if not missing and body.strip() == new_body.strip():
            return text
        return text[: import_match.start("body")] + new_body + text[import_match.end("body") :]
    anchor = "from gateway.config import Platform\n"
    addition = (
        "from gateway.mobile_orchestration import (\n"
        "    build_capability_prompt,\n"
        "    detect_mobile_intent,\n"
        "    find_capability_by_query,\n"
        "    extract_project_reference_number,\n"
        "    format_capability_selection,\n"
        "    format_history_selection,\n"
        "    format_mobile_help,\n"
        "    format_new_session_prompt,\n"
        "    format_project_selection,\n"
        "    format_running_task_status,\n"
        "    format_running_tasks_status,\n"
        "    format_session_bound,\n"
        "    format_session_selection,\n"
        ")\n"
    )
    require(anchor in text, "import anchor not found")
    return text.replace(anchor, anchor + addition)


def ensure_waiter_types(text: str) -> str:
    if '"history.result"' in text and '"runtime_capabilities.result"' in text and '"app_tasks.result"' in text:
        return text
    if '"runtime_capabilities.result"' in text:
        marker = '            "runtime_capabilities.result",\n'
        addition = "" if '"app_tasks.result"' in text else '            "app_tasks.result",\n'
        return text.replace(marker, marker + addition, 1)
    old = (
        '            "app_sessions",\n'
        '            "app_sessions.result",\n'
        "        }:\n"
    )
    new = (
        '            "app_sessions",\n'
        '            "app_sessions.result",\n'
        '            "history.result",\n'
        '            "runtime_capabilities.result",\n'
        '            "app_tasks.result",\n'
        "        }:\n"
    )
    require(old in text, "waiter type anchor not found")
    return text.replace(old, new)


def ensure_natural_message_pipeline(text: str) -> str:
    if 'mobile_intent == "new_session"' not in text or "_capability_prompt_for_query" not in text:
        old = (
            "        control = await self._try_handle_natural_control(event, text)\n"
            "        if control is not None:\n"
            "            return control\n"
            "\n"
            "        app_session = self._infer_app_session_selector(text)\n"
        )
        new = (
            "        control = await self._try_handle_natural_control(event, text)\n"
            "        if control is not None:\n"
            "            return control\n"
            "\n"
            "        mobile_intent = detect_mobile_intent(text)\n"
            '        if mobile_intent == "new_session":\n'
            "            project = await self._project_for_query(event, text)\n"
            '            app_session = {"mode": "new", "project_path": project.get("path")} if project else {"mode": "new", "scope": "projectless"}\n'
            "            return await self._start_job(\n"
            "                event,\n"
            "                text,\n"
            '                execution_mode="app_session",\n'
            "                app_session=app_session,\n"
            "                quiet_ack=True,\n"
            "            )\n"
            '        if mobile_intent == "use_capability":\n'
            "            capability_prompt = await self._capability_prompt_for_query(event, text)\n"
            "            if capability_prompt:\n"
            "                current_app_session = self._infer_current_app_session_selector(event, text)\n"
            "                return await self._start_job(\n"
            "                    event,\n"
            "                    capability_prompt,\n"
            '                    execution_mode="app_session" if current_app_session else None,\n'
            "                    app_session=current_app_session,\n"
            "                    quiet_ack=True,\n"
            "                )\n"
            "\n"
            "        app_session = self._infer_app_session_selector(text)\n"
        )
        require(old in text, "natural message anchor not found")
        text = text.replace(old, new)

    text = ensure_bound_app_session_before_classifier(text)
    text = ensure_capability_uses_bound_app_session(text)
    return text


def ensure_bound_app_session_before_classifier(text: str) -> str:
    if "bound_app_session = self._infer_bound_app_session_selector(event, text)" in text:
        return text
    old = (
        "        current_app_session = self._infer_current_app_session_selector(event, text)\n"
        "        if current_app_session:\n"
        "            return await self._start_job(\n"
        "                event,\n"
        "                text,\n"
        '                execution_mode="app_session",\n'
        "                app_session=current_app_session,\n"
        "                quiet_ack=True,\n"
        "            )\n"
        "\n"
        "        decision = await self._decide_natural_route(event, text)\n"
    )
    new = (
        "        current_app_session = self._infer_current_app_session_selector(event, text)\n"
        "        if current_app_session:\n"
        "            return await self._start_job(\n"
        "                event,\n"
        "                text,\n"
        '                execution_mode="app_session",\n'
        "                app_session=current_app_session,\n"
        "                quiet_ack=True,\n"
        "            )\n"
        "\n"
        "        bound_app_session = self._infer_bound_app_session_selector(event, text)\n"
        "        if bound_app_session:\n"
        "            return await self._start_job(\n"
        "                event,\n"
        "                text,\n"
        '                execution_mode="app_session",\n'
        "                app_session=bound_app_session,\n"
        "                quiet_ack=True,\n"
        "            )\n"
        "\n"
        "        decision = await self._decide_natural_route(event, text)\n"
    )
    require(old in text, "bound app session router anchor not found")
    return text.replace(old, new)


def ensure_capability_uses_bound_app_session(text: str) -> str:
    old = "                current_app_session = self._infer_current_app_session_selector(event, text)\n"
    new = (
        "                current_app_session = (\n"
        "                    self._infer_current_app_session_selector(event, text)\n"
        "                    or self._infer_bound_app_session_selector(event, text)\n"
        "                )\n"
    )
    if new in text:
        return text
    require(old in text, "capability app session anchor not found")
    return text.replace(old, new, 1)


def ensure_natural_control_pipeline(text: str) -> str:
    if 'mobile_intent == "list_capabilities"' in text and 'mobile_intent == "history_summary"' in text:
        if 'mobile_intent == "mobile_help"' in text:
            if 'mobile_intent == "running_tasks_status"' in text:
                return text
            anchor = (
                '        if mobile_intent == "mobile_help":\n'
                "            return format_mobile_help()\n"
                "\n"
            )
            addition = (
                '        if mobile_intent == "running_tasks_status":\n'
                "            return await self._running_tasks_status(event)\n"
                "\n"
            )
            require(anchor in text, "running tasks control anchor not found")
            return text.replace(anchor, anchor + addition, 1)
        anchor = (
            "        mobile_intent = detect_mobile_intent(text)\n"
        )
        addition = (
            '        if mobile_intent == "mobile_help":\n'
            "            return format_mobile_help()\n"
            "\n"
            '        if mobile_intent == "running_tasks_status":\n'
            "            return await self._running_tasks_status(event)\n"
            "\n"
        )
        require(anchor in text, "mobile help control anchor not found")
        return text.replace(anchor, anchor + addition, 1)
    old = (
        "        if self._looks_like_project_sessions_query(compact, text):\n"
        "            return await self._project_sessions_for_query(event, text)\n"
        "\n"
        "        if self._looks_like_current_session_query(compact, text):\n"
        "            return self._format_current_app_session(event)\n"
        "\n"
        "        if self._looks_like_projects_query(compact, text):\n"
        "            return await self._projects(event)\n"
    )
    new = (
        "        mobile_intent = detect_mobile_intent(text)\n"
        '        if mobile_intent == "mobile_help":\n'
        "            return format_mobile_help()\n"
        "\n"
        '        if mobile_intent == "running_tasks_status":\n'
        "            return await self._running_tasks_status(event)\n"
        "\n"
        '        if mobile_intent == "list_capabilities":\n'
        "            return await self._capabilities(event)\n"
        "\n"
        '        if mobile_intent == "history_summary":\n'
        "            return await self._history(event, text)\n"
        "\n"
        '        if self._looks_like_project_sessions_query(compact, text) or mobile_intent == "list_project_sessions":\n'
        "            return await self._project_sessions_for_query(event, text)\n"
        "\n"
        '        if self._looks_like_projects_query(compact, text) or mobile_intent == "list_projects":\n'
        "            return await self._projects(event)\n"
        "\n"
        '        if self._looks_like_current_session_query(compact, text) or mobile_intent == "current_status":\n'
        "            return self._format_current_app_session(event)\n"
    )
    require(old in text, "natural control anchor not found")
    return text.replace(old, new)


def ensure_selection_states(text: str) -> str:
    if 'state.get("state_type") == "history"' in text and 'state.get("state_type") == "capabilities"' in text:
        return text
    old = (
        "            return _format_session_bound(project, session)\n"
        "\n"
        "        return None\n"
    )
    new = (
        "            return _format_session_bound(project, session)\n"
        "\n"
        '        if state.get("state_type") == "history":\n'
        '            sessions = payload.get("sessions") or []\n'
        "            if not (1 <= choice <= len(sessions)):\n"
        '                return f"没有第 {choice} 个历史会话。请回复 1-{len(sessions)} 之间的序号。"\n'
        "            session = sessions[choice - 1]\n"
        "            project = {\n"
        '                "name": session.get("project_name") or Path(str(session.get("project_path") or session.get("cwd") or "")).name or "-",\n'
        '                "path": session.get("project_path") or session.get("cwd") or "",\n'
        "            }\n"
        "            self._selection_state.clear(conversation_id)\n"
        "            self._mobile_context.set_current(\n"
        "                {\n"
        '                    "session_id": session.get("id") or session.get("session_id"),\n'
        '                    "thread_name": session.get("thread_name") or session.get("title") or "Untitled",\n'
        '                    "project_path": session.get("cwd") or session.get("project_path") or "",\n'
        '                    "last_job_id": "",\n'
        '                    "status": "idle",\n'
        "                },\n"
        "                conversation_id,\n"
        "            )\n"
        "            return _format_session_bound(project, session)\n"
        "\n"
        '        if state.get("state_type") == "capabilities":\n'
        '            capabilities = payload.get("capabilities") or []\n'
        "            if not (1 <= choice <= len(capabilities)):\n"
        '                return f"没有第 {choice} 个插件/技能。请回复 1-{len(capabilities)} 之间的序号。"\n'
        "            capability = capabilities[choice - 1]\n"
        '            self._selection_state.set(conversation_id, "capability_prompt", {"capability": capability})\n'
        '            label = capability.get("invocation_label") or capability.get("name") or "-"\n'
        '            return f"已选择 Codex 能力：{label}\\n请直接发送要执行的需求。"\n'
        "\n"
        "        return None\n"
    )
    require(old in text, "selection state anchor not found")
    text = text.replace(old, new)

    old_choice_none = (
        "        if choice is None:\n"
        '            if state.get("state_type") == "sessions" and _looks_like_new_session_request(text):\n'
    )
    new_choice_none = (
        "        if choice is None:\n"
        '            if state.get("state_type") == "capability_prompt":\n'
        '                payload = state.get("payload") or {}\n'
        '                capability = payload.get("capability") or {}\n'
        "                self._selection_state.clear(conversation_id)\n"
        "                return await self._start_job(event, build_capability_prompt(capability, text), quiet_ack=True)\n"
        '            if state.get("state_type") == "sessions" and _looks_like_new_session_request(text):\n'
    )
    require(old_choice_none in text, "choice-none selection anchor not found")
    return text.replace(old_choice_none, new_choice_none)


def ensure_numeric_selection_fallback(text: str) -> str:
    if "当前没有可用的序号清单" in text:
        return text
    old = (
        "        if not state and choice is not None:\n"
        '            state = self._selection_state.latest("projects")\n'
        "        if not state:\n"
        "            return None\n"
    )
    new = (
        "        if not state and choice is not None:\n"
        "            candidates = [\n"
        '                self._selection_state.latest("projects"),\n'
        '                self._selection_state.latest("sessions"),\n'
        '                self._selection_state.latest("history"),\n'
        '                self._selection_state.latest("capabilities"),\n'
        "            ]\n"
        '            state = max((item for item in candidates if item), key=lambda item: item.get("updated_at") or 0, default=None)\n'
        "        if not state:\n"
        "            if choice is not None:\n"
        '                return "当前没有可用的序号清单。请先重新发送“有哪些项目”或“有哪些技能”。"\n'
        "            return None\n"
    )
    require(old in text, "numeric selection fallback anchor not found")
    return text.replace(old, new)


def ensure_natural_choice_number(text: str) -> str:
    replacement = (
        "def _extract_choice_number(text: str) -> Optional[int]:\n"
        "    value = str(text or \"\").strip()\n"
        "    if not value:\n"
        "        return None\n"
        "    compact = re.sub(r\"\\s+\", \"\", value)\n"
        "    match = re.fullmatch(r\"(?:选|选择|看|看看|打开|进入|接管|继续|用)?(?:第)?([0-9]{1,3})(?:个|项|号|项目|会话|技能)?\", compact)\n"
        "    if not match:\n"
        "        match = re.search(r\"(?:项目|会话|技能|第|选|选择|看|看看|打开|进入|接管|继续|用)([0-9]{1,3})(?:个|项|号|项目|会话|技能)?\", compact)\n"
        "    if match:\n"
        "        return int(match.group(1))\n"
        "    zh_pattern = r\"[零〇一二两三四五六七八九十]{1,4}\"\n"
        "    zh_match = re.fullmatch(rf\"(?:选|选择|看|看看|打开|进入|接管|继续|用)?(?:第)?({zh_pattern})(?:个|项|号|项目|会话|技能)?\", compact)\n"
        "    if not zh_match:\n"
        "        zh_match = re.search(rf\"(?:项目|会话|技能|第|选|选择|看|看看|打开|进入|接管|继续|用)({zh_pattern})(?:个|项|号|项目|会话|技能)?\", compact)\n"
        "    if zh_match:\n"
        "        return _chinese_choice_number(zh_match.group(1))\n"
        "    return None\n\n\n"
        "def _chinese_choice_number(value: str) -> Optional[int]:\n"
        "    text = str(value or \"\").strip()\n"
        "    if not text:\n"
        "        return None\n"
        "    digits = {\n"
        "        \"零\": 0,\n"
        "        \"〇\": 0,\n"
        "        \"一\": 1,\n"
        "        \"二\": 2,\n"
        "        \"两\": 2,\n"
        "        \"三\": 3,\n"
        "        \"四\": 4,\n"
        "        \"五\": 5,\n"
        "        \"六\": 6,\n"
        "        \"七\": 7,\n"
        "        \"八\": 8,\n"
        "        \"九\": 9,\n"
        "    }\n"
        "    if text in digits:\n"
        "        return digits[text]\n"
        "    if text == \"十\":\n"
        "        return 10\n"
        "    if \"十\" in text:\n"
        "        left, right = text.split(\"十\", 1)\n"
        "        tens = digits.get(left, 1 if left == \"\" else None)\n"
        "        ones = digits.get(right, 0 if right == \"\" else None)\n"
        "        if tens is None or ones is None:\n"
        "            return None\n"
        "        return tens * 10 + ones\n"
        "    return None\n"
    )
    pattern = (
        r"def _extract_choice_number\(text: str\) -> Optional\[int\]:\n"
        r".*?\n\n"
        r"def _chinese_choice_number\(value: str\) -> Optional\[int\]:\n"
        r".*?\n\n"
    )
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.DOTALL)
    if count:
        return updated
    pattern = (
        r"def _extract_choice_number\(text: str\) -> Optional\[int\]:\n"
        r".*?\n\n"
    )
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.DOTALL)
    require(count == 1, "choice number helper anchor not found")
    return updated


def ensure_selection_state_ttl(text: str) -> str:
    return text.replace("ttl_seconds: int = 900", "ttl_seconds: int = 3600")


def ensure_selection_session_summary(text: str) -> str:
    if '"last_assistant_summary": str(item.get("last_assistant_summary") or ""),' in text:
        return text
    old = (
        '        "cwd": str(item.get("cwd") or item.get("project_path") or item.get("projectPath") or ""),\n'
        '        "archived": bool(item.get("archived")),\n'
    )
    new = (
        '        "cwd": str(item.get("cwd") or item.get("project_path") or item.get("projectPath") or ""),\n'
        '        "last_assistant_summary": str(item.get("last_assistant_summary") or ""),\n'
        '        "archived": bool(item.get("archived")),\n'
    )
    require(old in text, "selection session summary anchor not found")
    return text.replace(old, new)


def ensure_request_helpers(text: str) -> str:
    if "async def _request_capabilities_payload" in text:
        return text
    anchor = (
        "    async def _request_projects_payload(self) -> Optional[Dict[str, Any]]:\n"
        "        request_id = f\"projects_{int(time.time() * 1000)}\"\n"
        "        loop = asyncio.get_running_loop()\n"
        "        waiter = loop.create_future()\n"
        "        self._request_waiters[request_id] = waiter\n"
        "        await self._send_to_client({\"type\": \"projects.list\", \"request_id\": request_id})\n"
        "        try:\n"
        "            return await asyncio.wait_for(waiter, timeout=10)\n"
        "        except asyncio.TimeoutError:\n"
        "            self._request_waiters.pop(request_id, None)\n"
        "            return None\n"
    )
    addition = (
        "\n"
        "    async def _history(self, event: Any = None, text: str = \"\") -> str:\n"
        "        if not self.online:\n"
        "            return \"本地 Codex 桥接未在线，无法读取历史会话。\"\n"
        "        request_id = f\"history_{int(time.time() * 1000)}\"\n"
        "        loop = asyncio.get_running_loop()\n"
        "        waiter = loop.create_future()\n"
        "        self._request_waiters[request_id] = waiter\n"
        "        await self._send_to_client({\n"
        "            \"type\": \"history.query\",\n"
        "            \"request_id\": request_id,\n"
        "            \"project_query\": _history_project_query(text),\n"
        "            \"since_days\": _history_since_days(text),\n"
        "            \"max_items\": 12,\n"
        "        })\n"
        "        try:\n"
        "            payload = await asyncio.wait_for(waiter, timeout=10)\n"
        "        except asyncio.TimeoutError:\n"
        "            self._request_waiters.pop(request_id, None)\n"
        "            return \"Codex 历史会话请求超时\"\n"
        "        sessions = payload.get(\"sessions\") or []\n"
        "        if event is not None and sessions:\n"
        "            self._selection_state.set(self._conversation_id(event), \"history\", {\"sessions\": sessions})\n"
        "        return format_history_selection(payload)\n"
        "\n"
        "    async def _capabilities(self, event: Any = None) -> str:\n"
        "        if not self.online:\n"
        "            return \"本地 Codex 桥接未在线，无法读取插件/技能。\"\n"
        "        payload = await self._request_capabilities_payload()\n"
        "        if payload is None:\n"
        "            return \"Codex 插件/技能列表请求超时\"\n"
        "        capabilities = payload.get(\"capabilities\") or []\n"
        "        if event is not None and capabilities:\n"
        "            self._selection_state.set(self._conversation_id(event), \"capabilities\", {\"capabilities\": capabilities})\n"
        "        return format_capability_selection(capabilities)\n"
        "\n"
        "    async def _request_capabilities_payload(self) -> Optional[Dict[str, Any]]:\n"
        "        request_id = f\"capabilities_{int(time.time() * 1000)}\"\n"
        "        loop = asyncio.get_running_loop()\n"
        "        waiter = loop.create_future()\n"
        "        self._request_waiters[request_id] = waiter\n"
        "        await self._send_to_client({\"type\": \"runtime_capabilities.list\", \"request_id\": request_id})\n"
        "        try:\n"
        "            return await asyncio.wait_for(waiter, timeout=10)\n"
        "        except asyncio.TimeoutError:\n"
        "            self._request_waiters.pop(request_id, None)\n"
        "            return None\n"
        "\n"
        "    async def _capability_prompt_for_query(self, event: Any, text: str) -> Optional[str]:\n"
        "        payload = await self._request_capabilities_payload()\n"
        "        if not payload:\n"
        "            return None\n"
        "        capability = find_capability_by_query(payload.get(\"capabilities\") or [], text)\n"
        "        if not capability:\n"
        "            return None\n"
        "        return build_capability_prompt(capability, text)\n"
        "\n"
        "    async def _project_for_query(self, event: Any, text: str) -> Optional[Dict[str, Any]]:\n"
        "        payload = await self._request_projects_payload()\n"
        "        if not payload:\n"
        "            return None\n"
        "        summary = _summarize_projects_payload(self._client_id or \"codex-client\", payload)\n"
        "        selection = _build_project_selection_payload(payload, summary)\n"
        "        project = _find_selection_project_by_query(selection, text)\n"
        "        if project:\n"
        "            return project\n"
        "        choice = extract_project_reference_number(text)\n"
        "        if choice is None:\n"
        "            return None\n"
        "        conversation_id = self._conversation_id(event) if event is not None else None\n"
        "        state = self._selection_state.get(conversation_id) if conversation_id else None\n"
        "        if not state or state.get(\"state_type\") != \"projects\":\n"
        "            state = self._selection_state.latest(\"projects\")\n"
        "        state_projects = ((state or {}).get(\"payload\") or {}).get(\"projects\") or []\n"
        "        projects = state_projects or selection.get(\"projects\") or []\n"
        "        if 1 <= choice <= len(projects):\n"
        "            return projects[choice - 1]\n"
        "        return None\n"
    )
    require(anchor in text, "request projects insertion anchor not found")
    return text.replace(anchor, anchor + addition)


def ensure_running_tasks_status_helpers(text: str) -> str:
    if "async def _running_tasks_status" in text:
        return text
    anchor = "    async def _capability_prompt_for_query(self, event: Any, text: str) -> Optional[str]:\n"
    addition = (
        "    async def _running_tasks_status(self, event: Any = None) -> str:\n"
        "        if not self.online:\n"
        "            return \"本地 Codex 桥接未在线，无法读取正在运行的任务。\"\n"
        "        payload = await self._request_app_tasks_status_payload()\n"
        "        if payload is None:\n"
        "            return \"Codex 运行任务状态请求超时\"\n"
        "        return format_running_tasks_status(payload)\n"
        "\n"
        "    async def _request_app_tasks_status_payload(self) -> Optional[Dict[str, Any]]:\n"
        "        request_id = f\"app_tasks_{int(time.time() * 1000)}\"\n"
        "        loop = asyncio.get_running_loop()\n"
        "        waiter = loop.create_future()\n"
        "        self._request_waiters[request_id] = waiter\n"
        "        await self._send_to_client({\"type\": \"app_tasks.status\", \"request_id\": request_id, \"window_seconds\": 180})\n"
        "        try:\n"
        "            return await asyncio.wait_for(waiter, timeout=10)\n"
        "        except asyncio.TimeoutError:\n"
        "            self._request_waiters.pop(request_id, None)\n"
        "            return None\n"
        "\n"
    )
    require(anchor in text, "running tasks helper anchor not found")
    return text.replace(anchor, addition + anchor, 1)


def ensure_new_session_project_resolution(text: str) -> str:
    text = text.replace("project = await self._project_for_query(text)", "project = await self._project_for_query(event, text)")
    old = (
        "    async def _project_for_query(self, text: str) -> Optional[Dict[str, Any]]:\n"
        "        payload = await self._request_projects_payload()\n"
        "        if not payload:\n"
        "            return None\n"
        "        summary = _summarize_projects_payload(self._client_id or \"codex-client\", payload)\n"
        "        selection = _build_project_selection_payload(payload, summary)\n"
        "        return _find_selection_project_by_query(selection, text)\n"
    )
    new = (
        "    async def _project_for_query(self, event: Any, text: str) -> Optional[Dict[str, Any]]:\n"
        "        payload = await self._request_projects_payload()\n"
        "        if not payload:\n"
        "            return None\n"
        "        summary = _summarize_projects_payload(self._client_id or \"codex-client\", payload)\n"
        "        selection = _build_project_selection_payload(payload, summary)\n"
        "        project = _find_selection_project_by_query(selection, text)\n"
        "        if project:\n"
        "            return project\n"
        "        choice = extract_project_reference_number(text)\n"
        "        if choice is None:\n"
        "            return None\n"
        "        conversation_id = self._conversation_id(event) if event is not None else None\n"
        "        state = self._selection_state.get(conversation_id) if conversation_id else None\n"
        "        if not state or state.get(\"state_type\") != \"projects\":\n"
        "            state = self._selection_state.latest(\"projects\")\n"
        "        state_projects = ((state or {}).get(\"payload\") or {}).get(\"projects\") or []\n"
        "        projects = state_projects or selection.get(\"projects\") or []\n"
        "        if 1 <= choice <= len(projects):\n"
        "            return projects[choice - 1]\n"
        "        return None\n"
    )
    if old in text:
        return text.replace(old, new)
    return text


def ensure_history_helpers(text: str) -> str:
    if "def _history_project_query" in text:
        return text
    return (
        text
        + "\n\n"
        + "def _history_project_query(text: str) -> str:\n"
        + "    match = re.search(r\"([0-9A-Za-z_\\\\-\\\\u4e00-\\\\u9fff]+)项目\", str(text or \"\"))\n"
        + "    return match.group(1) if match else str(text or \"\")\n\n\n"
        + "def _history_since_days(text: str) -> int:\n"
        + "    value = str(text or \"\")\n"
        + "    if \"今天\" in value:\n"
        + "        return 1\n"
        + "    if \"昨天\" in value or \"这几天\" in value or \"最近\" in value:\n"
        + "        return 7\n"
        + "    if \"本周\" in value:\n"
        + "        return 14\n"
        + "    return 30\n"
    )


def ensure_mobile_formatters(text: str) -> str:
    replacements = {
        "_format_project_selection(selection)": "format_project_selection(selection)",
        "_format_session_selection(project, sessions)": "format_session_selection(project, sessions)",
        "_format_new_session_prompt(project)": "format_new_session_prompt(project)",
        "_format_session_bound(project, session)": "format_session_bound(project, session)",
        (
            "        current = self._mobile_context.get_current(\n"
            "            self._conversation_id(event) if event is not None else None\n"
            "        )\n"
            "        if current:\n"
            "            text += \"\\n\\n\" + self._format_current_app_session(event, compact=True)\n"
            "        return text\n"
        ): "        return text\n",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def ensure_app_session_summary_is_reply_only(text: str) -> str:
    if "if is_app_session and text:\n        return _compact_codex_text(text, MAX_WECHAT_MESSAGE_LENGTH)" in text:
        return text
    old = (
        "    if is_app_session and text:\n"
        '        lines = ["✓ Codex App 会话任务完成"]\n'
        "        if isinstance(app_session, dict):\n"
        '            session_name = str(app_session.get("thread_name") or app_session.get("session_id") or "").strip()\n'
        "            if session_name:\n"
        '                lines.append(f"会话：{session_name}")\n'
        '            cwd = str(app_session.get("cwd") or app_session.get("project_path") or "").strip()\n'
        "            if cwd:\n"
        '                lines.append(f"工作目录：{cwd}")\n'
        '        lines.append("回答：\\n" + _compact_codex_text(text, 1800))\n'
        '        lines.append("下一步：继续发需求即可接着该 Codex App 会话迭代。")\n'
        '        return _compact_codex_text("\\n\\n".join(lines), MAX_WECHAT_MESSAGE_LENGTH)\n'
    )
    new = (
        "    if is_app_session and text:\n"
        "        return _compact_codex_text(text, MAX_WECHAT_MESSAGE_LENGTH)\n"
    )
    require(old in text, "app session summary anchor not found")
    return text.replace(old, new)


def ensure_wecom_proactive_markdown(text: str) -> str:
    helper = (
        "\n\n"
        "def _should_force_proactive_markdown(content: Any) -> bool:\n"
        "    text = str(content or \"\").lstrip()\n"
        "    return bool(\n"
        "        re.match(\n"
        "            r\"^(?:\\*\\*)?Codex (?:项目|历史|能力|会话)\",\n"
        "            text,\n"
        "        )\n"
        "        or re.match(r\"^(?:\\*\\*)?[^\\n]{1,60} 会话（\\d+ 个）\", text)\n"
        "    )\n"
    )
    old = (
        "        if reply_req_id and self._reply_stream_supported_by_chat.get(chat_id, True):\n"
        "            try:\n"
        "                response = await self._send_reply_stream(reply_req_id, content)\n"
    )
    new = (
        "        if (\n"
        "            reply_req_id\n"
        "            and self._reply_stream_supported_by_chat.get(chat_id, True)\n"
        "            and not _should_force_proactive_markdown(content)\n"
        "        ):\n"
        "            try:\n"
        "                response = await self._send_reply_stream(reply_req_id, content)\n"
    )
    if "_should_force_proactive_markdown(content)" not in text:
        require(old in text, "wecom reply stream anchor not found")
        text = text.replace(old, new)

    if "def _should_force_proactive_markdown" in text:
        return re.sub(
            r"\n\ndef _should_force_proactive_markdown\(content: Any\) -> bool:\n.*?(?=\n\nclass WeComAdapter)",
            lambda _match: helper,
            text,
            flags=re.DOTALL,
        )
    anchor = "\n\nclass WeComAdapter(BasePlatformAdapter):\n"
    require(anchor in text, "wecom helper insertion anchor not found")
    return text.replace(anchor, helper + anchor)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


if __name__ == "__main__":
    main()
