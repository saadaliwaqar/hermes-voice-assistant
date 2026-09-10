import asyncio
import json
import os
import sys
import time

import pytest

from hermes_voice import setup
from hermes_voice.config import Settings


@pytest.fixture
def service(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    source = tmp_path / "source"
    source.mkdir()
    app = tmp_path / "app"
    app.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_SOURCE", str(source))
    return setup.SetupService(app, Settings(app))


def fake_runtime(source, agent):
    (source / "run_agent.py").write_text(agent)
    package = source / "hermes_cli"
    package.mkdir()
    (package / "__init__.py").touch()
    (package / "runtime_provider.py").write_text(
        "def resolve_runtime_provider(**kw):\n"
        "    assert kw == {'requested': 'test', 'target_model': 'test-model'}\n"
        "    return {'provider': 'test'}\n"
    )


def test_real_subprocess_agent_contract_no_persistence(service):
    source = setup.source_path()
    fake_runtime(
        source,
        """
import os
from pathlib import Path
class AIAgent:
    def __init__(self, **kw):
        assert kw['enabled_toolsets'] == []
        assert kw['save_trajectories'] is False
        assert kw['session_db'] is None
        assert kw['skip_memory'] and kw['skip_context_files'] and kw['skip_background_review']
        assert kw['max_iterations'] == 1 and kw['max_tokens'] <= 64
        assert Path.cwd().resolve() == Path(os.environ['HERMES_HOME']).resolve()
        assert Path.cwd().resolve() == Path(os.environ['HOME']).resolve()
        self.tools = []
    def run_conversation(self, **kw):
        assert kw['conversation_history'] == []
        assert kw['user_message'] == 'Reply with OK only.'
        Path('temporary-runtime-log').write_text('not retained')
        return {'final_response': 'OK'}
""",
    )
    before = set(service.path.parent.iterdir())
    result = asyncio.run(service.test_model("test-model", "test"))
    assert result["ok"] is True
    assert set(service.path.parent.iterdir()) == before
    assert not service.completed()


def test_real_subprocess_timeout_kills_and_releases_slot(service, monkeypatch, tmp_path):
    marker = tmp_path / "pid"
    fake_runtime(
        setup.source_path(),
        f"import os, time\nfrom pathlib import Path\nPath({str(marker)!r}).write_text(str(os.getpid()))\ntime.sleep(60)\n",
    )
    monkeypatch.setattr(setup, "MODEL_TIMEOUT", 0.3)
    start = time.monotonic()
    result = asyncio.run(service.test_model("test-model", "test"))
    assert result["ok"] is False and "timed out" in result["message"]
    assert time.monotonic() - start < 3
    pid = int(marker.read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
    assert not service.model_lock.locked()


def test_concurrent_model_request_fails_fast(service, monkeypatch):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def probe(*args):
            entered.set()
            await release.wait()
            return True

        monkeypatch.setattr(service, "_model_probe", probe)
        first = asyncio.create_task(service.test_model("x", "auto"))
        await entered.wait()
        second = await service.test_model("x", "auto")
        assert second["ok"] is False and "already running" in second["message"]
        release.set()
        assert (await first)["ok"] is True

    asyncio.run(scenario())


def test_import_probe_executes_import_not_just_path_and_is_bounded(tmp_path, monkeypatch):
    (tmp_path / "broken.py").write_text("raise RuntimeError('SECRET')")
    assert asyncio.run(setup.probe_import("import broken", tmp_path)) == "missing"
    assert asyncio.run(setup.probe_import("import json")) == "ready"
    monkeypatch.setattr(setup, "IMPORT_TIMEOUT", 0.1)
    assert asyncio.run(setup.probe_import("import time; time.sleep(60)")) == "warning"


@pytest.mark.parametrize(
    "agent",
    [
        "class AIAgent:\n    def __init__(self, **kw): self.tools = ['unexpected']\n    def run_conversation(self, **kw): raise AssertionError('Must not run')\n",
        "class AIAgent:\n    def __init__(self, **kw): self.tools = []\n    def run_conversation(self, **kw): return {'error': 'SECRET', 'final_response': 'bad'}\n",
        "raise RuntimeError('SECRET import failure')\n",
    ],
)
def test_model_runtime_failures_and_tools_refused(service, agent, capfd):
    fake_runtime(setup.source_path(), agent)
    result = asyncio.run(service.test_model("test-model", "test"))
    assert result["ok"] is False
    assert "SECRET" not in json.dumps(result)
    assert "SECRET" not in str(capfd.readouterr())


def test_import_probe_disables_network(tmp_path):
    assert (
        asyncio.run(
            setup.probe_import("import socket; socket.create_connection(('example.com', 443))")
        )
        == "missing"
    )


@pytest.mark.parametrize("content", ["broken", "[]", '{"completed": "true"}', '{"completed": 1}'])
def test_corrupt_or_nonboolean_completion_is_false(service, content):
    service.path.write_text(content)
    assert service.completed() is False
    service.complete()
    assert service.completed() is True
    assert json.loads(service.path.read_text()) == {"completed": True}


def test_credentials_are_presence_only(service, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "SECRET_NOT_PUBLIC")
    (setup.hermes_home() / ".env").write_text("ELEVENLABS_API_KEY=SECRET_NOT_PUBLIC\n")
    result = setup.credential_checks()
    assert "SECRET_NOT_PUBLIC" not in json.dumps(result)
    assert {c["id"]: c["status"] for c in result}["model_credentials"] == "ready"


def test_isolation_does_not_copy_behavioral_config_or_env(service, tmp_path, monkeypatch):
    home = setup.hermes_home()
    (home / "config.yaml").write_text("model:\n  default: test\nhooks:\n  danger: yes\n")
    (home / ".env").write_text("OPENAI_API_KEY=secret\nHERMES_HOME=/unsafe\nTERMINAL_CWD=/unsafe\n")
    destination = tmp_path / "isolated"
    destination.mkdir()
    setup.isolated_config(destination)
    assert "hooks" not in (destination / "config.yaml").read_text()
    assert "HERMES_HOME" not in (destination / ".env").read_text()
    assert "TERMINAL_CWD" not in (destination / ".env").read_text()
    monkeypatch.setenv("PYTHONPATH", "/unsafe")
    assert "PYTHONPATH" not in setup.child_environment(destination)
    assert sys.path  # The app's import path remains untouched.


def test_speech_credentials_only_use_actual_server_environment(service, monkeypatch):
    for key in ("HERMES_VOICE_ELEVENLABS_KEY", "HERMES_VOICE_OPENAI_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "unrelated")
    (setup.hermes_home() / ".env").write_text(
        "HERMES_VOICE_ELEVENLABS_KEY=not_loaded\nHERMES_VOICE_OPENAI_KEY=not_loaded\n"
    )
    checks = {c["id"]: c for c in setup.credential_checks()}
    assert checks["elevenlabs_key"]["status"] == "warning"
    assert checks["openai_voice_key"]["status"] == "warning"
    monkeypatch.setenv("HERMES_VOICE_ELEVENLABS_KEY", "actual_key")
    checks = {c["id"]: c for c in setup.credential_checks()}
    assert checks["elevenlabs_key"]["status"] == "ready"
    assert "actual_key" not in json.dumps(checks)
