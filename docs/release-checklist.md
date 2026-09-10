# Public release checklist

Repository: [saadaliwaqar/hermes-voice-assistant](https://github.com/saadaliwaqar/hermes-voice-assistant), branch `main`. Repository creation and source push were authorized and verified. Visibility remains **private**; public publication requires separate approval.

## Verified preparation

- [x] Original dashboard code licensed MIT by owner choice; LICENSE and package metadata added.
- [x] Direct-dependency license inventory and optional Piper/Edge/model caveats documented; no bundled runtime/model weights.
- [x] Screenshot-led README, alpha notes, contribution/security guidance and real clone URL prepared.
- [x] Actual About description/topics and private visibility read back from GitHub.
- [x] Studio Core/Daylight screenshots refreshed from isolated empty data and documentation images reviewed for visible private information.
- [x] Initial local checks: 100 Python, 55 browser and 18 Node speech/geometry checks passed.
- [x] Clean macOS Python 3.12 wheel onboarding/save/restart checked with Hermes absent; not a full independent Hermes setup.
- [x] Cross-origin framing gap reproduced, fixed and checked in a real browser.
- [x] Public-source candidate rejects symlinks, checks relative documentation links, scans selected secret/path patterns and verifies ZIP read-back hashes.
- [x] Initial remote commit and all 97 intended files matched the source manifest; local environments, internal notes and private data were excluded.

See [verification scope](release-verification.md), [third-party notices](../THIRD_PARTY_NOTICES.md) and [repository metadata](github-metadata.md).

## Final prepublication checks

- [x] Fix Windows MIME/process-test failures; [remote CI](https://github.com/saadaliwaqar/hermes-voice-assistant/actions/runs/34440221742) passed on the fix commit `65f5985` across macOS, Ubuntu and Windows. Local checks passed: 104 Python, 55 browser, 18 Node.
- [x] Gitleaks 8.30.1 all-ref history and extracted allowlisted candidate scans returned zero findings. Final commits are rescanned before push; binary/privacy and unknown-secret limits remain.
- [x] Review transitive dependency/model terms for dashboard-only source/wheel; expanded third-party notices document copyleft/native-codec limits. No bundled-runtime approval or legal certification is claimed.
- [x] Independently install runtime dependencies and dashboard wheel; verify real chat and browser voice loop with existing authentication/cache reuse explicitly recorded.
- [x] Normal existing-login setup passed using an authorized temporary credential store outside the repository: model probe, no probe settings/session changes, save/read-back, completion and restart persistence. Temporary credentials were removed and the original auth hash was unchanged. New-account OAuth is outside the verified scope.
- [x] Update verification records to match executed checks and supported scope, including existing-login setup success and the untested new-account OAuth boundary.

## Approved launch approach, not yet executed

- [x] Owner selected GitHub private vulnerability reporting rather than an unverified contact email.
- [ ] Obtain explicit public-visibility approval.
- [ ] Change visibility, then enable and read back GitHub private reporting before announcing the alpha. This feature requires a public repository; it is not verified while private.
- [ ] Verify public README/screenshots/source and reporting control. If a release with binary assets is separately requested, audit and read back those exact assets as well.

## Not claimed by this alpha

Production security certification, real-room voice quality, comprehensive accessibility/load testing and useful model/audio streaming overlap are not established. Package CI does not certify full live model/audio compatibility on each operating system. Streaming remains default-off. No fabricated metrics or search-ranking guarantees.
