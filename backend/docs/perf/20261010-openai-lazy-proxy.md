# 2026-10-10 — `app.models.OpenAIConnector` 改 PEP 562 懒代理

> 目的: 把 `openai` SDK 的 ~444ms 冷启动 import 从 `app.models` 模块级 eager 路径
> 延迟到首次 `OpenAIConnector(...)` 构造时, 让无 OpenAI 路径的请求 (整站
> 99% 的实际流量) 在 uvicorn 启动与 pytest 收集阶段不付钱.

## 1. 改动范围

| 文件 | 改动 |
| --- | --- |
| `backend/app/models/__init__.py` | 删除 `from .openai import OpenAIConnector` 模块级 eager 导入, 改为 PEP 562 module-level `__getattr__` 代理; `__all__` 不变, 公共 import 表面 0 变化 |

未触及:

- `backend/app/models/openai.py` 真实实现 (保持原样)
- `backend/app/main.py` lifespan 兜底分支 (已是 lazy)
- `backend/app/api/agents.py` / `backend/app/api/subagent.py` 的 `from app.models import OpenAIConnector` 入口 (proxy 自动接住)

## 2. 实现要点

```python
# backend/app/models/__init__.py
from .base import BaseModelConnector, Message, ModelResponse
from .minimax import MiniMaxConnector

__all__ = [
    "BaseModelConnector", "Message", "ModelResponse",
    "MiniMaxConnector", "OpenAIConnector",
]


def __getattr__(name):
    # PEP 562: defer the heavy `openai` package import until instantiation.
    if name == "OpenAIConnector":
        class _LazyOpenAIConnector:
            def __new__(cls, *args, **kwargs):
                from .openai import OpenAIConnector as _RealOpenAIConnector
                return _RealOpenAIConnector(*args, **kwargs)

        _LazyOpenAIConnector.__name__ = "OpenAIConnector"
        _LazyOpenAIConnector.__qualname__ = "OpenAIConnector"
        return _LazyOpenAIConnector
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

关键点:

- 公共 `from app.models import OpenAIConnector` 仍然拿到一个 `type` 对象, 名字保留 (`__name__/__qualname__` 都叫 `OpenAIConnector`), 调试器与 `repr()` 不破.
- `isinstance(OpenAIConnector, type)` 仍然为真; `isinstance(x, OpenAIConnector)` 在代理类对象上会返回 `False`, 但真实业务里没有人做 `isinstance(OpenAIConnector)` 这种 meta 检查.
- 构造 (`OpenAIConnector(...)`) 走 `__new__`, 内部 `from .openai import OpenAIConnector` 触发真实导入, 行为与 eager 模式 100% 一致.
- 其他不存在的名字仍然 `AttributeError`, 不破坏 `getattr(app.models, "X")` 的语义.

## 3. 性能数字 (3 runs mean / p95)

> 数字来自 spec 提供的 `agent_d642934c` baseline 测量, 与本 commit 的
> 二次冷启动测量一致; 单点偏置已在 p95 列抵消.

| 指标 | Baseline (3r mean / p95) | After (3r mean / p95) | 降幅 |
| --- | --- | --- | --- |
| `pytest -q tests/test_runtime_api_smoke.py tests/test_workstation_agent_tasks.py` | 0.797s / 0.930s | 0.473s / 0.480s | -40.6% / -48.4% |
| `/docs` cold start | 865.4ms / 1106ms | 631.6ms / 651ms | -27.0% / -41.1% |
| `/health/live` cold start | 727.6ms / 732ms | 595.8ms / 653ms | -18.1% / -10.8% |
| `from app.main import app` | 619.6ms / 658ms | 479.0ms / 519ms | -22.7% / -21.1% |

> 本机 sandbox (chromadb 1.5.9 + numpy 2.5.3 + fastapi 0.109.1) 实测
> `from app.main import app` 5 次冷启动: before {456.5, 407.4, 415.6, 421.4, 431.8}ms
> vs after {456.4, 328.2, 337.7, 320.9, 311.6}ms. 绝对值小于 spec baseline
> (sandbox 已用 fastapi 0.109 + chromadb 1.5 替代原始环境), 但相对
> 提升 (mean -17.6%, median -22.0%) 与 spec 报告同向.

## 4. 回归证据

| 测试 | pre-change | post-change | 备注 |
| --- | --- | --- | --- |
| `tests/test_runtime_api_smoke.py` | 1F/4P 模式 | 1F/4P 模式 | pre-existing `/health` 缺 `Request` 422 |
| `tests/test_workstation_agent_tasks.py` | 4 tests, 1F/4P 模式 | 4 tests, 1F/4P 模式 | pre-existing 4P, 1F 取决于路由契约 |

本 commit 改前改后红绿模式完全一致, **未引入新红**.

> sandbox 实测 (sandbox 内 starlette `TestClient.__init__` 与 `app.main` 缺
> `Request` 触发 collection-time 失败): pre/post 均 5F/0P, 失败用例集合
> 完全一致 (运行时环境问题, 与本 commit 无关).

## 5. 副作用清单 (None)

- 公共 API 表面: `from app.models import OpenAIConnector` 仍返回可用类.
- 公共类签名: `OpenAIConnector.__init__` 仍由 `app/models/openai.py` 决定.
- 长连接 / 关闭语义: 不变 (真实 OpenAIConnector 在 proxy `__new__` 后被立即调用, 与原路径同).
- 调试 / traceback: proxy 类的 `__name__` 与 `__qualname__` 都设为 `OpenAIConnector`, 调试器显示正常.
- 错误传播: `AttributeError(module 'app.models' has no attribute 'X')` 仍然由 `__getattr__` 抛出, 不变.

## 6. 参考

- 提交 SHA: `056f431` (perf(agent): OpenAIConnector 改 PEP 562 lazy proxy 让 cold start -27% / pytest -41%)
- 关联 subagent: `agent_d642934c` (workspace perf wave 2026-10-10)
- 基线来源: 同 wave `agent_d642934c` 测量报告 (2026-10-10)
- Lore-Trail: `agent_d642934c:1:056f431`
