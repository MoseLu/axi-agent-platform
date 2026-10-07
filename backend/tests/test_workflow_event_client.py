import asyncio

from app.core.workflow_event_client import WorkflowLifecycleEventPublisher
from app.schemas.task import TaskExecutionEvent, TaskRoute


def test_lifecycle_publisher_uses_authenticated_v1_envelope_without_raw_context(monkeypatch):
    requests = []

    class FakeResponse:
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *, json, headers):
            requests.append({"url": url, "json": json, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr("app.core.workflow_event_client.httpx.AsyncClient", FakeAsyncClient)
    event = TaskExecutionEvent(
        task_id="agent-task-telemetry-1",
        event_type="completed",
        message="raw prompt must not leave the runtime",
        data={"status": "completed", "output": "sensitive raw result"},
        traceId="trace-lifecycle-client-test",
        idempotencyKey="idempotency-lifecycle-client-test",
        route=TaskRoute.BOUNDED_AGENT,
        policyVersion="task-execution-routing/v1",
    )

    asyncio.run(
        WorkflowLifecycleEventPublisher(
            sink_url="https://workflow.internal/internal/events",
            internal_token="internal-test-token",
        ).publish(event)
    )

    assert len(requests) == 1
    request = requests[0]
    assert request["url"].endswith("/internal/events")
    assert request["headers"]["X-Axi-Internal-Token"] == "internal-test-token"
    assert request["headers"]["X-Axi-Event-Producer"] == "agent-platform"
    assert request["json"]["topic"] == "agent.result"
    assert request["json"]["traceId"] == "trace-lifecycle-client-test"
    assert request["json"]["payload"]["data"] == {"status": "completed"}
    assert "sensitive raw result" not in str(request["json"])
    assert "raw prompt" not in str(request["json"])


def test_lifecycle_publisher_emits_trace_v2_when_trace_sink_is_configured(monkeypatch):
    requests = []

    class FakeResponse:
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None

        async def post(self, url, *, json, headers):
            requests.append({"url": url, "json": json, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr("app.core.workflow_event_client.httpx.AsyncClient", FakeAsyncClient)
    event = TaskExecutionEvent(task_id="task-trace", event_type="completed", message="trace complete", data={"status": "completed"}, traceId="trace-v2-agent", idempotencyKey="idem-v2-agent", route=TaskRoute.BOUNDED_AGENT, policyVersion="routing/v1")
    asyncio.run(WorkflowLifecycleEventPublisher(sink_url="http://events", internal_token="event-token", trace_sink_url="http://traces", trace_token="trace-token").publish(event))
    assert requests[1]["url"] == "http://traces"
    assert requests[1]["headers"]["X-Axi-Service-Token"] == "trace-token"
    assert requests[1]["json"]["traceId"] == "trace-v2-agent"
    assert requests[1]["json"]["span"]["name"] == "agent.result"
