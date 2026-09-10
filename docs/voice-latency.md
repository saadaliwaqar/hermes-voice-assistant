# Speech startup and interruption

The dashboard still waits for the model's **completed reply**. It now starts speaking a bounded initial chunk rather than waiting for one audio file covering the entire reply. While the current chunk plays, it prepares at most one next chunk. This is not model-token streaming, full duplex or guaranteed gapless audio.

## Behavior

- Chunking prefers sentence/punctuation or word boundaries around 260 characters. Each API request remains within its 4,000-character limit. The splitter preserves the text exactly; whitespace-only spans are not sent for synthesis. No spoken words are silently truncated.
- Only one player owns foreground audio. Pending synthesis uses AbortController, so Interrupt, session changes, another Read aloud, setup and voice preview can cancel it.
- An invalidated response cannot resume playback or reset a newer request's state. Microphone gating stays closed between chunks to avoid recording the assistant.
- A provider/media failure stops the sequence, including prefetched work. The complete written response remains visible. Retry is explicit and starts from the beginning; there is no automatic fallback/retry that could repeat words unexpectedly.
- Prefetch means more than one provider request per long reply. This can change per-request overhead/billing and prosody compared with one large synthesis call. Cloud network variability still applies.
- Piper retains at most one loaded voice engine per service instance, under the native-state lock. Model/config identity, size and timestamps invalidate reuse; changing voices reloads the engine. The first use remains a cold start.
- Backend synthesis/preview work is cancelled on HTTP disconnect. Cloud awaits stop locally; previously billed work is not undone. Piper cancellation is cooperative between sentence chunks; an active native inference sentence cannot be instantly terminated.

## Local measurements

Measured in Chrome with the same fixed 810-character passage, three runs per provider and implementation. Time starts at the Read aloud action and ends at detected actual media playback (`currentTime > 0`), not merely successful API response. One cold request and subsequent warm requests are included. The medians mainly reflect the warm runs.

| Provider | Previous median | Updated median | Reduction |
|---|---:|---:|---:|
| Piper, en_US-ljspeech-medium | 1491.6 ms | 362.0 ms | 75.7% |
| Edge, en-US-AriaNeural | 3712.3 ms | 1498.5 ms | 59.6% |

These are small local observations, **not a universal latency guarantee**. The comparison excludes recording, transcription, model generation and session polling. Different text, voices, hardware and network conditions can produce different results. The cold Piper run was slower than warm reuse.

A separate full-passage check played all four chunks with each real provider, verified each media completion, no simultaneous active players, and the requested text in order. The existing prerecorded microphone → local Whisper → configured chat model → Edge playback/orb test also passed.

## Reproduction and verification

`tests/browser/speech-benchmark.mjs` uses explicitly labeled fixed session fixtures but calls the **real** local synthesis API and actual browser media playback. It is not a fake model-response benchmark. It modifies only the selected test service's voice settings; use isolated QA data, never the user's live service.

```sh
HERMES_VOICE_TEST_URL=http://127.0.0.1:8781 BENCH_VARIANT=after node tests/browser/speech-benchmark.mjs
HERMES_VOICE_TEST_URL=http://127.0.0.1:8781 BENCH_VARIANT=after BENCH_FULL=1 node tests/browser/speech-benchmark.mjs
node --test tests/speech-playback.test.mjs
```

Before-mode additionally requires the local source snapshot at `.local/speed-baseline/static`; that snapshot and raw JSON evidence are development artifacts, not package contents. The independent Piper backend benchmark is `tests/integration/benchmark_speech_latency.py` and requires `HERMES_VOICE_PIPER_DIR`.

Deterministic tests cover ordered chunks, bounded prefetch, stale response/media callbacks, pending-send interruption, whitespace gaps, failure cleanup and microphone gating. Real socket tests verify synthesis and preview disconnect cancellation. Mocked unit tests verify ownership logic; they are not represented as live provider availability tests.
