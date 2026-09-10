# Voice providers and previews

Voice output is independent of the model used for chat or workers. Settings are local to this dashboard, not upstream Hermes configuration.

## Choose and preview

Open **Settings**, choose a **Speech provider**, search its voices and select one. The manual voice name/ID field remains available for voices that cannot be listed. **Preview voice** speaks a fixed short sample without saving settings or adding a chat message. Save only when satisfied. Previewing stops microphone capture; start the microphone again explicitly afterward. Changing the selection or closing Settings stops preview playback.

Cloud previews transmit the fixed sample to the chosen provider and may incur charges. There is no automatic provider fallback. Provider readiness means configuration/dependencies are present, not that a paid account's billing, quota or credentials have been successfully authenticated.

## Providers

| Provider | Setup | Audio processing |
|---|---|---|
| None | No setup | No speech output |
| Edge | Install `[speech]`; no key | Internet service, not an offline engine or a contractual production SLA |
| ElevenLabs | `HERMES_VOICE_ELEVENLABS_KEY` | Cloud; voice IDs are provider-specific |
| OpenAI | `HERMES_VOICE_OPENAI_KEY` | Cloud; separate API billing from ChatGPT/Codex subscription |
| Piper | Install `[piper]`, download a model, set `HERMES_VOICE_PIPER_DIR` | Local CPU synthesis after installation/model download |

Keys belong in the **server process environment**, never browser JavaScript, screenshots, Git or chat. The dashboard does not reuse your Codex OAuth login as an OpenAI speech API key. Restart the server after changing environment variables. Do not put key values into command-line arguments.

ElevenLabs catalog access requires voice-listing permission. If listing fails, an existing valid voice ID may still synthesize successfully. The UI keeps the manual ID field for this situation. Edge lists are obtained from its service. OpenAI voice names come from a documented built-in list. Piper lists model pairs already present in its configured folder; selecting it does not download models.

## Piper installation

Use the same Python environment as the dashboard:

```sh
python -m pip install -e '.[piper]'
python -m piper.download_voices --download-dir /absolute/path/to/piper-voices en_US-ljspeech-medium
export HERMES_VOICE_PIPER_DIR=/absolute/path/to/piper-voices
hermes-voice
```

The folder must contain both `en_US-ljspeech-medium.onnx` and `en_US-ljspeech-medium.onnx.json`. The voice ID is `en_US-ljspeech-medium`, not an arbitrary filesystem path. Use trusted model files only.

The macOS development launcher also detects a pre-existing `.local/piper-voices` folder in the project unless `HERMES_VOICE_PIPER_DIR` is explicitly set. It does not install or download anything. This machine has an LJ Speech model in that local ignored folder for testing; it is not bundled into the distributable wheel.

**Licensing:** current Piper is GPL-3.0. It is an optional dependency, not bundled here. Review distribution obligations before publishing an installer that includes it. Voice models have their own model-card and dataset terms. The [LJ Speech model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD) identifies its dataset as public domain; this is not a blanket license claim about all Piper voices.

## Speech startup
Replies are spoken in bounded chunks with one-chunk prefetch. Interrupt cancels pending synthesis as well as playback; Piper reuses one loaded engine. See [latency measurements and limitations](voice-latency.md). More chunks can mean more provider requests, not a claim of native realtime speech.

## Verification boundaries

The automated suite covers provider routing, missing setup, response handling, invalid input, voice catalogs, settings persistence and preview lifecycle. Mocked HTTP responses test API contracts, not a paid service's availability. A live paid OpenAI synthesis requires the dedicated key and credit; do not treat contract tests as a live provider pass. Local Piper and Edge can be exercised independently without that key.

Speech is AI-generated. The dashboard remains an alpha and does not provide full-duplex/barge-in voice conversation.
