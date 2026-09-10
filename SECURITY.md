# Security policy

## Scope and support status

`0.1.0a1` is a local alpha under development, not a production security commitment. There is no published supported-version matrix, response-time guarantee or completed formal security audit. Release preparation is not publication or certification.

Bind only to loopback. Do not expose the service through LAN binding, port forwarding, reverse proxies or public tunnels. Multiple conversations are not authenticated multi-user isolation. Hermes tools run with the current user's permissions; this dashboard is not a filesystem sandbox. Retain manual approvals for consequential actions. Cancellation cannot undo completed actions or provider charges.

The server prohibits embedding with CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Open it as a top-level browser page; iframe-based previews/embeds are intentionally unsupported. A real-browser regression checks cross-origin frame rejection, not just the header text.

## Reporting a vulnerability

**No private reporting address or published repository destination is currently advertised or verified.** Before publication, the maintainer must establish and verify a private reporting channel.

If the project is published on GitHub **and private vulnerability reporting is enabled**, use that repository's **Security → Report a vulnerability** control. Do not assume it is available until the actual repository and setting are confirmed. Otherwise, request a private contact through an existing maintainer communication channel without disclosing exploit details. If no channel exists, withhold sensitive details until one is announced; do not put them in a public issue.

A private report should include:

- Affected version or commit, operating system and relevant configuration, with secrets removed.
- The trust boundary affected and potential impact.
- Minimal reproduction steps using synthetic data and, if safe, a proposed mitigation.
- Whether the issue is already public or appears to be actively exploited.

Do not send API keys, personal transcripts, local databases or private recordings. Avoid testing against anyone else's instance or data. Coordinate disclosure privately once a channel exists; no acknowledgement or fix deadline is promised by this alpha policy.

## Credentials and data

Keep provider keys in server-side configuration, never browser code, screenshots or command arguments. Never commit `.env` files, secret symlinks, histories or raw diagnostic artifacts. Audit staged files and the complete publication history before release.

Configured cloud models can receive conversation text; selected cloud TTS providers receive reply or preview text and may charge for requests. Local-first does not mean fully offline. See [privacy and data flow](docs/privacy.md) and [voice provider configuration](docs/voice-providers.md). No telemetry should be added without explicit opt-in and documentation.

Security review, a working private reporting channel and clean-install verification remain [release gates](docs/release-checklist.md).
