import asyncio
import sys
import types

import pytest

from hermes_voice.speech import Speech


@pytest.fixture
def piper(tmp_path, monkeypatch):
    for name in ("first", "second"):
        (tmp_path / f"{name}.onnx").write_bytes(b"model")
        (tmp_path / f"{name}.onnx.json").write_text("{}")
    monkeypatch.setenv("HERMES_VOICE_PIPER_DIR", str(tmp_path))
    loads, texts = [], []

    class Voice:
        @staticmethod
        def load(path, **kwargs):
            loads.append(path)
            return Voice()

        def synthesize(self, text, **kwargs):
            texts.append(text)
            yield types.SimpleNamespace(
                sample_rate=22050, sample_width=2, sample_channels=1, audio_int16_bytes=b"\0\0" * 64
            )

    monkeypatch.setitem(
        sys.modules,
        "piper",
        types.SimpleNamespace(PiperVoice=Voice, SynthesisConfig=lambda **kw: kw),
    )
    return tmp_path, loads, texts


def synth(speech, voice="first"):
    return speech.synthesize("sample", {"voice_provider": "piper", "voice": voice})


def test_piper_reuses_one_engine_and_evicts_on_voice_change(piper):
    _, loads, texts = piper

    async def scenario():
        speech = Speech()
        await asyncio.gather(synth(speech), synth(speech))
        assert len(loads) == 1
        await synth(speech, "second")
        await synth(speech, "first")
        assert len(loads) == 3
        assert len(texts) == 4

    asyncio.run(scenario())


@pytest.mark.parametrize("suffix", [".onnx", ".onnx.json"])
def test_piper_cache_invalidated_when_files_change(piper, suffix):
    directory, loads, _ = piper

    async def scenario():
        speech = Speech()
        await synth(speech)
        await synth(speech)
        assert len(loads) == 1
        (directory / ("first" + suffix)).write_bytes(b"changed contents")
        await synth(speech)
        assert len(loads) == 2

    asyncio.run(scenario())


def test_cached_model_still_rejects_symlink(piper):
    directory, loads, _ = piper

    async def scenario():
        speech = Speech()
        await synth(speech)
        path = directory / "first.onnx"
        path.unlink()
        path.symlink_to(directory / "second.onnx")
        with pytest.raises(RuntimeError):
            await synth(speech)
        assert len(loads) == 1

    asyncio.run(scenario())


def test_cancelled_piper_waiter_never_loads_or_synthesizes(piper):
    _, loads, texts = piper

    async def scenario():
        speech = Speech()
        speech.piper_lock.acquire()
        task = asyncio.create_task(synth(speech))
        try:
            await asyncio.sleep(0.03)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            speech.piper_lock.release()
        # Drain the executor so late native work cannot escape the assertions.
        await asyncio.get_running_loop().shutdown_default_executor()
        assert loads == [] and texts == []

    asyncio.run(scenario())
