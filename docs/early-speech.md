# Early-speech streaming trial

This opt-in trial lets tool-free foreground chat show provisional text and prepare speech as complete sentences arrive from Hermes. It does not add full-duplex microphone capture, native realtime audio or worker narration.

## Current result: keep disabled by default

The trial is implemented, but useful early audio is **not demonstrated on the tested Hermes/Codex path**. All three live trial runs began playback after the owning model task had completed. A separate native probe delivered its first callback only about 9 ms before returning the final response.

For the identical 1683-character passage, three sequential baseline runs had median text-submit-to-first-audio 6.53 s; three later trial runs had median 3.34 s. These are warm-up/network/model-sensitive, non-interleaved samples, and **not evidence that streaming caused the difference**. Both modes had zero audio/generation-overlap trials. No end-of-user-speech latency reduction is claimed.

Verified locally: 95 Python tests, 54 browser tests and 18 speech/geometry Node tests; real microphone fixture → Whisper → model → Edge playback also passed with the trial selected. A final-task-field mismatch in the mocked browser contract was caught by live QA, reproduced with the real `result` field, fixed and regression-tested.

## Reversibility

The completed-reply path remains available. **Stream replies (trial)** is a browser preference, separate from model and speech-provider settings. It is off by default; an explicit `?stream=1` launch enables the trial in that browser. Turning it off invalidates local streaming playback without silently resubmitting the model request.

## Safety and attribution

- Only an explicitly submitted foreground chat turn owns early speech. The ownership includes the server task ID, session and local epoch.
- Workers, background completions and historical/reloaded messages do not become unsolicited speech.
- Streaming text is provisional. The existing stored final response remains authoritative and is saved once.
- If a provider returns no usable deltas, the same request's final response can be read once. There is no second model invocation or provider switch.
- If a streamed prefix is later rewritten, speech must stop rather than automatically replay a conflicting full response. Already spoken words cannot be retracted; inspect the readable final reply.
- Interrupt, session switching, preview/setup and explicit speech controls preserve audio ownership and discard stale work.
- Only complete sentence/paragraph boundaries are eligible during generation. The remaining suffix is flushed after completion. TTS requests stay bounded, with at most one next-audio request prepared in advance.
- Microphone capture stays gated while generation or speech is active, including gaps between arriving sentences. **Interrupt** remains necessary; this is not automatic barge-in.

## Measuring it

`tests/browser/model-stream-benchmark.mjs` is an opt-in real-provider measurement against isolated QA ports. It sends the same fixed passage through the actual configured model, verifies the final returned text, records send-to-first-audio and final-text-visible timing, and checks whether the owning server task is still running at first audio. It stops playback after those observations instead of pretending to measure full-passage audio completion.

Text-submit timings exclude microphone capture and STT. Browser-visible completion includes snapshot/poll timing and is not the raw provider's internal completion timestamp. Network, warm-up and model behavior vary, so a few local trials are not a latency guarantee. Native callback timing, full ordered playback and microphone-to-response tests are separate evidence.

Implementation and measurement status are recorded in `.internal/progress.md`. Do not infer production readiness or universal provider streaming support from this trial.
