import asyncio
import io
import os
import re
import tempfile
import threading
import wave
from pathlib import Path

import httpx

# Built-in gpt-4o-mini-tts voices, per OpenAI's speech API reference.
OPENAI_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
)
PREVIEW_TEXT = "Hello, this is a preview of my voice."
MAX_AUDIO = 20_000_000
VOICE_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")


class SpeechError(RuntimeError):
    """Only application-authored, public-safe error messages belong here."""


def audio_mime(provider):
    return "audio/wav" if provider == "piper" else "audio/mpeg"


def piper_directory():
    configured = os.environ.get("HERMES_VOICE_PIPER_DIR", "").strip()
    if not configured:
        raise SpeechError("Set HERMES_VOICE_PIPER_DIR to an installed local model directory.")
    directory = Path(configured).expanduser()
    if not directory.is_absolute() or not directory.is_dir():
        raise SpeechError("HERMES_VOICE_PIPER_DIR must be an existing absolute directory.")
    return directory.resolve()


def piper_paths(directory, voice):
    if not VOICE_ID.fullmatch(voice):
        raise SpeechError("Select a valid installed Piper model ID (without an extension).")
    model = directory / (voice + ".onnx")
    config = directory / (voice + ".onnx.json")
    for path in (model, config):
        if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
            raise SpeechError(
                "Piper model and config must be installed inside HERMES_VOICE_PIPER_DIR."
            )
    return model, config


class Speech:
    def __init__(self):
        self.whisper = None
        self.lock = threading.Lock()
        self.limit = asyncio.Semaphore(2)
        self.piper_lock = threading.Lock()
        self._piper_key = None
        self._piper_engine = None

    def transcribe(self, audio, language):
        with self.lock:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise RuntimeError("Install hermes-voice[speech] for local transcription.") from exc
            if self.whisper is None:
                self.whisper = WhisperModel(
                    "base", device="cpu", compute_type="int8", cpu_threads=4
                )
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "audio.webm"
                path.write_bytes(audio)
                segments, _ = self.whisper.transcribe(
                    str(path),
                    language=None if language == "auto" else language,
                    vad_filter=True,
                )
                return " ".join(s.text for s in segments)[:12000]

    async def voices(self, provider):
        """Catalog only: never synthesizes, persists settings or downloads models."""

        def result(voices, available, message):
            return dict(voices=voices, available=available, message=message)

        if provider == "none":
            return result([], False, "Speech output is disabled.")
        if provider == "openai":
            configured = bool(os.environ.get("HERMES_VOICE_OPENAI_KEY", "").strip())
            return result(
                [{"id": v, "name": v.title()} for v in OPENAI_VOICES],
                configured,
                "OpenAI key configured (not validated); paid synthesis sends text to OpenAI."
                if configured
                else "Set HERMES_VOICE_OPENAI_KEY; other credentials are never used.",
            )
        if provider == "piper":
            try:
                directory = piper_directory()
                voices = []
                for path in sorted(directory.glob("*.onnx")):
                    try:
                        piper_paths(directory, path.stem)
                    except SpeechError:
                        continue
                    voices.append({"id": path.stem, "name": path.stem})
                try:
                    from piper import PiperVoice  # noqa: F401
                except ImportError:
                    return result(
                        voices, False, "Install hermes-voice[piper] for offline Piper speech."
                    )
                return result(
                    voices,
                    bool(voices),
                    "Local model files found; offline synthesis validates the selected model."
                    if voices
                    else "No complete local .onnx and .onnx.json model pairs installed.",
                )
            except SpeechError as exc:
                return result([], False, str(exc))
            except Exception:
                return result(
                    [], False, "Piper catalog unavailable; check local models and dependencies."
                )
        if provider == "edge":
            try:
                import edge_tts

                entries = await asyncio.wait_for(edge_tts.list_voices(), 15)
                voices = [
                    {"id": v["ShortName"], "name": v.get("FriendlyName", v["ShortName"])}
                    for v in entries
                    if VOICE_ID.fullmatch(v["ShortName"])
                ]
                return result(
                    voices, bool(voices), "Edge is online; synthesis sends text to Microsoft."
                )
            except Exception:
                return result(
                    [],
                    False,
                    "Edge catalog unavailable; check speech dependencies and network. Manual voice IDs are supported.",
                )
        if provider == "elevenlabs":
            key = os.environ.get("HERMES_VOICE_ELEVENLABS_KEY", "").strip()
            if not key:
                return result(
                    [], False, "Set HERMES_VOICE_ELEVENLABS_KEY. Manual voice IDs are supported."
                )
            try:
                voices, tokens = {}, set()
                params = {"page_size": 100}
                async with asyncio.timeout(20):
                    async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                        for _ in range(50):
                            response = await client.get(
                                "https://api.elevenlabs.io/v2/voices",
                                headers={"xi-api-key": key},
                                params=params,
                            )
                            response.raise_for_status()
                            data = response.json()
                            if not isinstance(data.get("voices"), list) or not isinstance(
                                data.get("has_more"), bool
                            ):
                                break
                            for v in data["voices"]:
                                if re.fullmatch(r"[A-Za-z0-9]{10,80}", v["voice_id"]):
                                    voices[v["voice_id"]] = {
                                        "id": v["voice_id"],
                                        "name": str(v["name"])[:200],
                                    }
                            if not data.get("has_more"):
                                return result(
                                    list(voices.values()),
                                    True,
                                    "ElevenLabs catalog loaded; paid synthesis sends text to ElevenLabs. Manual voice IDs are supported.",
                                )
                            token = data.get("next_page_token")
                            if not token or token in tokens:
                                break
                            tokens.add(token)
                            params["next_page_token"] = token
            except Exception:
                pass
            return result(
                [],
                False,
                "ElevenLabs catalog unavailable; check key permissions and network. Manual voice IDs are supported.",
            )
        return result([], False, "Unsupported speech provider.")

    async def synthesize(self, text, settings, voice=None, rate=None):
        async with self.limit:
            try:
                async with asyncio.timeout(60):
                    return await self._synthesize(text, settings, voice, rate)
            except SpeechError:
                raise
            except Exception:
                # Never reflect SDK errors, URLs, credentials or request bodies.
                raise SpeechError("Speech provider failed; no fallback used.") from None

    async def _cloud_audio(self, url, headers, payload, params=None):
        async with httpx.AsyncClient(timeout=40, trust_env=False) as client:
            async with client.stream(
                "POST", url, headers=headers, json=payload, params=params
            ) as response:
                if response.status_code != 200:
                    raise SpeechError(
                        "Speech provider rejected synthesis; check credentials, quota and voice. No fallback used."
                    )
                content_type = response.headers.get("content-type", "").split(";")[0].lower()
                if content_type and content_type not in {
                    "audio/mpeg",
                    "audio/mp3",
                    "application/octet-stream",
                }:
                    raise SpeechError("Speech provider returned an unexpected audio format.")
                output = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(output) + len(chunk) > MAX_AUDIO:
                        raise SpeechError("Audio response too large.")
                    output.extend(chunk)
                if not output:
                    raise SpeechError("Speech provider returned no audio; no fallback used.")
                return bytes(output)

    async def _synthesize(self, text, settings, voice, rate):
        provider = settings["voice_provider"]
        voice = voice or settings.get("voice", "")
        rate = rate or 1.0
        if provider == "none":
            raise SpeechError(
                "Speech output is disabled. Select a provider explicitly in Settings."
            )
        if provider == "openai":
            key = os.environ.get("HERMES_VOICE_OPENAI_KEY", "").strip()
            if not key:
                raise SpeechError("Set HERMES_VOICE_OPENAI_KEY to use OpenAI speech.")
            voice = voice or "marin"
            if voice not in OPENAI_VOICES:
                raise SpeechError("Select a supported OpenAI voice.")
            return await self._cloud_audio(
                "https://api.openai.com/v1/audio/speech",
                {"Authorization": "Bearer " + key, "Accept": "audio/mpeg"},
                {
                    "model": "gpt-4o-mini-tts",
                    "input": text,
                    "voice": voice,
                    "response_format": "mp3",
                    "speed": rate,
                },
            )
        if provider == "elevenlabs":
            key = os.environ.get("HERMES_VOICE_ELEVENLABS_KEY", "").strip()
            if not key:
                raise SpeechError("Set HERMES_VOICE_ELEVENLABS_KEY to use ElevenLabs.")
            if not re.fullmatch(r"[A-Za-z0-9]{10,80}", voice):
                raise SpeechError("Configure a valid ElevenLabs voice ID.")
            return await self._cloud_audio(
                "https://api.elevenlabs.io/v1/text-to-speech/" + voice,
                {"xi-api-key": key, "accept": "audio/mpeg"},
                {
                    "text": text,
                    "model_id": "eleven_flash_v2_5",
                    "voice_settings": {"speed": max(0.8, min(1.2, rate))},
                },
                params={"output_format": "mp3_44100_128"},
            )
        if provider == "piper":
            # In-process library only. Cancellation stops at the next sentence boundary;
            # no shell process, persisted audio, downloader or cloud fallback exists.
            cancelled = threading.Event()
            work = asyncio.create_task(
                asyncio.to_thread(self._piper_audio, text, voice, rate, cancelled)
            )
            try:
                return await asyncio.shield(work)
            except asyncio.CancelledError:
                cancelled.set()
                # Retrieve worker errors without logging private provider messages.
                work.add_done_callback(
                    lambda task: task.exception() if not task.cancelled() else None
                )
                raise
        if provider != "edge":
            raise SpeechError("Unsupported speech provider; no fallback used.")
        try:
            import edge_tts
        except ImportError:
            raise SpeechError(
                "Install hermes-voice[speech] for explicitly selected Edge speech."
            ) from None
        voice = voice or "en-US-AriaNeural"
        output = bytearray()
        async for chunk in edge_tts.Communicate(
            text, voice, rate=f"{round((rate - 1) * 100):+d}%"
        ).stream():
            if chunk["type"] == "audio":
                output.extend(chunk["data"])
            if len(output) > MAX_AUDIO:
                raise SpeechError("Audio response too large.")
        if not output:
            raise SpeechError("Speech provider returned no audio; no fallback used.")
        return bytes(output)

    def _piper_audio(self, text, voice, rate, cancelled):
        directory = piper_directory()
        model, config = piper_paths(directory, voice)
        try:
            from piper import PiperVoice, SynthesisConfig
        except ImportError:
            raise SpeechError("Install hermes-voice[piper] for offline Piper speech.") from None
        # Piper/espeak may share native state. Never synthesize concurrently.
        with self.piper_lock:
            if cancelled.is_set():
                return b""
            # Validate again after waiting for native-state ownership. Keep only
            # one engine; voice/model/config changes replace it, never grow a pool.
            model, config = piper_paths(directory, voice)

            def signature(path):
                stat = path.stat()
                return (
                    str(path),
                    stat.st_dev,
                    stat.st_ino,
                    stat.st_size,
                    stat.st_mtime_ns,
                    stat.st_ctime_ns,
                )

            key = (signature(model), signature(config))
            if self._piper_key != key:
                self._piper_engine = None
                self._piper_key = None
                engine = PiperVoice.load(str(model), config_path=str(config), use_cuda=False)
                self._piper_engine = engine
                self._piper_key = key
            engine = self._piper_engine
            if cancelled.is_set():
                return b""
            output = io.BytesIO()
            chunks = engine.synthesize(text, syn_config=SynthesisConfig(length_scale=1.0 / rate))
            try:
                with wave.open(output, "wb") as wav:
                    initialized = False
                    for chunk in chunks:
                        if not initialized:
                            wav.setframerate(chunk.sample_rate)
                            wav.setsampwidth(chunk.sample_width)
                            wav.setnchannels(chunk.sample_channels)
                            initialized = True
                        if cancelled.is_set():
                            break
                        if output.tell() + len(chunk.audio_int16_bytes) > MAX_AUDIO:
                            raise SpeechError("Audio response too large.")
                        wav.writeframes(chunk.audio_int16_bytes)
            finally:
                chunks.close()
            if cancelled.is_set():
                return b""
            if not initialized:
                raise SpeechError("Piper returned no audio.")
            return output.getvalue()
