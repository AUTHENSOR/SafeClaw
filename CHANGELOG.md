# Changelog

All notable changes to SafeClaw are documented here.

## [1.0.0-beta.2] -2026-02-13

### Fixed
- Setup wizard buttons not responding (CSP `script-src` was blocking inline handlers)
- Simplified API key instructions with direct links to key creation pages

### Changed
- SW cache bumped to `v1.0.0-beta.2`

## [1.0.0-beta.1] -2026-02-12

### Added
- **Risk signals** -non-blocking advisory badges on approval requests. Five signal types: `obfuscated_execution`, `pipe_to_external`, `credential_adjacent`, `broad_destructive`, `persistence_mechanism`
- Risk signal detection in classifier (`detectRiskSignals`) with pattern matching for base64-decode-to-shell, pipe-to-curl/nc, credential file paths, destructive system commands, and persistence mechanisms (crontab, launchctl, systemctl, shell rc files)
- Risk badges rendered in dashboard approval cards and SSE approval-waiting blocks (taupe `.badge-risk` styling)
- Browser notifications prefixed with risk signal summary when signals present
- SMS notifications (Twilio) include risk signal line when signals present
- Webhook payloads include `riskSignals` array
- Audit ledger entries include `riskSignals` array
- 28 new tests (classifier risk signal detection + gateway flow-through), 446 total across 24 files

### Changed
- `classify()` return shape extended: `{ actionType, resource }` → `{ actionType, resource, riskSignals }`
- Gateway hook threads `riskSignals` through all audit, SSE, SMS, and webhook paths
- SW cache bumped to `v1.0.0-beta.1`

## [1.0.0-beta] -2026-02-10

### Added
- **CSRF protection** on all POST/PUT/DELETE API endpoints (`X-Requested-With: SafeClaw` header required)
- **ReDoS protection** -policy regex patterns validated via static analysis before execution
- **Secrets redaction** -API keys in agent SSE output are replaced with `[REDACTED]` before reaching the browser
- **Structured JSON logger** (`src/logger.js`) writing to stderr, controlled by `SAFECLAW_LOG_LEVEL` env var
- **Graceful shutdown** -SIGTERM/SIGINT handlers close SSE connections, stop scheduler, drain server
- **Enhanced health check** -`/api/health` now returns version, uptime, scheduler status, audit integrity, pending approvals count
- **Error classification** -proper 400 (validation) and 404 (not found) HTTP status codes instead of blanket 500s
- **Input validation helpers** (`src/validate.js`) -`assertString`, `assertIn`, `safeRegex`, `redactSecrets`
- **CLI `--dry-run` flag** -preview task config, policy simulation, and budget status without starting the agent
- **Post-init smoke test** -`safeclaw init` automatically runs doctor diagnostics and prints a health summary
- **Rate limiting** expanded to all write endpoints (11 additional endpoints)
- **66 new tests** -security tests (CSRF, ReDoS, redaction, permissions, payloads), integration tests (real HTTP server), validation tests (418 total)

### Changed
- File permissions hardened to `0o600` across all sensitive file writes (audit, cache, session, scheduler, settings, policy)
- Inner handler error propagation respects `err.statusCode` for proper HTTP status classification
- Health endpoint returns comprehensive status object instead of just Authensor ping result

### Fixed
- User-supplied regex patterns in policy rules no longer vulnerable to ReDoS attacks
- Oversized request bodies (>1MB) properly rejected

## [0.9.0] -2026-02-09

### Added
- **Scheduler** with cron-based recurring tasks (`src/scheduler.js`), quiet hours, CRUD API
- **Policy versioning** -auto-version on save, backup files, rollback to any previous version
- **Policy dry-run/simulate** -test actions against policy rules without executing
- **Time-based policy rules** -schedule hours/days, auto-expire via `expiresAt`
- **PWA support** -service worker, manifest, offline app shell caching
- **Mobile responsive CSS** -600px breakpoint, touch-friendly tap targets
- **Swipe approvals** -swipe right to approve, left to reject on mobile
- 352 tests across 21 files

## [0.8.0] -2026-02-08

### Added
- **Conversation UI** -chat bubbles with markdown rendering, live-updating agent text
- **Follow-up messages** -continue task context after completion
- **Browser notifications** for pending approvals (Notification API)
- **Config import/export** -backup and restore via dashboard
- **Task queue** -multiple tasks queue instead of rejecting with 409
- Theme toggle (dark/light/auto) that persists

## [0.7.0] -2026-02-07

### Added
- **Claw Clinic** dashboard tab with diagnostic check-up UI
- Audit verify button with pass/fail banner
- Task runner enhancements (model selector, container checkbox, workspace input)
- Profile switcher in dashboard header
- Configuration panel (provider, API key, auth token from Settings)
- SMS configuration panel (Twilio setup from Settings)
- Per-task model override (never persists to config)
- Container mode from dashboard

## [0.6.0] -2026-02-06

### Added
- **Budget controls** -spending caps with daily/weekly/monthly periods, warn/require_approval/block actions
- **MCP analytics** -per-server call counts, action breakdown, allow rates
- **Security headers** -CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **Audit hash chain** -SHA-256 prevHash linking every entry, `safeclaw audit verify`
- **Doctor command** -10 diagnostic checks with actionable hints
- 250+ tests across 19 files

## [0.5.0] -2026-02-05

### Added
- **Analytics** -cost summary, approval metrics, tool usage, CSV/JSON export
- **Settings module** -configurable timeouts, retention, offline cache, webhooks
- **Offline decision cache** -memory + disk, TTL-based, fail-safe (only caches allows)
- **Rate limiting** -sliding window on task and approval endpoints
- **Webhook notifications** -Slack, Discord, and generic HTTP with format auto-detection

## [0.4.0] -2026-02-04

### Added
- **Audit ledger** -append-only JSONL with source tracking
- **Session history** -per-task JSON files with message/tool call recording
- **Policy editor** -visual CRUD, template picker, apply to control plane
- **Workspace scoping** -detect project boundaries, enforce path restrictions

## [0.3.0] -2026-02-03

### Added
- Production test suite (118 tests, vitest)
- Retry logic with exponential backoff (429/5xx/network errors)
- GitHub Actions CI (Node 20 + 22)

## [0.2.0] -2026-02-02

### Added
- OpenAI/GPT-4o provider support (custom agent loop, zero deps)
- Dashboard setup wizard with provider selection
- Auto-provisioning of Authensor demo tokens

## [0.1.5] -2026-02-01

### Added
- Localhost browser dashboard (Node http, 127.0.0.1:7700)
- Setup wizard, task runner with SSE streaming
- Approval center (list, approve, reject)
- Dark/light theme

## [0.1.0] -2026-01-31

### Added
- Local agent runner (Claude Agent SDK)
- Authensor gateway (PreToolUse hook)
- Action classifier with secret sanitization
- CLI (init, run, approvals, receipts, policy, health)
- Standalone approvals UI
- Container mode (Docker/Podman)
- SMS notifications via Twilio
- Deny-by-default policy templates
