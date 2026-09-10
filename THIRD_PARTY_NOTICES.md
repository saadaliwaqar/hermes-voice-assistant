# Third-party notices and distribution scope

The original Hermes Voice Assistant by Devsdroid.com code is MIT-licensed; see LICENSE. This does **not** relicense Hermes Agent, Python/Node dependencies, voice models, hosted APIs or their trademarks.

This candidate distributes dashboard source and a dashboard-only wheel. It does not bundle Hermes, a Python runtime, node_modules, third-party wheels, model weights, credentials or a preinstalled speech engine. Installation resolves dependencies separately. Do not turn this into a bundled installer without reviewing the exact bundled components and their corresponding notice/source obligations.

## Direct Python dependencies

License metadata observed in the tested development environment, not a complete transitive license audit:

| Component | Observed version | Declared license |
|---|---|---|
| FastAPI | 0.141.1 | MIT |
| Uvicorn | 0.52.4 | BSD-3-Clause |
| HTTPX | 0.28.1 | BSD-3-Clause |
| platformdirs | 4.11.8 | MIT |
| python-multipart | 0.0.32 | Apache-2.0 |
| PyYAML | 6.0.3 | MIT |
| faster-whisper (optional speech) | 1.2.1 | MIT |
| edge-tts (optional speech) | 7.2.7 | LGPLv3 classifier |
| piper-tts (optional offline speech) | 1.8.0 | GPL-3.0-or-later |

Dependency constraints can resolve to different versions. Inspect each resolved distribution's own license files. Transitive native libraries and downloaded models have separate licenses. The release candidate's clean base-environment inventory is evidence of tested versions, not a promise that future installation resolves identically.

## Speech and models

- Piper is **optional** and is not in the default installation. Its GPL license is not superseded by this project's MIT license. Review applicable copyleft and corresponding-source requirements for any combined distribution; do not label a bundled Piper runtime as MIT-only.
- Edge TTS is an optional LGPL dependency. Its upstream notices and any obligations for redistribution/modification remain applicable. Cloud service terms are separate from the client library's software license.
- Voice weights/configurations are not included. Review the model card/license for every model before download, redistribution or commercial use. No blanket license is asserted for all Piper or Whisper models.
- OpenAI/ElevenLabs and other configured cloud providers retain their own service, usage and voice rights requirements.

## Development and upstream integration

Playwright, Prettier, pytest, Ruff and build tooling are separate development dependencies, not bundled into the dashboard wheel. Their licenses and browser binary distribution terms remain their own. Hermes Agent is a separate prerequisite maintained by Nous Research; this community dashboard does not claim official endorsement. See https://github.com/NousResearch/hermes-agent for its source and license.

This inventory is a release-review aid, not legal advice or completion of a full dependency/commercial licensing review.
