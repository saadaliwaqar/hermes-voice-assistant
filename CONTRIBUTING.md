# Contributing

Hermes Voice Assistant by Devsdroid.com is an independent community project, not an official Nous Research product. This is a prepared local alpha, not a published release. Original dashboard code uses the [MIT License](LICENSE). Dependency and voice-model licenses are separate. Submit only code you have permission to contribute under the project license; retain required third-party notices.

## Before changing code

- Read the [installation guide](docs/installation.md), [architecture](docs/architecture.md), [privacy](docs/privacy.md) and [security policy](SECURITY.md).
- Keep changes focused. Include a reproduction, expected behavior and test evidence; distinguish mocked contracts from actual provider execution.
- Preserve explicit worker dispatch, approval checks, session-bound audio, text-only defaults and separation from upstream Hermes settings.
- Keep the [early-speech trial](docs/early-speech.md) off by default. A timing difference alone is not evidence of streaming acceleration.
- Do not commit credentials, local histories, recordings, private transcripts, model weights or test artifacts. Capture screenshots only from an isolated service with non-private data.

Once a repository is published and contributions are enabled, use issues for non-sensitive bugs and pull requests for focused changes. No repository destination or contribution portal is advertised yet. Security reports follow the private-channel policy below, not public issues.

## Local deterministic checks

Run from the project source directory in your chosen Python 3.11+ environment:

```sh
python -m pip install -e ".[test]"
python -m pytest
ruff check src tests
ruff format --check src tests
npm ci --ignore-scripts
npm run test:syntax
npm run test:speech
npm run test:orb
```

These checks do not establish live provider availability. For model/tool execution, the running Python interpreter also needs a functioning Hermes runtime; installing this dashboard alone does not supply one.

## Browser checks: use isolated data

The Playwright configuration does not start a server. It defaults to Chrome; install Chrome or explicitly configure a suitable installed Playwright channel. Do not point tests at your everyday service: tests may create sessions and change settings.

In one terminal, start a dedicated loopback service with a new disposable data directory:

```sh
HERMES_VOICE_DATA_DIR="$(mktemp -d)" hermes-voice --port 8781
```

In another terminal, from the source directory:

```sh
HERMES_VOICE_TEST_URL=http://127.0.0.1:8781 npm run test:browser
```

Stop only that test server with Control+C afterward. Use separate ports, data and Playwright output directories for concurrent runs. Review failure traces for private data before sharing.

## Optional integration and packaging checks

`python -m build` creates source and wheel artifacts. The [setup guide](docs/setup.md) describes the clean wheel smoke test and its missing-Hermes boundary.

Live scripts in `tests/integration/live_alpha.py` and `tests/browser/voice-live.mjs` are explicit opt-ins. Inspect their configuration first and use isolated test data and prerecorded non-private audio. They require the configured Hermes/provider/speech dependencies and may incur charges or execute tools. Never weaken approvals to obtain a passing test. See [voice providers](docs/voice-providers.md) for dedicated speech credentials and optional dependency/model licensing.

For speech changes, check interruption, session switching, stale callbacks, final-text attribution and failure cleanup, not just first-audio timing. See [speech measurements](docs/voice-latency.md) and [early-speech methodology](docs/early-speech.md).

## Evidence to include

Report commands, OS/Python/browser versions, which tests passed or failed, and whether providers were real or mocked. Latest recorded local results are 100 Python, 55 browser and 18 Node speech/geometry tests passed. They are historical development evidence, not a guarantee for a new change. Remote CI, Windows/Linux execution and a full independent Hermes installation remain unverified. Do not claim those gates passed without actually exercising them.
