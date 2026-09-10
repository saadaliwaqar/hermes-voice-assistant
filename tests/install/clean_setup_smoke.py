"""Run with a clean wheel-installed interpreter, not the editable development venv."""

import importlib.util
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

import hermes_voice


def main():
    installed = Path(hermes_voice.__file__).resolve()
    assert "site-packages" in installed.parts, f"Not testing installed wheel: {installed}"
    assert importlib.util.find_spec("run_agent") is None
    assert importlib.util.find_spec("faster_whisper") is None
    with tempfile.TemporaryDirectory(prefix="voice-clean-setup-") as directory:
        root = Path(directory)
        env = os.environ.copy()
        for key in tuple(env):
            if key.startswith(("HERMES_", "PYTHONPATH", "PYTHONHOME")):
                env.pop(key)
        env.update(
            HERMES_SOURCE=str(root / "missing-hermes"),
            HERMES_HOME=str(root / "empty-profile"),
            HERMES_VOICE_DATA_DIR=str(root / "data"),
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        with httpx.Client(
            base_url=base,
            timeout=35,
            headers={"X-Hermes-Voice": "browser", "Origin": base},
        ) as client:
            for restart in (False, True):
                with (root / "server.log").open("wb") as log:
                    process = subprocess.Popen(
                        [sys.executable, "-m", "hermes_voice.server", "--port", str(port)],
                        cwd=root,
                        env=env,
                        stdout=log,
                        stderr=log,
                    )
                    try:
                        deadline = time.monotonic() + 40
                        while True:
                            if process.poll() is not None:
                                raise AssertionError("Clean installed server exited during startup")
                            try:
                                health = client.get("/api/health")
                                if health.status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            if time.monotonic() >= deadline:
                                raise AssertionError("Clean installed server did not become ready")
                            time.sleep(0.15)
                        assert health.json()["service"] == "hermes-voice"
                        setup = client.get("/api/setup")
                        setup.raise_for_status()
                        data = setup.json()
                        assert data["completed"] is restart
                        assert any(c["status"] == "missing" for c in data["checks"])
                        if restart:
                            assert client.get("/api/settings").json()["voice_provider"] == "none"
                            print("CLEAN_SETUP_RESTART_PERSISTENCE_PASS")
                            continue
                        html = client.get("/")
                        assert html.status_code == 200 and "setup" in html.text.lower()
                        for name in ("app.mjs", "orb.mjs", "style.css"):
                            response = client.get("/static/" + name)
                            assert response.status_code == 200
                        settings = client.get("/api/settings").json()
                        response = client.post(
                            "/api/setup/test-model", json={"model": "test", "provider": "auto"}
                        )
                        response.raise_for_status()
                        assert response.json()["ok"] is False
                        assert client.get("/api/settings").json() == settings
                        response = client.patch("/api/settings", json={"voice_provider": "none"})
                        response.raise_for_status()
                        response = client.post("/api/setup/complete")
                        response.raise_for_status()
                        assert response.json()["completed"] is True
                        assert client.get("/api/setup").json()["completed"] is True
                        print("CLEAN_SETUP_MISSING_RUNTIME_AND_COMPLETION_PASS")
                    finally:
                        process.terminate()
                        try:
                            process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
    print("CLEAN_INSTALLED_WHEEL_SETUP_PASS")


if __name__ == "__main__":
    main()
