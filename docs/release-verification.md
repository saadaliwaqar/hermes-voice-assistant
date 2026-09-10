# Alpha candidate verification

Status: local release preparation, not publication or production certification.

## Executed locally

- Python 3.11: 100 deterministic tests passed, including native-streaming contracts, release metadata/allowlist guards and framing headers.
- Fresh Python 3.12 environment: dashboard wheel installed without the private development runtime bridge. Missing-Hermes setup, save/read-back and restart persistence passed. This is **not** a complete independent Hermes-enabled installation.
- Chrome: 55 browser tests passed against that clean installed wheel, including actual cross-origin iframe rejection and successful top-level dashboard use. Provider/audio contract fixtures in these tests do not replace real provider certification.
- Node: 15 speech tests and 3 geometry tests passed. Python lint/format and frontend syntax checks passed.
- Refreshed Studio Core/Daylight screenshots came from isolated empty data. Daylight capture was corrected to finish CSS transitions before capture; no stylesheet change was necessary. All six documentation PNGs were visually reviewed for visible private data.
- Earlier development evidence separately includes actual Hermes session/worker workflows and prerecorded microphone → Whisper → model → Edge playback. Those live model calls were not rerun as part of package-only verification.

## Candidate production and audit method

```sh
python scripts/release_candidate.py
python -m build
```

The first command makes a public-file allowlisted ZIP under `.local/release-candidate`, checks relative Markdown file links, rejects symlinks and selected secret/home-path patterns, emits a SHA-256 source manifest, and reads the resulting ZIP back to verify its exact contents. It does not initialize Git, stage files or publish. The second command builds the dashboard wheel and source distribution; the manifest excludes private runtime/development directories.

A heuristic scan is not an exhaustive secret or vulnerability audit. Binary screenshots require separate visual review; complete intended Git history must be audited if a repository is subsequently created/imported. No Git repository or publication history existed during preparation.

## Not verified / remaining publication gates

- Confirm the destination owner/organization and repository name; obtain explicit publication authorization.
- Establish and verify private vulnerability reporting before making a repository public.
- Review all resolved dependency/model licenses for the actual distribution. Original code is MIT; optional LGPL/GPL components are not relicensed or bundled into this dashboard-only candidate.
- Run remote CI and any advertised platform/independent Hermes-install checks. Windows/Linux execution, real-room audio quality and large-history/load behavior remain unverified.
- Streaming stays default-off: useful generation/audio overlap is not demonstrated on the tested runtime.

Source code, license and docs are prepared for review. Do not interpret an archive, configured CI matrix or passing local suite as completion of the gates above.
