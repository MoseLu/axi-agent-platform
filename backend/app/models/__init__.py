from .base import BaseModelConnector, Message, ModelResponse
from .minimax import MiniMaxConnector

__all__ = [
    "BaseModelConnector", "Message", "ModelResponse",
    "MiniMaxConnector", "OpenAIConnector"
]


def __getattr__(name):
    # PEP 562: defer the heavy `openai` package import until instantiation.
    # The `openai` SDK pulls a large pydantic-driven types tree (~370ms cold)
    # that is unused until a request actually needs the OpenAI connector.
    # Returning a proxy class means `from app.models import OpenAIConnector`
    # stays cheap, and `OpenAIConnector(...)` triggers the real import on first
    # construction rather than at module import time.
    if name == "OpenAIConnector":
        class _LazyOpenAIConnector:
            """Lazy proxy: defers `openai` import until the connector is built."""

            def __new__(cls, *args, **kwargs):
                from .openai import OpenAIConnector as _RealOpenAIConnector
                return _RealOpenAIConnector(*args, **kwargs)

        _LazyOpenAIConnector.__name__ = "OpenAIConnector"
        _LazyOpenAIConnector.__qualname__ = "OpenAIConnector"
        return _LazyOpenAIConnector
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
