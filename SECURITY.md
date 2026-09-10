# Security policy

## Scope and support status

`0.1.0a1` is a local alpha under development, not a production security commitment. There is no published supported-version matrix, response-time guarantee or completed formal security audit. Release preparation is not publication or certification.

Bind only to loopback. Do not expose the service through LAN binding, port forwarding, reverse proxies or public tunnels. Multiple conversations are not authenticated multi-user isolation. Hermes tools run with the current user's permissions; this dashboard is not a filesystem sandbox. Retain manual approvals for consequential actions. Cancellation cannot undo completed actions or provider charges.

The server prohibits embedding with CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Open it as a top-level browser page; iframe-based previews/embeds are intentionally unsupported. A real-browser regression checks cross-origin frame rejection, not just the header text.

## Reporting a vulnerability

Repository: [saadaliwaqar/hermes-voice-assistant](https://github.com/saadaliwaqar/hermes-voice-assistant). The repository is public and GitHub private vulnerability reporting is enabled and verified.

Use [Report a vulnerability](https://github.com/saadaliwaqar/hermes-voice-assistant/security/advisories/new) to submit a private report (GitHub sign-in required). The enablement setting was read back and the reporting control was verified on the public advisories page. No separate security email address is advertised. See [GitHub’s configuration guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configuring-private-vulnerability-reporting-for-a-repository).

Do not disclose exploit details in public issues. If the private reporting control is unavailable, request a private contact through an existing maintainer channel without posting sensitive details.

A private report should include:

- Affected version or commit, operating system and relevant configuration, with secrets removed.
- The trust boundary affected and potential impact.
- Minimal reproduction steps using synthetic data and, if safe, a proposed mitigation.
- Whether the issue is already public or appears to be actively exploited.

Do not send API keys, personal transcripts, local databases or private recordings. Avoid testing against anyone else's instance or data. Coordinate disclosure privately; no acknowledgement or fix deadline is promised by this alpha policy.

## Credentials and data

Keep provider keys in server-side configuration, never browser code, screenshots or command arguments. Never commit `.env` files, secret symlinks, histories or raw diagnostic artifacts. Audit staged files and the complete publication history before release.

Configured cloud models can receive conversation text; selected cloud TTS providers receive reply or preview text and may charge for requests. Local-first does not mean fully offline. See [privacy and data flow](docs/privacy.md) and [voice provider configuration](docs/voice-providers.md). No telemetry should be added without explicit opt-in and documentation.

See the [release checklist](docs/release-checklist.md) for verified scope and the limitations of this alpha.
