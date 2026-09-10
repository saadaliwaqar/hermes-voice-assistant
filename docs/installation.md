# Installation and compatibility

This is a local alpha, not a published package release. The source tree is the installation source.

## Prerequisite: a functioning Hermes runtime
Use a Python environment in which `from run_agent import AIAgent` works, following the official [Hermes Python library guide](https://hermes-agent.nousresearch.com/docs/guides/python-library). Hermes does not currently provide a supported PyPI wheel for this purpose.

`HERMES_SOURCE` can point to an existing Hermes checkout; it does not install that checkout's Python dependencies. A plain fresh dashboard virtualenv is sufficient for the UI/storage but not necessarily for model/tool execution. A child venv's `--system-site-packages` does not automatically inherit another venv's dependencies.

Install this dashboard into your chosen Hermes-enabled environment using that environment's package manager:

```sh
python -m pip install -e ".[speech,test]"
hermes-voice
```

If that environment has no pip, use `uv pip install --python <path-to-that-python> -e ".[speech,test]"`. These commands install into the explicitly chosen environment. They do not install Hermes itself. The app defaults to http://127.0.0.1:8780. `hermes-voice --port 8781` selects another loopback port.

## Guided first-run setup
The dashboard includes a first-run wizard and a **Setup** button to reopen it. It checks the actual app interpreter, distinguishes missing runtime from missing optional speech, and offers explicit model/microphone/speaker tests. It does not install Hermes or handle credentials in the browser. See [first-run setup](setup.md).

## Configuration
- `HERMES_SOURCE`: optional path to the supported Hermes checkout.
- `HERMES_HOME`: upstream Hermes configuration location, if applicable. Alternate profile behavior requires additional validation.
- `HERMES_VOICE_DATA_DIR`: optional local history/settings directory. Otherwise platformdirs chooses the user data location.
- `HERMES_VOICE_ELEVENLABS_KEY`: optional server-side key if ElevenLabs is explicitly selected. Never put it in browser code or command arguments.

The Settings dialog chooses provider, default/worker model, optional conversation-model override, voice provider, voice and language. It does not accept API keys or edit upstream configuration. Text-only is the portable default; Edge, ElevenLabs and OpenAI are opt-in cloud speech providers. Piper is optional local speech. See [voice setup and previews](voice-providers.md) for keys, model installation and licensing. Local Whisper's first transcription may download its base model.

## Local macOS helper
The optional `Start Hermes Voice.command` uses an already prepared project `.venv`, opens the browser and stores local development data in `.local/app`. It does not install dependencies or run at login. Keep its Terminal open; Control+C stops it. The helper is macOS-specific, while the package CLI is platform-neutral.

## Verified scope
- macOS: actual Hermes-enabled Python 3.11 integration and Chrome browser tests.
- Clean macOS Python 3.12: wheel installation, static assets and session API smoke with Hermes absent.
- Installed Hermes revision tested: `21b2095d00`.
- Windows/Linux: CI matrix is configured, but remote CI and installation have not yet run. Do not interpret configuration as a support guarantee.

Core AIAgent use is documented upstream; runtime-provider and approval-policy helpers are version-sensitive. New Hermes releases need compatibility checks.
