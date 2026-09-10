import asyncio
import io
import json
import sys
import types
import wave

import httpx
import pytest

from hermes_voice.speech import Speech


def run(awaitable):
    return asyncio.run(awaitable)


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for name in (
        "HERMES_VOICE_OPENAI_KEY",
        "HERMES_VOICE_ELEVENLABS_KEY",
        "HERMES_VOICE_PIPER_DIR",
    ):
        monkeypatch.delenv(name, raising=False)


def http_mock(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(**kw, transport=httpx.MockTransport(handler))
    )


def test_openai_never_borrows_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "MUST_NOT_BORROW")
    monkeypatch.setenv("VOICE_TOOLS_OPENAI_KEY", "MUST_NOT_BORROW")
    catalog = run(Speech().voices("openai"))
    assert not catalog["available"]
    assert {"id": "cedar", "name": "Cedar"} in catalog["voices"]
    with pytest.raises(RuntimeError, match="HERMES_VOICE_OPENAI_KEY"):
        run(Speech().synthesize("test", {"voice_provider": "openai", "voice": "cedar"}))


def test_openai_request(monkeypatch):
    monkeypatch.setenv("HERMES_VOICE_OPENAI_KEY", "dedicated-test-key")

    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/audio/speech"
        assert request.headers["authorization"] == "Bearer dedicated-test-key"
        assert json.loads(request.content) == dict(
            model="gpt-4o-mini-tts", input="sample", voice="marin", response_format="mp3", speed=1.2
        )
        return httpx.Response(200, content=b"ID3-test")

    http_mock(monkeypatch, handler)
    assert (
        run(Speech().synthesize("sample", {"voice_provider": "openai", "voice": "marin"}, rate=1.2))
        == b"ID3-test"
    )


def test_unknown_provider_never_uses_edge():
    with pytest.raises(RuntimeError, match="provider"):
        run(Speech().synthesize("sample", {"voice_provider": "typo", "voice": ""}))


def test_edge_catalog(monkeypatch):
    async def voices():
        return [{"ShortName": "en-US-AriaNeural", "FriendlyName": "Aria"}]

    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(list_voices=voices))
    assert run(Speech().voices("edge")) == dict(
        voices=[{"id": "en-US-AriaNeural", "name": "Aria"}],
        available=True,
        message="Edge is online; synthesis sends text to Microsoft.",
    )


def test_eleven_catalog_pages_and_manual_ids(monkeypatch):
    monkeypatch.setenv("HERMES_VOICE_ELEVENLABS_KEY", "test-key")

    def handler(request):
        assert request.url.path == "/v2/voices"
        assert request.headers["xi-api-key"] == "test-key"
        second = request.url.params.get("next_page_token") == "next"
        return httpx.Response(
            200,
            json={
                "voices": [
                    {
                        "voice_id": "abcdefghijk" if second else "zyxwvutsrqp",
                        "name": "Second" if second else "First",
                    }
                ],
                "has_more": not second,
                "next_page_token": None if second else "next",
            },
        )

    http_mock(monkeypatch, handler)
    assert len(run(Speech().voices("elevenlabs"))["voices"]) == 2

    def http_mock_reset(request):
        return httpx.Response(403, text="PRIVATE_SECRET")

    # Replace the underlying request handler without stacking client factories.
    monkeypatch.undo()
    monkeypatch.setenv("HERMES_VOICE_ELEVENLABS_KEY", "test-key")
    http_mock(monkeypatch, http_mock_reset)
    result = run(Speech().voices("elevenlabs"))
    assert not result["available"] and "manual" in result["message"].lower()
    assert "PRIVATE_SECRET" not in str(result)


@pytest.mark.parametrize(
    "payload",
    [
        {"voices": [], "has_more": True, "next_page_token": None},
        {"voices": [], "has_more": True, "next_page_token": "repeated"},
        {"voices": "malformed", "has_more": False},
        {"voices": [], "has_more": "false"},
        {"voices": []},
    ],
)
def test_eleven_partial_or_malformed_catalog_unavailable(monkeypatch, payload):
    monkeypatch.setenv("HERMES_VOICE_ELEVENLABS_KEY", "test-key")
    http_mock(monkeypatch, lambda request: httpx.Response(200, json=payload))
    result = run(Speech().voices("elevenlabs"))
    assert result["available"] is False and result["voices"] == []
    assert "manual" in result["message"].lower()


def test_cloud_json_success_is_not_audio(monkeypatch):
    monkeypatch.setenv("HERMES_VOICE_OPENAI_KEY", "test-key")
    http_mock(monkeypatch, lambda request: httpx.Response(200, json={"error": "PRIVATE_SECRET"}))
    with pytest.raises(RuntimeError) as exc:
        run(Speech().synthesize("sample", {"voice_provider": "openai", "voice": "alloy"}))
    assert "PRIVATE_SECRET" not in str(exc.value)


def test_provider_errors_sanitized(monkeypatch):
    monkeypatch.setenv("HERMES_VOICE_OPENAI_KEY", "test-key")

    def handler(request):
        raise RuntimeError("PRIVATE_SECRET request text")

    http_mock(monkeypatch, handler)
    with pytest.raises(RuntimeError) as exc:
        run(Speech().synthesize("sample", {"voice_provider": "openai", "voice": "alloy"}))
    assert "PRIVATE_SECRET" not in str(exc.value)


def piper_model(tmp_path, name="en_US-test-medium"):
    (tmp_path / (name + ".onnx")).write_bytes(b"test-model")
    (tmp_path / (name + ".onnx.json")).write_text("{}")
    return name


def fake_piper(monkeypatch, seen):
    class Voice:
        @staticmethod
        def load(model_path, **kwargs):
            seen.append((model_path, kwargs))
            return Voice()

        def synthesize(self, text, **kwargs):
            seen.append(text)
            yield types.SimpleNamespace(
                sample_rate=22050, sample_width=2, sample_channels=1, audio_int16_bytes=b"\0\0" * 64
            )

    monkeypatch.setitem(
        sys.modules,
        "piper",
        types.SimpleNamespace(PiperVoice=Voice, SynthesisConfig=lambda **kw: kw),
    )


def test_piper_local_models_wav_and_no_network(tmp_path, monkeypatch):
    name = piper_model(tmp_path)
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(tmp_path))
    seen = []
    fake_piper(monkeypatch, seen)

    def network_forbidden(*args, **kw):
        pytest.fail("offline provider attempted network")

    monkeypatch.setattr(httpx, "AsyncClient", network_forbidden)
    catalog = run(Speech().voices("piper"))
    assert catalog["available"] and catalog["voices"] == [{"id": name, "name": name}]
    data = run(Speech().synthesize("offline sample", {"voice_provider": "piper", "voice": name}))
    with wave.open(io.BytesIO(data)) as wav:
        assert wav.getnframes() == 64 and wav.getframerate() == 22050
    assert str(tmp_path) in str(seen[0][0])


@pytest.mark.parametrize("voice", ["../escape", "/tmp/escape", "a/b", "..", "$(say hi)", "x.onnx"])
def test_piper_rejects_paths(tmp_path, monkeypatch, voice):
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(tmp_path))
    fake_piper(monkeypatch, [])
    with pytest.raises(RuntimeError):
        run(Speech().synthesize("sample", {"voice_provider": "piper", "voice": voice}))


def test_piper_rejects_symlinks_and_incomplete_models(tmp_path, monkeypatch):
    models = tmp_path / "models"
    models.mkdir()
    outside = piper_model(tmp_path)
    (models / (outside + ".onnx")).symlink_to(tmp_path / (outside + ".onnx"))
    (models / (outside + ".onnx.json")).write_text("{}")
    (models / "incomplete.onnx").write_bytes(b"model")
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(models))
    fake_piper(monkeypatch, [])
    assert run(Speech().voices("piper"))["voices"] == []
    with pytest.raises(RuntimeError):
        run(Speech().synthesize("sample", {"voice_provider": "piper", "voice": outside}))


def test_piper_unconfigured_does_not_discover_or_download():
    result = run(Speech().voices("piper"))
    assert not result["available"] and not result["voices"]
    assert "HERMES_VOICE_PIPER_DIR" in result["message"]


@pytest.mark.parametrize("status,body", [(401, b"PRIVATE_SECRET"), (200, b""), (200, b"x" * 21)])
def test_cloud_failure_and_audio_bounds(monkeypatch, status, body):
    import hermes_voice.speech as speech_module

    monkeypatch.setattr(speech_module, "MAX_AUDIO", 20)
    monkeypatch.setenv("HERMES_VOICE_OPENAI_KEY", "test-key")
    http_mock(monkeypatch, lambda request: httpx.Response(status, content=body))
    with pytest.raises(RuntimeError) as exc:
        run(Speech().synthesize("sample", {"voice_provider": "openai", "voice": "alloy"}))
    assert "PRIVATE_SECRET" not in str(exc.value)


def test_eleven_manual_synthesis_without_catalog(monkeypatch):
    monkeypatch.setenv("HERMES_VOICE_ELEVENLABS_KEY", "test-key")

    def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/v1/text-to-speech/abcdefghijk"
        assert request.url.params["output_format"] == "mp3_44100_128"
        return httpx.Response(200, content=b"ID3-test")

    http_mock(monkeypatch, handler)
    assert (
        run(Speech().synthesize("sample", {"voice_provider": "elevenlabs", "voice": "abcdefghijk"}))
        == b"ID3-test"
    )


def test_piper_dependency_missing_is_honest(tmp_path, monkeypatch):
    piper_model(tmp_path)
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(tmp_path))
    monkeypatch.setitem(sys.modules, "piper", None)
    catalog = run(Speech().voices("piper"))
    assert not catalog["available"] and len(catalog["voices"]) == 1
    assert "hermes-voice[piper]" in catalog["message"]


def test_piper_cancellation_closes_generator_without_process(tmp_path, monkeypatch):
    import subprocess
    import threading

    name = piper_model(tmp_path)
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(tmp_path))
    entered, release, closed = threading.Event(), threading.Event(), threading.Event()

    def forbidden(*args, **kwargs):
        pytest.fail("Piper must not spawn a process")

    monkeypatch.setattr(subprocess, "Popen", forbidden)

    class Voice:
        @staticmethod
        def load(*args, **kwargs):
            return Voice()

        def synthesize(self, *args, **kwargs):
            try:
                entered.set()
                assert release.wait(3)
                yield types.SimpleNamespace(
                    sample_rate=22050,
                    sample_width=2,
                    sample_channels=1,
                    audio_int16_bytes=b"\0\0" * 64,
                )
                pytest.fail("Piper kept synthesizing after cancellation")
            finally:
                closed.set()

    monkeypatch.setitem(
        sys.modules,
        "piper",
        types.SimpleNamespace(PiperVoice=Voice, SynthesisConfig=lambda **kw: kw),
    )

    async def scenario():
        task = asyncio.create_task(
            Speech().synthesize("sample", {"voice_provider": "piper", "voice": name})
        )
        assert await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
        assert await asyncio.to_thread(closed.wait, 3)

    run(scenario())


def test_piper_config_symlink_rejected(tmp_path, monkeypatch):
    directory = tmp_path / "models"
    directory.mkdir()
    name = piper_model(directory)
    config = directory / (name + ".onnx.json")
    config.unlink()
    outside = tmp_path / "private.json"
    outside.write_text("{}")
    config.symlink_to(outside)
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(directory))
    fake_piper(monkeypatch, [])
    assert run(Speech().voices("piper"))["voices"] == []
    with pytest.raises(RuntimeError):
        run(Speech().synthesize("sample", {"voice_provider": "piper", "voice": name}))
