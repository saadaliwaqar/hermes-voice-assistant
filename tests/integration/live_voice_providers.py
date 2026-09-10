"""Opt-in live voice checks against an isolated server. Cloud Edge sample is sent."""

import io
import os
import wave
from pathlib import Path

import httpx

base = os.environ.get("HERMES_VOICE_TEST_URL", "http://127.0.0.1:8781")
out = Path(".local/voice-provider-qa")
out.mkdir(parents=True, exist_ok=True)
with httpx.Client(
    base_url=base, timeout=120, headers={"X-Hermes-Voice": "browser", "Origin": base}
) as client:
    original = client.get("/api/settings").json()
    for provider in ("piper", "edge", "openai", "elevenlabs", "none"):
        response = client.get("/api/voices", params={"provider": provider})
        response.raise_for_status()
        catalog = response.json()
        print(
            provider,
            "available:",
            catalog["available"],
            "voices:",
            len(catalog["voices"]),
            catalog["message"],
        )
    for provider, voice in (("piper", "en_US-ljspeech-medium"), ("edge", "en-US-AriaNeural")):
        response = client.post("/api/voice-preview", json={"provider": provider, "voice": voice})
        response.raise_for_status()
        assert len(response.content) > 1000
        if provider == "piper":
            assert response.headers["content-type"].startswith("audio/wav")
            with wave.open(io.BytesIO(response.content)) as wav:
                assert wav.getnframes() > 1000
                print("Piper actual preview:", wav.getframerate(), "Hz", wav.getnframes(), "frames")
        else:
            assert response.headers["content-type"].startswith("audio/mpeg")
        (out / (provider + (".wav" if provider == "piper" else ".mp3"))).write_bytes(
            response.content
        )
        assert client.get("/api/settings").json() == original, "Preview must not save settings"
        print(provider, "REAL_PREVIEW_PASS", len(response.content), "bytes")
    print("LIVE_VOICE_PROVIDERS_PASS")
