# Architecture and trust boundaries

Hermes Voice Assistant by Devsdroid.com is a community dashboard, not a replacement for Hermes Agent or an official Nous product.

## Intended alpha data flow
Browser -> same-origin local HTTP API -> session/task service -> Hermes adapter -> configured model and tools.
Browser microphone -> bounded audio upload -> local Whisper -> transcript.
Explicit spoken reply -> configured TTS provider -> browser playback.

SQLite retains session history and task results locally. A browser refresh reconnects to server-owned work. A server restart cannot resume arbitrary in-flight tool actions: uncertain work must be marked interrupted rather than silently replayed.

## Session ownership
Each session has its own conversation context, task records and approvals. The active browser session owns microphone/audio playback; switching sessions must not stop server-owned tasks or speak old responses. Multiple sessions are not multiple authenticated users. This alpha is a single local OS user's application; do not expose it to untrusted clients.

## Hermes integration
The initial adapter is expected to use the installed Hermes Python runtime behind a narrow compatibility boundary. Internal Python APIs are not guaranteed stable. Testing targets the installed Hermes revision; compatibility with future or older revisions must be verified, not assumed. A documented transport adapter can replace this boundary later where its capabilities fit.

## Explicit boundaries
- No provider credentials in static assets or browser settings.
- Dashboard preferences are separate from global Hermes settings.
- File/tool permissions follow the configured Hermes backend and approval policy; local-first does not mean sandboxed.
- Task completion is a worker response, not independent proof every requested goal succeeded.
- Cancellation is cooperative and cannot undo completed side effects.
- Full-duplex speech, remote hosting and crash-resume of arbitrary tools are outside alpha scope.
