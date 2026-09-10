# Privacy and data flow

The dashboard runs locally, but its configured model or voice provider may be remote.

| Data | Intended destination |
|---|---|
| Microphone audio | Local server and local Whisper when local transcription is selected |
| Conversation text | Configured Hermes model provider |
| Spoken reply text | Explicitly selected cloud TTS provider, local Piper engine, or no TTS in text-only mode |
| Voice preview sample | Fixed sample sent to the selected cloud TTS provider or synthesized by local Piper; not saved as chat history |
| Session history and task results | Local dashboard data directory; the separate Hermes runtime may also retain logs or trajectories according to its configuration |
| Provider credentials | Server-side environment/Hermes configuration, never frontend |

Microphone capture starts only on an explicit user action. Switching sessions ends capture/playback to avoid cross-session audio. Browser refresh should not resend a task. Retained history contains potentially sensitive tool output; deleting a conversation must have explicit semantics and must not imply deleting external files a task created.

Deleting a dashboard session removes its logical SQLite records, not backups, SQLite free pages/WAL remnants, external files, cloud-provider records or possible upstream Hermes logs/trajectories. It is not secure erasure. The dashboard is not an access-control boundary against other programs or untrusted users on the same machine.

No telemetry is planned by default. This alpha does not promise private/offline inference merely because the dashboard URL is localhost. Shared profile-level Hermes memory is a distinct concern from per-session history; check adapter behavior and settings before making isolation claims.
