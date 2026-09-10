"""Opt-in offline measurement. Uses installed Piper only; writes no audio/settings.

HERMES_VOICE_PIPER_DIR=/absolute/models .venv/bin/python tests/integration/benchmark_speech_latency.py
"""

import asyncio
import io
import json
import statistics
import time
import wave

from hermes_voice.speech import PREVIEW_TEXT, Speech


async def main():
    config = {"voice_provider": "piper", "voice": "en_US-ljspeech-medium"}
    warm = Speech()
    rows = []

    async def measure(speech, kind):
        started = time.perf_counter()
        data = await speech.synthesize(PREVIEW_TEXT, config)
        elapsed = time.perf_counter() - started
        with wave.open(io.BytesIO(data)) as wav:
            assert wav.getnframes() > 0 and wav.getnchannels() == 1
            row = dict(
                kind=kind,
                seconds=round(elapsed, 6),
                bytes=len(data),
                sample_rate=wav.getframerate(),
                frames=wav.getnframes(),
            )
        rows.append(row)

    await measure(warm, "initial")
    for _ in range(5):
        # Fresh instance approximates previous per-request engine loading.
        # Alternating measurements reduces ordering/thermal bias, not a lab benchmark.
        await measure(Speech(), "fresh_engine")
        await measure(warm, "cached_engine")
    medians = {
        kind: statistics.median(r["seconds"] for r in rows if r["kind"] == kind)
        for kind in ("fresh_engine", "cached_engine")
    }
    print(
        json.dumps(
            dict(
                text=PREVIEW_TEXT, voice=config["voice"], measurements=rows, median_seconds=medians
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
