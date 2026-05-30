import unittest
from typing import Optional

from scripts.apply_remote_patch import (
    ensure_app_session_summary_is_reply_only,
    ensure_bound_app_session_before_classifier,
    ensure_capability_uses_bound_app_session,
    ensure_import,
    ensure_natural_choice_number,
    ensure_natural_control_pipeline,
    ensure_new_session_project_resolution,
    ensure_numeric_selection_fallback,
    ensure_running_tasks_status_helpers,
    ensure_selection_session_summary,
    ensure_selection_state_ttl,
    ensure_waiter_types,
    ensure_wecom_proactive_markdown,
)


class ApplyRemotePatchTests(unittest.TestCase):
    def test_app_session_summary_returns_reply_only(self):
        source = '''
def _build_codex_wechat_summary(result: Dict[str, Any]) -> str:
    is_app_session = bool(result.get("app_session"))
    text = "done"
    app_session = result.get("app_session")

    if is_app_session and text:
        lines = ["✓ Codex App 会话任务完成"]
        if isinstance(app_session, dict):
            session_name = str(app_session.get("thread_name") or app_session.get("session_id") or "").strip()
            if session_name:
                lines.append(f"会话：{session_name}")
            cwd = str(app_session.get("cwd") or app_session.get("project_path") or "").strip()
            if cwd:
                lines.append(f"工作目录：{cwd}")
        lines.append("回答：\\n" + _compact_codex_text(text, 1800))
        lines.append("下一步：继续发需求即可接着该 Codex App 会话迭代。")
        return _compact_codex_text("\\n\\n".join(lines), MAX_WECHAT_MESSAGE_LENGTH)
'''
        patched = ensure_app_session_summary_is_reply_only(source)

        self.assertIn("return _compact_codex_text(text, MAX_WECHAT_MESSAGE_LENGTH)", patched)
        self.assertNotIn("工作目录", patched)
        self.assertNotIn("下一步", patched)

    def test_bound_app_session_routes_before_classifier(self):
        source = '''
        current_app_session = self._infer_current_app_session_selector(event, text)
        if current_app_session:
            return await self._start_job(
                event,
                text,
                execution_mode="app_session",
                app_session=current_app_session,
                quiet_ack=True,
            )

        decision = await self._decide_natural_route(event, text)
'''
        patched = ensure_bound_app_session_before_classifier(source)

        self.assertLess(
            patched.index("bound_app_session = self._infer_bound_app_session_selector(event, text)"),
            patched.index("decision = await self._decide_natural_route(event, text)"),
        )
        self.assertIn("app_session=bound_app_session", patched)

    def test_capability_use_prefers_bound_app_session(self):
        source = '''
        if mobile_intent == "use_capability":
            capability_prompt = await self._capability_prompt_for_query(event, text)
            if capability_prompt:
                current_app_session = self._infer_current_app_session_selector(event, text)
                return await self._start_job(
                    event,
                    capability_prompt,
                    execution_mode="app_session" if current_app_session else None,
                    app_session=current_app_session,
                    quiet_ack=True,
                )
'''
        patched = ensure_capability_uses_bound_app_session(source)

        self.assertIn("or self._infer_bound_app_session_selector(event, text)", patched)

    def test_numeric_selection_without_state_returns_mobile_hint(self):
        source = '''
    async def _try_handle_selection_reply(self, event: Any, text: str) -> Optional[str]:
        conversation_id = self._conversation_id(event)
        state = self._selection_state.get(conversation_id)
        choice = _extract_choice_number(text)
        if not state and choice is not None:
            state = self._selection_state.latest("projects")
        if not state:
            return None
        return "handled"
'''
        patched = ensure_numeric_selection_fallback(source)

        self.assertIn("当前没有可用的序号清单", patched)
        self.assertIn('self._selection_state.latest("sessions")', patched)
        self.assertIn('self._selection_state.latest("capabilities")', patched)

    def test_selection_state_ttl_is_mobile_friendly(self):
        source = '''
    def set(
        self,
        conversation_id: str,
        state_type: str,
        payload: Dict[str, Any],
        *,
        ttl_seconds: int = 900,
    ) -> None:
        pass
'''
        patched = ensure_selection_state_ttl(source)

        self.assertIn("ttl_seconds: int = 3600", patched)
        self.assertNotIn("ttl_seconds: int = 900", patched)

    def test_new_session_project_query_uses_event_selection_context(self):
        source = '''
        mobile_intent = detect_mobile_intent(text)
        if mobile_intent == "new_session":
            project = await self._project_for_query(text)
            app_session = {"mode": "new", "project_path": project.get("path")} if project else {"mode": "new", "scope": "projectless"}

    async def _project_for_query(self, text: str) -> Optional[Dict[str, Any]]:
        payload = await self._request_projects_payload()
        if not payload:
            return None
        summary = _summarize_projects_payload(self._client_id or "codex-client", payload)
        selection = _build_project_selection_payload(payload, summary)
        return _find_selection_project_by_query(selection, text)
'''
        patched = ensure_new_session_project_resolution(source)

        self.assertIn("project = await self._project_for_query(event, text)", patched)
        self.assertIn("extract_project_reference_number(text)", patched)
        self.assertIn('self._selection_state.latest("projects")', patched)
        self.assertIn("projects[choice - 1]", patched)

    def test_import_patch_adds_project_reference_helper(self):
        source = "from gateway.config import Platform\n"
        patched = ensure_import(source)

        self.assertIn("extract_project_reference_number", patched)
        self.assertIn("format_mobile_help", patched)
        self.assertIn("format_running_tasks_status", patched)

    def test_natural_control_pipeline_adds_mobile_help(self):
        source = '''
        if self._looks_like_project_sessions_query(compact, text):
            return await self._project_sessions_for_query(event, text)

        if self._looks_like_current_session_query(compact, text):
            return self._format_current_app_session(event)

        if self._looks_like_projects_query(compact, text):
            return await self._projects(event)
'''
        patched = ensure_natural_control_pipeline(source)

        self.assertIn('mobile_intent == "mobile_help"', patched)
        self.assertIn("return format_mobile_help()", patched)
        self.assertIn('mobile_intent == "running_tasks_status"', patched)
        self.assertIn("return await self._running_tasks_status(event)", patched)

    def test_waiter_types_adds_app_tasks_result(self):
        source = '''
        if message_type in {
            "app_sessions",
            "app_sessions.result",
        }:
            waiter.set_result(payload)
'''
        patched = ensure_waiter_types(source)

        self.assertIn('"history.result"', patched)
        self.assertIn('"runtime_capabilities.result"', patched)
        self.assertIn('"app_tasks.result"', patched)

    def test_running_tasks_status_helper_requests_sidecar_status(self):
        source = '''
    async def _capability_prompt_for_query(self, event: Any, text: str) -> Optional[str]:
        return None
'''
        patched = ensure_running_tasks_status_helpers(source)

        self.assertIn("async def _running_tasks_status", patched)
        self.assertIn('"type": "app_tasks.status"', patched)
        self.assertIn("format_running_tasks_status(payload)", patched)

    def test_choice_number_patch_accepts_memorable_phrases(self):
        source = '''
def _extract_choice_number(text: str) -> Optional[int]:
    match = re.search(r"^\\s*(\\d{1,3})\\s*$", str(text or ""))
    return int(match.group(1)) if match else None

'''
        patched = ensure_natural_choice_number(source)
        namespace = {"Optional": Optional, "re": __import__("re")}
        exec(patched, namespace)
        parser = namespace["_extract_choice_number"]

        self.assertEqual(parser("选第2个项目"), 2)
        self.assertEqual(parser("接管第十个会话"), 10)
        self.assertEqual(parser("用第十二个技能"), 12)
        self.assertIsNone(parser("我有2个问题"))

    def test_selection_session_row_preserves_last_assistant_summary(self):
        source = '''
def _selection_session_row(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(item.get("id") or item.get("session_id") or ""),
        "thread_name": str(item.get("thread_name") or item.get("title") or item.get("session_title") or "Untitled"),
        "updated_at": str(item.get("updated_at") or ""),
        "cwd": str(item.get("cwd") or item.get("project_path") or item.get("projectPath") or ""),
        "archived": bool(item.get("archived")),
    }
'''
        patched = ensure_selection_session_summary(source)

        self.assertIn('"last_assistant_summary": str(item.get("last_assistant_summary") or ""),', patched)

    def test_wecom_patch_forces_codex_lists_to_proactive_markdown(self):
        source = '''
from __future__ import annotations
from typing import Any
import re


class WeComAdapter(BasePlatformAdapter):
    async def _send_markdown_with_reply_fallback(
        self,
        chat_id: str,
        content: str,
        reply_req_id: Optional[str],
    ) -> Dict[str, Any]:
        if reply_req_id and self._reply_stream_supported_by_chat.get(chat_id, True):
            try:
                response = await self._send_reply_stream(reply_req_id, content)
                self._reply_stream_supported_by_chat[chat_id] = True
                return response
            except Exception:
                raise
        return await self._send_markdown_message(chat_id, content)
'''
        patched = ensure_wecom_proactive_markdown(source)

        self.assertIn("def _should_force_proactive_markdown", patched)
        self.assertIn("and not _should_force_proactive_markdown(content)", patched)
        namespace = {"BasePlatformAdapter": object, "Optional": object, "Dict": dict, "Any": object, "re": __import__("re")}
        exec(patched, namespace)
        detector = namespace["_should_force_proactive_markdown"]
        self.assertTrue(detector("**Codex 项目（4 个）**\n\n1. `demo`"))
        self.assertTrue(detector("ielts-vocab 会话（3 个）\n\n0. 新建会话"))
        self.assertFalse(detector("普通 Hermes 回复"))

    def test_wecom_patch_is_idempotent_when_helper_exists(self):
        source = '''
from __future__ import annotations
from typing import Any
import re


def _should_force_proactive_markdown(content: Any) -> bool:
    return False


class WeComAdapter(BasePlatformAdapter):
    async def _send_markdown_with_reply_fallback(
        self,
        chat_id: str,
        content: str,
        reply_req_id: Optional[str],
    ) -> Dict[str, Any]:
        if (
            reply_req_id
            and self._reply_stream_supported_by_chat.get(chat_id, True)
            and not _should_force_proactive_markdown(content)
        ):
            try:
                response = await self._send_reply_stream(reply_req_id, content)
                self._reply_stream_supported_by_chat[chat_id] = True
                return response
            except Exception:
                raise
        return await self._send_markdown_message(chat_id, content)
'''
        patched = ensure_wecom_proactive_markdown(source)
        namespace = {"BasePlatformAdapter": object, "Optional": object, "Dict": dict, "Any": object, "re": __import__("re")}
        exec(patched, namespace)
        self.assertTrue(namespace["_should_force_proactive_markdown"]("**Codex 项目（4 个）**"))


if __name__ == "__main__":
    unittest.main()
