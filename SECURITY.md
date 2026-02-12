# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in SafeClaw, please report it responsibly.

**Do not open a public issue.** Instead, email us at:

**security@authensor.com**

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide an initial assessment within 5 business days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x-beta | Yes |
| < 1.0.0 | No |

## Security Model

SafeClaw is a localhost-only application. The server binds to `127.0.0.1` and is never exposed to the network. The security model relies on:

- **Deny-by-default policy** -- unknown actions are blocked, not allowed
- **Localhost-only binding** -- same trust model as Jupyter, VS Code, and similar dev tools
- **CSRF protection** -- custom `X-Requested-With` header required on all write endpoints
- **Fail-closed gateway** -- if the Authensor control plane is unreachable, all actions are denied
- **Secrets isolation** -- API keys are stored locally with 0o600 permissions and never transmitted
- **Tamper-evident audit** -- SHA-256 hash-chained audit log detects modifications
- **Rate limiting** -- all write endpoints are rate-limited
- **Input validation** -- ReDoS protection, body size limits, path traversal prevention

## Scope

The following are in scope for security reports:

- Bypass of the deny-by-default policy
- Path traversal or file access outside allowed boundaries
- XSS or injection in the dashboard
- Secret leakage (API keys appearing in logs, network traffic, or UI)
- Audit log tampering that bypasses integrity verification
- CSRF bypasses
- Denial of service via crafted inputs

The following are out of scope:

- Issues requiring physical access to the machine
- Social engineering
- Vulnerabilities in dependencies (report to the dependency maintainer)
- Issues only exploitable by a local user with shell access (localhost trust model)
