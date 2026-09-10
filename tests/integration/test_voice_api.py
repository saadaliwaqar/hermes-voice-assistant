import pytest
from fastapi.testclient import TestClient

from hermes_voice.server import create_app
from hermes_voice.speech import Speech

H = {"X-Hermes-Voice": "browser"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "empty-home"))
    monkeypatch.delenv("HERMES_VOICE_OPENAI_KEY", raising=False)
    with TestClient(create_app(tmp_path, object()), base_url="http://127.0.0.1") as c:
        yield c


@pytest.mark.parametrize(
    "provider,mime",
    [
        ("edge", "audio/mpeg"),
        ("elevenlabs", "audio/mpeg"),
        ("openai", "audio/mpeg"),
        ("piper", "audio/wav"),
    ],
)
def test_preview_fixed_sample_no_mutation_and_synthesis_mime(client, monkeypatch, provider, mime):
    calls = []

    async def synth(self, text, settings, voice=None, rate=None):
        calls.append((text, settings.copy(), voice, rate))
        return b"audio-test"

    monkeypatch.setattr(Speech, "synthesize", synth)
    before = client.get("/api/settings").json()
    response = client.post(
        "/api/voice-preview", headers=H, json={"provider": provider, "voice": "testvoice"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == mime
    assert response.headers["cache-control"] == "no-store"
    assert calls[0][0] == "Hello, this is a preview of my voice."
    assert calls[0][1]["voice_provider"] == provider
    assert client.get("/api/settings").json() == before
    assert client.get("/api/sessions").json() == {"sessions": []}
    assert (
        client.patch("/api/settings", headers=H, json={"voice_provider": provider}).status_code
        == 200
    )
    response = client.post("/api/synthesize", headers=H, json={"text": "test"})
    assert response.status_code == 200 and response.headers["content-type"] == mime


def test_catalog_contract_validation_and_security(client):
    response = client.get("/api/voices?provider=openai")
    assert response.status_code == 200
    assert set(response.json()) == {"voices", "available", "message"}
    assert response.json()["available"] is False
    assert client.get("/api/voices?provider=invalid").status_code == 422
    assert (
        client.get(
            "/api/voices?provider=openai", headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert (
        client.get("/api/voices?provider=openai", headers={"Host": "evil.test"}).status_code == 403
    )
    data = {"provider": "openai", "voice": "alloy"}
    assert client.post("/api/voice-preview", json=data).status_code == 403
    assert (
        client.post(
            "/api/voice-preview", headers={**H, "Origin": "https://evil.test"}, json=data
        ).status_code
        == 403
    )
    for bad in (
        {**data, "text": "private text"},
        {**data, "voice": "../private"},
        {**data, "provider": "invalid"},
        {**data, "voice": ""},
    ):
        assert client.post("/api/voice-preview", headers=H, json=bad).status_code == 422


@pytest.mark.parametrize(
    "endpoint,data",
    [
        ("/api/voice-preview", {"provider": "openai", "voice": "alloy"}),
        ("/api/synthesize", {"text": "private text"}),
    ],
)
def test_runtime_exceptions_not_exposed(client, monkeypatch, endpoint, data):
    async def fail(*args, **kw):
        raise RuntimeError("SECRET provider body private text")

    monkeypatch.setattr(Speech, "synthesize", fail)
    result = client.post(endpoint, headers=H, json=data)
    assert result.status_code == 503
    assert "SECRET" not in result.text and "private text" not in result.text
