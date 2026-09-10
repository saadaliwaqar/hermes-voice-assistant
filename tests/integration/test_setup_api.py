import json

import pytest
from fastapi.testclient import TestClient

from hermes_voice.server import create_app

H = {"X-Hermes-Voice": "browser"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HERMES_SOURCE", str(tmp_path / "source"))
    with TestClient(create_app(tmp_path / "app", object()), base_url="http://127.0.0.1") as c:
        yield c


def test_setup_schema_read_only(client, tmp_path):
    response = client.get("/api/setup")
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"completed", "checks", "defaults"}
    assert data["completed"] is False
    assert set(data["defaults"]) == {
        "model",
        "provider",
        "fast_model",
        "voice_provider",
        "voice",
        "language",
    }
    assert all(isinstance(v, str) for v in data["defaults"].values())
    checks = {c["id"]: c for c in data["checks"]}
    assert checks["hermes_source"]["status"] == "missing"
    assert checks["hermes_runtime"]["status"] != "ready"
    for check in checks.values():
        assert set(check) == {"id", "label", "status", "detail"}
        assert check["status"] in {"ready", "missing", "warning"}
    assert not (tmp_path / "app/setup.json").exists()
    assert not (tmp_path / "app/settings.json").exists()
    assert client.get("/api/sessions").json() == {"sessions": []}


def test_completion_restart_preserves_settings(client, tmp_path):
    assert (
        client.patch("/api/settings", headers=H, json={"model": "custom/model"}).status_code == 200
    )
    saved = (tmp_path / "app/settings.json").read_bytes()
    assert client.post("/api/setup/complete", headers=H).json() == {"completed": True}
    assert json.loads((tmp_path / "app/setup.json").read_text()) == {"completed": True}
    assert (tmp_path / "app/settings.json").read_bytes() == saved
    with TestClient(create_app(tmp_path / "app", object()), base_url="http://127.0.0.1") as other:
        data = other.get("/api/setup").json()
        assert data["completed"] is True
        assert data["defaults"]["model"] == "custom/model"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"model": "", "provider": "auto"},
        {"model": "x" * 201, "provider": "auto"},
        {"model": "x", "provider": "x" * 101},
        {"model": "x", "provider": 5},
        {"model": "x", "provider": "auto", "api_key": "SECRET"},
        {"model": "hello\nworld", "provider": "auto"},
    ],
)
def test_model_validation(client, payload):
    response = client.post("/api/setup/test-model", headers=H, json=payload)
    assert response.status_code == 422
    assert "SECRET" not in response.text


@pytest.mark.parametrize(
    "config", ["[]", "model: null", "model: 123", "model:\n  default: null\n  provider: null"]
)
def test_fresh_start_malformed_upstream_has_string_defaults(tmp_path, monkeypatch, config):
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.yaml").write_text(config)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_SOURCE", str(tmp_path / "missing"))
    with TestClient(create_app(tmp_path / "app", object()), base_url="http://127.0.0.1") as c:
        data = c.get("/api/setup").json()
        assert all(isinstance(value, str) for value in data["defaults"].values())


def test_security(client):
    for endpoint in ("/api/setup/complete", "/api/setup/test-model"):
        assert client.post(endpoint, json={}).status_code == 403
        assert (
            client.post(endpoint, headers={**H, "Origin": "https://evil.test"}).status_code == 403
        )


def test_model_failure_redacted_and_no_history(client, monkeypatch):
    from hermes_voice.setup import SetupService

    async def fail(*args, **kwargs):
        raise RuntimeError("SECRET credential body")

    monkeypatch.setattr(SetupService, "_model_probe", fail)
    response = client.post(
        "/api/setup/test-model", headers=H, json={"model": "x", "provider": "auto"}
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert set(response.json()) == {"ok", "message"}
    assert "SECRET" not in response.text
    assert client.get("/api/sessions").json() == {"sessions": []}
