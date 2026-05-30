import unittest

from gateway.mobile_orchestration import (
    build_capability_prompt,
    detect_mobile_intent,
    extract_choice_number,
    extract_project_reference_number,
    find_capability_by_query,
    format_capability_selection,
    format_history_selection,
    format_mobile_help,
    format_project_selection,
    format_running_tasks_status,
    format_session_bound,
    format_session_selection,
)


class MobileOrchestrationTests(unittest.TestCase):
    def test_q1_project_list_intent(self):
        self.assertEqual(detect_mobile_intent("目前codex有哪些项目？"), "list_projects")
        self.assertEqual(detect_mobile_intent("当前有哪些项目文件夹"), "list_projects")
        self.assertEqual(detect_mobile_intent("我们目前有几个项目"), "list_projects")
        self.assertEqual(detect_mobile_intent("目前有多少个项目"), "list_projects")
        self.assertEqual(detect_mobile_intent("怎么用"), "mobile_help")
        self.assertEqual(detect_mobile_intent("能说什么"), "mobile_help")

    def test_q2_project_sessions_intent(self):
        self.assertEqual(detect_mobile_intent("项目a有哪些会话？"), "list_project_sessions")
        self.assertEqual(detect_mobile_intent("项目a有几个会话？"), "list_project_sessions")

    def test_q3_resume_session_intent(self):
        self.assertEqual(detect_mobile_intent("我们继续会话xx，接下来开始修改功能xxx"), "resume_session")

    def test_q4_new_session_intent(self):
        self.assertEqual(detect_mobile_intent("我们新开会话，要做一个新的账单模块"), "new_session")

    def test_q5_history_summary_intent_and_formatting(self):
        self.assertEqual(detect_mobile_intent("这几天a项目我们做了哪些功能？"), "history_summary")
        text = format_history_selection(
            {
                "sessions": [
                    {
                        "thread_name": "补上 artifact 发布 OSS",
                        "project_name": "ielts-vocab",
                        "updated_at": "2026-04-29T10:13:47Z",
                        "evidence_snippets": ["增加 artifact OSS 发布脚本，并验证上传参数。"],
                    }
                ]
            }
        )
        self.assertIn("**Codex 历史（1 个，显示 1 个）**", text)
        self.assertIn("1. `04-29 18:13` · 补上 artifact 发布 OSS", text)
        self.assertIn("可以说：接管第1个会话。", text)
        self.assertNotIn("｜", text)
        self.assertNotIn("2026-04-29T10:13:47Z", text)

    def test_q6_capability_list_intent_and_formatting(self):
        self.assertEqual(detect_mobile_intent("目前有哪些可用插件或者技能"), "list_capabilities")
        text = format_capability_selection(
            [{"name": "git-commit-batch", "source": "skill", "description": "Group dirty changes."}]
        )
        self.assertIn("**Codex 能力（1 个，显示 1 个）**", text)
        self.assertIn("1. `git-commit-batch` · 本地技能", text)
        self.assertIn("本地技能", text)
        self.assertNotIn("｜", text)

    def test_running_tasks_status_intent_and_formatting(self):
        self.assertEqual(detect_mobile_intent("现在有几个在跑的任务"), "running_tasks_status")
        self.assertEqual(detect_mobile_intent("多少个任务正在运行"), "running_tasks_status")
        self.assertEqual(detect_mobile_intent("跑的怎么样了"), "running_tasks_status")
        self.assertEqual(detect_mobile_intent("1跑的怎么样了"), "running_tasks_status")
        self.assertEqual(detect_mobile_intent("任务进度如何"), "running_tasks_status")
        text = format_running_tasks_status(
            {
                "active_count": 3,
                "tasks": [
                    {
                        "thread_name": "Finish the WeChat IM phone handoff end to end",
                        "cwd": "/Volumes/code/workspace/projects/axi-workbench/apps/ollama-menu-assistant",
                    },
                    {
                        "thread_name": "已继续补全并安装 pet 图片",
                        "cwd": "/Volumes/code/workspace/projects/axi-workbench/apps/ollama-menu-assistant",
                    },
                    {
                        "thread_name": "在管理员页面增第四个选项",
                        "cwd": "/Volumes/code/workspace/products/ielts-vocab",
                    },
                ],
            }
        )

        self.assertIn("现在有 3 个任务在跑。", text)
        self.assertIn("1）Finish the WeChat IM phone handof… · ollama-menu-assistant", text)
        self.assertIn("3）在管理员页面增第四个选项 · ielts-vocab", text)
        self.assertNotIn("activeJobs", text)

    def test_mobile_project_and_session_lists_are_readable_on_wechat(self):
        projects_text = format_project_selection(
            {
                "projects": [
                    {"name": "codex-remote-bridge", "status_label": "本机发现", "sessions": [{}, {}]},
                    {"name": "ielts-vocab", "status_label": "本机发现", "sessions": [{}]},
                ]
            }
        )
        sessions_text = format_session_selection(
            {"name": "ielts-vocab"},
            [
                {
                    "thread_name": "拿到目前后端所有单词的音标，有很多音标都读错了",
                    "updated_at": "2026-04-29T16:55:44.537Z",
                    "last_assistant_summary": "已修复 Azure 音节切分和跟读缓存标签。",
                }
            ],
        )

        self.assertIn("**Codex 项目（2 个）**", projects_text)
        self.assertIn("可以说：选第2个项目、看看第二个。  \n1）codex-remote-bridge", projects_text)
        self.assertIn("1）codex-remote-bridge  \n会话：2 个", projects_text)
        self.assertIn("2）ielts-vocab  \n会话：1 个", projects_text)
        self.assertIn("0）新建会话  ", sessions_text)
        self.assertIn("1）拿到目前后端所有单词的音标，有很多音标都读错了  ", sessions_text)
        self.assertIn("时间：04-30 00:55  ", sessions_text)
        self.assertIn("04-30 00:55", sessions_text)
        self.assertIn("可以说：接管第1个会话，或新开一个会话。", sessions_text)
        self.assertNotIn("最后回复：", sessions_text)
        self.assertNotIn("摘要", projects_text + sessions_text)
        self.assertNotIn("｜", projects_text + sessions_text)
        self.assertNotIn("`", projects_text + sessions_text)
        self.assertNotIn("1. ", projects_text + sessions_text)

    def test_selected_session_bound_reply_includes_last_assistant_summary(self):
        text = format_session_bound(
            {"name": "ielts-vocab"},
            {
                "thread_name": "拿到目前后端所有单词的音标，有很多音标都读错了",
                "last_assistant_summary": "已修复 Azure 音节切分和跟读缓存标签。",
            },
        )

        self.assertIn("已接管 Codex App 会话", text)
        self.assertIn("最后回复：已修复 Azure 音节切分和跟读缓存标签。", text)

    def test_q7_capability_use_prompt(self):
        capabilities = [
            {
                "name": "git-commit-batch",
                "invocation_label": "git-commit-batch",
                "description": "Commit groups.",
            }
        ]
        capability = find_capability_by_query(capabilities, "用 git-commit-batch 技能提交当前仓库")

        self.assertEqual(detect_mobile_intent("用 git-commit-batch 技能提交当前仓库"), "use_capability")
        self.assertEqual(capability["name"], "git-commit-batch")
        prompt = build_capability_prompt(capability, "用 git-commit-batch 技能提交当前仓库")
        self.assertIn("Use this Codex runtime capability", prompt)
        self.assertIn("git-commit-batch", prompt)

    def test_choice_number_for_mobile_selection(self):
        self.assertEqual(extract_choice_number("1"), 1)
        self.assertEqual(extract_choice_number(" 12 "), 12)
        self.assertEqual(extract_choice_number("第1个"), 1)
        self.assertEqual(extract_choice_number("选第2个项目"), 2)
        self.assertEqual(extract_choice_number("接管第十个会话"), 10)
        self.assertEqual(extract_choice_number("看看第二个"), 2)
        self.assertEqual(extract_choice_number("用第十二个技能"), 12)
        self.assertIsNone(extract_choice_number("我有2个问题"))

    def test_project_reference_number_for_new_session_request(self):
        self.assertEqual(extract_project_reference_number("在3中新建会话"), 3)
        self.assertEqual(extract_project_reference_number("第3个项目新建会话"), 3)
        self.assertEqual(extract_project_reference_number("项目3创建一个新会话"), 3)
        self.assertIsNone(extract_project_reference_number("新建会话"))

    def test_mobile_help_is_memorable(self):
        text = format_mobile_help()

        self.assertIn("看看项目", text)
        self.assertIn("选第2个项目", text)
        self.assertIn("接管第1个会话", text)
        self.assertNotIn("/codex", text)
        self.assertNotIn("session list", text)


if __name__ == "__main__":
    unittest.main()
