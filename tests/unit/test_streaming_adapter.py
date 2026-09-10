import sys
from types import SimpleNamespace

import pytest

from hermes_voice.hermes_adapter import HermesAdapter, _stream_options
from hermes_voice.server import Job


def test_callback_capability_is_explicit(tmp_path):
    class Native:
        def __init__(self, stream_delta_callback=None):
            pass

    class Legacy:
        def __init__(self, **kwargs):
            pass

    job = Job("task", "sid", False, tmp_path, stream=True)
    assert _stream_options(Native, False, job) == {"stream_delta_callback": job.emit_text}
    assert _stream_options(Legacy, False, job) == {}
    assert _stream_options(Native, True, job) == {}
    job.stream = False
    assert _stream_options(Native, False, job) == {}


@pytest.mark.parametrize("native,worker", [(True, False), (False, False), (True, True)])
def test_adapter_one_conversation_with_and_without_native_callback(
    tmp_path, monkeypatch, native, worker
):
    (tmp_path / "run_agent.py").touch()
    monkeypatch.setattr("hermes_voice.hermes_adapter.source_path", lambda: tmp_path)
    # Keep the real upstream runtime entirely out of the unit-test process.
    monkeypatch.setattr(sys, "path", list(sys.path))
    calls = []

    class Legacy:
        def __init__(self, **kwargs):
            assert "stream_delta_callback" not in kwargs
            self.tools = []
            self.callback = None

        def run_conversation(self, **kwargs):
            calls.append(kwargs)
            if self.callback:
                self.callback("Early. ")
            return {"final_response": "Early. Done."}

    class Native(Legacy):
        def __init__(self, stream_delta_callback=None, **kwargs):
            super().__init__(**kwargs)
            self.callback = stream_delta_callback

    def noop(*args, **kwargs):
        return None

    modules = {
        "gateway.hosted_room_execution_policy": SimpleNamespace(
            RoomExecutionPolicy=lambda **kwargs: kwargs,
            bind_room_execution_policy=noop,
            reset_room_execution_policy=noop,
        ),
        "gateway.session_context": SimpleNamespace(clear_session_vars=noop, set_session_vars=noop),
        "hermes_cli.runtime_provider": SimpleNamespace(
            resolve_runtime_provider=lambda **kwargs: {"provider": "test"}
        ),
        "run_agent": SimpleNamespace(AIAgent=Native if native else Legacy),
        "tools": SimpleNamespace(
            approval=SimpleNamespace(
                _YOLO_MODE_FROZEN=False,
                set_hermes_interactive_context=noop,
                reset_hermes_interactive_context=noop,
            ),
            terminal_tool=SimpleNamespace(_get_approval_callback=noop, set_approval_callback=noop),
        ),
        "hermes_constants": SimpleNamespace(get_hermes_home=lambda: tmp_path),
    }
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)
    job = Job("task", "sid", worker, tmp_path, stream=True)
    result = HermesAdapter().run(
        "hi", [], worker, {"model": "test", "fast_model": "", "provider": "test"}, job, noop
    )
    assert result == {"final_response": "Early. Done."}
    assert len(calls) == 1
    assert job.agent.callback is not None if native and not worker else job.agent.callback is None
    if not worker:
        assert job.stream_snapshot()["text"] == ("Early. " if native else "")
