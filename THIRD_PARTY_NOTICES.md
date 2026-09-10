# Third-party notices and distribution scope

The original Hermes Voice Assistant by Devsdroid.com code is MIT-licensed; see LICENSE. This does **not** relicense Hermes Agent, dependencies, voice models, hosted services or trademarks. This is a release-review aid, not legal advice or a legal certification.

## What is distributed

The source candidate and dashboard-only wheel distribute this project's code, assets and documentation. They do not bundle Hermes Agent, a Python runtime, `node_modules`, third-party wheels, a preinstalled speech engine, or model weights. Dependencies are obtained separately during installation. The dashboard wheel includes LICENSE and this file.

**Do not treat this file as a complete notice/source package for a bundled installer, container, executable or environment archive.** Reassess the exact resolved packages, native libraries and models before creating one. Optional status does not waive a dependency's license. MIT licensing of the original source does not resolve whether a particular combined distribution is subject to copyleft.

## Direct Python dependencies

Reviewed 2026-09-10. Base and Piper versions below are from local installed distribution metadata; speech-extra versions were checked against PyPI version metadata and a no-install resolver run, not claimed as installed in the project environment.

| Component | Reviewed version | Declared license |
|---|---|---|
| FastAPI | 0.141.1 | MIT |
| Uvicorn | 0.52.4 | BSD-3-Clause |
| HTTPX | 0.28.1 | BSD-3-Clause |
| platformdirs | 4.11.8 | MIT |
| python-multipart | 0.0.32 | Apache-2.0 |
| PyYAML | 6.0.3 | MIT |
| faster-whisper (`speech` extra) | 1.2.1 | MIT |
| edge-tts (`speech` extra) | 7.2.7 | LGPLv3; MIT for `srt_composer.py` |
| piper-tts (`piper` extra) | 1.8.0 | GPL-3.0-or-later |

Dependency ranges are not a lockfile. Other platforms, Python versions and future installations can resolve differently. Each distribution's actual license texts and bundled notices control, not just its metadata label.

## Transitive dependencies and obligations

- **Base environment:** Starlette, Click, HTTPcore and idna declare BSD-3-Clause; AnyIO, h11, Pydantic/pydantic-core, annotated-types, annotated-doc and typing-inspection declare MIT; typing-extensions declares PSF-2.0. Retain applicable copyright, license and disclaimer texts when redistributing those components. Apache-2.0 components require preservation of applicable notices and identification of modifications, among other terms.
- **certifi 2026.7.22 is MPL-2.0**, reached through HTTPX/HTTPcore and also Edge TTS. Do not describe the complete base dependency tree as MIT/BSD-only. Redistribution of covered files/executables requires the applicable MPL notices and source availability; file-level copyleft does not automatically relicense unrelated original files. See the [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) and [license](https://www.mozilla.org/MPL/2.0/).
- **Edge TTS:** the actual 7.2.7 wheel license identifies LGPLv3 for files other than the MIT `srt_composer.py`. Redistributing the library or a combined work requires the relevant GPL/LGPL texts, notices, corresponding source/relinking or replacement arrangements and other applicable conditions. Do not prevent debugging of library modifications. The library license does not grant Microsoft service access or voice-use rights. [Upstream license](https://github.com/rany2/edge-tts/blob/master/LICENSE); [version metadata](https://pypi.org/pypi/edge-tts/7.2.7/json).
- **Piper:** 1.8.0 declares GPL-3.0-or-later, not the license of an older similarly named Piper project. The dashboard imports `piper.PiperVoice` in-process; optional installation is not evidence that a combined distribution is outside GPL scope. Before distributing an integrated runtime, assess GPL coverage and corresponding-source obligations, including native speech libraries. The installed Piper distribution also carries an Apache-2.0 notice for g2pW-derived code. [Piper source and license](https://github.com/OHF-Voice/piper1-gpl); [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html).
- **Whisper's software dependency tree is not uniformly MIT:** faster-whisper brings CTranslate2, Hugging Face Hub, tokenizers, ONNX Runtime, PyAV and tqdm. The reviewed resolver selected **tqdm 4.70.0, declaring MPL-2.0 AND MIT**; preserve its applicable file-specific licenses. Hub/tokenizers and several networking dependencies use Apache-2.0. [faster-whisper version metadata](https://pypi.org/pypi/faster-whisper/1.2.1/json); [tqdm license](https://github.com/tqdm/tqdm/blob/master/LICENCE).
- **PyAV/native codecs need separate review:** PyAV 18.1.0's package metadata declares BSD-3-Clause, but its reviewed macOS ARM64 wheel includes FFmpeg and codec libraries, including `libx264` and `libx265`. A BSD-only package label is not a license inventory for those binaries. FFmpeg's applicable LGPL/GPL terms depend on its build; source availability, notices, relinking requirements and codec/patent considerations must be checked for the exact redistributed build. This review did not establish a complete native-library license/source inventory. No PyAV/FFmpeg binary is bundled in the dashboard wheel. [PyAV installation documentation](https://pyav.org/docs/stable/overview/installation.html); [FFmpeg legal guidance](https://ffmpeg.org/legal.html).
- **Piper/Whisper native dependencies:** ONNX Runtime declares MIT but has its own third-party notices; NumPy 2.4.6 declares `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`. FlatBuffers declares Apache-2.0, protobuf BSD-3-Clause, and packaging `Apache-2.0 OR BSD-2-Clause`. A bundled runtime needs the actual wheel/platform notices, not just these summaries.

## Models and services

No model weights/configurations are included in the candidate. The transcription implementation requests Whisper `base`; the [SYSTRAN faster-whisper-base card](https://huggingface.co/Systran/faster-whisper-base) declares MIT. Record the exact model revision and retain its applicable notices if redistributing it; this is not a blanket statement about other models or training data.

Piper only discovers models already installed in a configured local directory. The documentation's `en_US-ljspeech-medium` example has a [model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD) that identifies the **dataset** as public domain. That dataset statement alone is not a comprehensive license grant for every model artifact or every voice. Verify each chosen model's provenance, weight/configuration terms and voice/personality rights before redistribution or commercial use. Model caches and local private voices were not inspected in this review.

OpenAI, ElevenLabs, Microsoft Edge and other configured providers retain their own service, usage and voice-rights requirements. An open-source client license does not replace them.

## Development tooling and Hermes integration

The reviewed Node lockfile declares Apache-2.0 for `@playwright/test`, `playwright` and `playwright-core` 1.63.0, and MIT for Prettier 3.9.6. Browser binaries have separate upstream notices. These are development tools, not dashboard-wheel contents. Reviewed Python test/build tools include pytest, Ruff, build, pluggy, iniconfig and pyproject-hooks (MIT), Pygments (BSD-2-Clause), and packaging (Apache-2.0 OR BSD-2-Clause). Build-backend and future resolver versions also require review if redistributed.

Hermes Agent is a separately installed prerequisite maintained by Nous Research. Its [upstream LICENSE](https://github.com/NousResearch/hermes-agent/blob/main/LICENSE) is MIT, copyright 2025 Nous Research; retain that notice if copying or distributing its code. Its dependency tree is separate and is not audited by the dashboard's inventory. This community dashboard does not claim official endorsement or trademark rights.
