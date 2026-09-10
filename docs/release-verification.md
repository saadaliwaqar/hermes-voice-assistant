# Alpha candidate verification

Status: source is publicly available with owner approval; private vulnerability reporting is enabled and verified. These checks are not production certification.

## Latest regression and CI evidence

- Local Python: **104 tests passed**, including four hostile host-MIME mapping regressions. Browser asset MIME types are now response-local rather than dependent on Windows registry settings.
- Local Chrome: **55 browser tests passed** on isolated port 8784, including cross-origin framing rejection, ownership, sessions and speech contract tests. QA was stopped afterward; the live service was not changed.
- Node: **15 speech + 3 geometry tests passed**. Python lint/format and frontend syntax checks passed.
- [GitHub run 34440221742](https://github.com/saadaliwaqar/hermes-voice-assistant/actions/runs/34440221742), commit `65f5985`: successful Python tests/source-candidate/build jobs on macOS, Ubuntu and Windows with Python 3.11/3.12; frontend syntax/Node job passed. This closes the initial Windows MIME and process-test failures. It does not establish physical microphone or live provider support on all platforms.

## Independently installed Hermes runtime and existing-login setup: pass

A fresh Python 3.11.15 environment on macOS arm64 installed Hermes revision `21b2095d00a98b8ad7b5c60b10587619c852cdb8` and a dashboard wheel built from committed dashboard revision `d8ad90b`. Dependencies were installed independently, without a private development `.pth` bridge or inherited site packages. `uv pip check` reported 93 compatible packages. Committed sources were extracted with `git archive`, not downloaded in a fresh network clone.

Actual results:

- Real subscription-model chat completed and was read back from the session API.
- Local Whisper transcription returned HTTP 200.
- Prerecorded browser microphone → Whisper → real model → Edge synthesis → actual browser playback passed. Synthesis returned HTTP 200; session switch released microphone tracks; no browser JavaScript errors occurred.
- A cached Whisper base model, existing Chrome and a prerecorded voice fixture were reused. Model downloading was disabled. No paid TTS provider was used.

The initial QA-only in-memory credential bridge did not reach the wizard subprocess (`codex_auth_missing`). That was not counted as a successful setup test.

**Follow-up normal existing-login setup passed.** With explicit owner permission, only the configured provider login was copied to a mode-0600 file in a mode-0700 temporary directory outside the repository. The independently installed runtime used its normal credential-store path, without authentication monkeypatches. The installed dashboard wheel included the Windows fix. The model probe returned `ok: true`; settings and sessions were unchanged by the probe. Settings save/read-back, setup completion and restart persistence passed. The QA server stopped, temporary credential directory was removed, and the original auth-file hash was unchanged. An initial cleanup assertion mistook socket TIME_WAIT for an active listener; the corrected harness rerun passed.

New-account OAuth, token refresh and a clean model download remain outside this existing-Hermes-user alpha verification. No temporary credentials or QA harness are published.

This live test covered the initial committed voice implementation; the subsequent MIME-only production change was separately covered by current regression/CI checks. Prerecorded capture misheard “Hello” as “Allow”, so pipeline success is not perfect transcription or real-room quality certification.

## Source, history and distribution review

- Source remains allowlisted: credentials, histories, local environments, internal notes and model weights are excluded. Initial remote commit/tree matched all 97 intended files.
- Gitleaks 8.30.1 was installed in isolation from an upstream-checksummed archive. Initial complete history, commit metadata/path inventory and public-tree snapshot scans returned zero findings; the parent repeated all-ref history scanning after the Windows fix with zero findings. The extracted final allowlisted candidate also returned zero findings. Final documentation commits are rescanned before push; scanner results do not certify arbitrary secret formats.
- Secret scanning is heuristic, not proof that arbitrary encoded secrets or private binary content cannot exist. Six documentation screenshots were previously reviewed visually from isolated data.
- Dependency review covered installed base/Piper metadata, a representative resolved speech dependency tree and selected wheel/license contents. See [third-party notices](../THIRD_PARTY_NOTICES.md). No unconditional license blocker was established for original dashboard source and a dashboard-only wheel. This is not legal certification or approval to bundle Hermes, Piper, PyAV/FFmpeg/codecs or model weights.
- The dashboard wheel was rebuilt with the expanded notices, which were read back from its license directory and matched against the source notice file.

## Reproduction and limits

```sh
python -m pytest tests/unit tests/integration
npm run test:syntax
npm run test:speech
npm run test:orb
python scripts/release_candidate.py
python -m build
```

Browser checks require an isolated running service; see [Contributing](../CONTRIBUTING.md). Live tests require explicit configured authentication and speech prerequisites. A dashboard-only clean Python 3.12 wheel had separately passed missing-Hermes onboarding/save/restart checks.

Public switch completed with explicit owner approval. GitHub returned public visibility and private reporting enabled. Anonymous repository, README and Studio-image requests returned HTTP 200, and the public advisories page exposed the reporting control. No public release assets, bundled installers or PyPI release are implied. Streaming remains default-off with no demonstrated early-audio advantage.
