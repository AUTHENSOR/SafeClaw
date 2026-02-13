**SafeClaw Plan**

**Goal**
A safe-by-default local AI agent that runs Claude locally, gates every action through Authensor, and keeps your API keys on your machine. Idiot-proof setup: plug in your key, go.

**Architecture**
- Agent runs locally via Claude Agent SDK
- Every tool call intercepted by PreToolUse hook (gateway.js)
- Action metadata (type + resource) sent to Authensor control plane for policy evaluation
- API keys never leave the machine
- Fail closed if Authensor unreachable

**Phase 0 (current): Scaffolding** ✓
- [x] Local agent runner with Claude Agent SDK
- [x] Authensor gateway (PreToolUse hook → POST /evaluate)
- [x] Action classifier (tool → action type mapping with secret sanitization)
- [x] Authensor API client (wired to live control plane on Render)
- [x] CLI (init, run, approvals, receipts, policy, health)
- [x] XSS-safe thin UI
- [x] Policy templates aligned with classifier action types
- [x] Updated docs and README

**Phase 1: Containerization + Notifications** ✓
- [x] Dockerfile for sandboxed agent execution (Node 20 Alpine, non-root, read-only fs)
- [x] Container runner (Docker/Podman auto-detect, volume mounts, resource limits)
- [x] SMS notifications via Twilio for risky actions (non-blocking, fires on require_approval)
- [x] Auto-refresh polling in thin UI (5s interval, pauses when tab hidden)

**Phase 1.5: Browser Dashboard** ✓
- [x] Localhost HTTP server (Node built-in `http`, 127.0.0.1:7700, zero new deps)
- [x] `safeclaw` (no args) → opens browser dashboard
- [x] Setup wizard (API key + Authensor token + policy, stored in ~/.safeclaw/.env with chmod 600)
- [x] Task runner with SSE streaming (agent output → EventEmitter → SSE → browser)
- [x] Approval center (list + approve/reject from browser, real-time via SSE + polling)
- [x] Receipt history
- [x] Dark/light theme (prefers-color-scheme)
- [x] Backward-compatible: CLI commands unchanged, emitter params optional

**Phase 2: Multi-provider + Onboarding** ✓
- [x] Custom agent loop for OpenAI/GPT support (src/openai-agent.js, raw fetch, zero new deps)
- [x] Provider dispatch in agent.js + config.js provider schema
- [x] Dashboard wizard provider selection (Claude / OpenAI cards)
- [x] CLI --provider, --model, --demo flags
- [x] Auto-provision Authensor demo keys (graceful fallback to Google Form)
- [x] `npx safeclaw` ready (package.json files, keywords, repository)

**Phase 3: Production Hardening** ✓
- [x] Test suite (vitest, 118 tests across 8 files: classifier, templates, config, policy, authensor, gateway, openai-tools, retry)
- [x] Retry logic with exponential backoff (authensor _fetch: 429/5xx/network, OpenAI API: 429/5xx)
- [x] GitHub Actions CI (Node 20 + 22, push + PR triggers)
- [x] npm pack verified (test files excluded, 28 files / 35KB)

**Phase 4: Audit, Sessions, Policy Editor, Workspace Scoping** ✓
- [x] Local audit ledger (src/audit.js: append-only JSONL at ~/.safeclaw/audit.jsonl, readEntries with filters, rotateLog)
- [x] Gateway audit integration (every allow/deny logged with source tracking: local_prefilter, authensor, workspace_deny, fail_closed)
- [x] Session/task history (src/session.js: per-task JSON files in ~/.safeclaw/sessions/, atomic writes, message cap at 200)
- [x] Server session recording (accumulates messages/toolCalls/cost during task execution, saves on completion)
- [x] Visual policy editor (dashboard tab: CRUD rules, template picker, apply to control plane)
- [x] Dashboard tabs (Tasks, Audit Log, History, Policy) with lazy data loading
- [x] Audit + session + policy API endpoints (14 new routes in server.js)
- [x] Workspace scoping (src/workspace.js: detectWorkspace walks up for .safeclaw.json/.git/package.json, isPathAllowed enforces path restrictions)
- [x] Agent workspace integration (both Claude + OpenAI agents detect workspace and pass config to gateway)
- [x] CLI commands: `safeclaw audit`, `safeclaw history`, `safeclaw init --workspace`
- [x] 160 tests across 11 files (audit: 11, session: 9, workspace: 18, gateway: 14 including audit+workspace integration)
- [x] Zero new npm dependencies

**Phase 5: Analytics, Settings, Offline Cache, Rate Limiting, Webhooks** ✓
- [x] Settings module (src/settings.js: load/save/validate, atomic writes, default merging, forward-compatible schema)
- [x] Settings API + dashboard tab (GET/PUT /api/settings, form with timeout, retention, cache, theme, webhooks)
- [x] Analytics module (src/analytics.js: cost summary by provider/period, approval metrics, tool usage, CSV/JSON export)
- [x] Analytics API + dashboard tab (cost cards, CSS bar chart, approval metrics table, tool usage table, export buttons)
- [x] Offline decision cache (src/cache.js: memory + disk, TTL-based, only caches allows, opt-in via settings)
- [x] Gateway cache integration (cache on allow, check cache on fail-closed, source: offline_cache)
- [x] Rate limiting (src/rate-limit.js: sliding window counter, enforceRateLimit helper)
- [x] Server rate limiting (POST /api/task: 10/min, POST /api/approvals/*: 30/min, 429 + Retry-After)
- [x] Webhook notifications (src/webhook.js: Slack/Discord/generic format detection, 2 retries, fire-and-forget)
- [x] Gateway webhook dispatch (approval_required, approval_resolved)
- [x] Server webhook dispatch (task_completed, task_failed)
- [x] Version bump to 0.5.0
- [x] 203+ tests across 16 files (settings: 14, analytics: 11, cache: 9, rate-limit: 9, webhook: 8)
- [x] Zero new npm dependencies

**Phase 6: Cost Controls, MCP Analytics, Security Hardening, Doctor + Polish** ✓
- [x] Budget module (src/budget.js: estimateOpenAICost, getCurrentSpend, checkBudget)
- [x] Budget settings schema (costBudget: enabled, limitUsd, period, action)
- [x] Budget API endpoint (GET /api/budget) + pre-task enforcement (block/warn)
- [x] Dashboard budget bar (progress indicator with amber/red thresholds)
- [x] Dashboard budget settings (enabled, limit, period, action in Settings tab)
- [x] OpenAI cost fix (stream_options.include_usage, token accumulation, estimateOpenAICost)
- [x] Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection)
- [x] Audit hash chain (SHA-256 prevHash on every entry, GENESIS for first)
- [x] Audit integrity verification (verifyAuditIntegrity: walks chain, reports errors)
- [x] CLI `audit verify` subcommand
- [x] MCP analytics (computeMcpUsage: groups by server, counts actions, allow rate)
- [x] MCP API endpoints (GET /api/analytics/mcp, GET /api/mcp/servers)
- [x] Dashboard MCP server table (Analytics tab)
- [x] Policy MCP dropdown (auto-fills action pattern from known MCP servers)
- [x] Doctor command (src/doctor.js: 10 diagnostic checks)
- [x] CLI `doctor` command with [PASS]/[WARN]/[FAIL] output
- [x] Dashboard footer (version + Authensor link)
- [x] Version bump to 0.6.0
- [x] 250+ tests across 19 files (budget: 13, audit: +8, analytics: +6, doctor: 12)
- [x] Zero new npm dependencies

**Phase 7: Dashboard Completeness -Every Feature in the Browser** ✓
- [x] Claw Clinic tab (GET /api/doctor, diagnostic check-up UI with pass/warn/fail + hints)
- [x] Audit verify button (GET /api/audit/verify, green/red banner in Audit Log tab)
- [x] Task runner enhancements (model selector dropdown, container mode checkbox, workspace input)
- [x] Profile switcher (GET /api/profiles, POST /api/profiles/switch, header dropdown)
- [x] Configuration panel (GET/PUT /api/config -change provider, API key, auth token from Settings)
- [x] SMS configuration panel (GET/PUT /api/sms -Twilio setup from Settings)
- [x] Doctor hint field (every diagnostic check includes actionable hint string)
- [x] Empty states with helpful guidance on all tabs (approvals, receipts, audit, history, analytics, policy, MCP)
- [x] Per-task model override (deep-clone profile, never persist)
- [x] Container mode from dashboard (runContainerAgent dispatch in task handler)
- [x] Version bump to 0.7.0
- [x] 20+ new tests (server-api.test.js + doctor hint tests)
- [x] Zero new npm dependencies

**Phase 8: Conversation Experience -"Talk to the Claw"** ✓
- [x] Theme toggle that actually works (CSS data-theme selectors + applyTheme JS)
- [x] Conversation UI (renderMarkdown zero-dep renderer, chat bubbles, live-updating agent text)
- [x] Better history transcript (chronological interleaved messages + tool calls with markdown)
- [x] Follow-up messages (continue after task with context prepend, no output clear)
- [x] Browser notifications for approvals (Notification API, fires when tab backgrounded)
- [x] Import/export configuration (GET /api/export/config, POST /api/import/config, backup/restore UI)
- [x] Task queue (replace 409 with queue array, processQueue on completion, GET/DELETE queue endpoints)
- [x] Version bump to 0.8.0
- [x] 25+ new tests (theme, notifications, queue, export/import, follow-up, markdown)
- [x] Zero new npm dependencies

**Phase 9: Autopilot, Policy Pro & Go Mobile** ✓
- [x] Scheduler module (src/scheduler.js: cron parser, schedule CRUD, quiet hours, nextCronRun)
- [x] Scheduler API endpoints (GET/POST/PUT/DELETE /api/schedules, rate-limited, scheduler tick on server start)
- [x] Schedules dashboard tab (add/toggle/delete schedules, cron help, quiet hours config)
- [x] Policy versioning (auto-version on save, backup files, listPolicyVersions, loadPolicyVersion, rollbackPolicy)
- [x] Time-based rules & auto-expire (filterActiveRules: schedule hours/days, expiresAt)
- [x] Policy dry-run/simulate (simulatePolicy with condition evaluation: eq, startsWith, contains, matches, in)
- [x] Policy simulate + versions API endpoints (POST /api/policy/simulate, GET /api/policy/versions, POST /api/policy/rollback)
- [x] Policy simulate + versions dashboard UI (test section, version table, rollback buttons)
- [x] PWA manifest + service worker (manifest.json, sw.js, icon.svg, app shell caching)
- [x] Responsive CSS for mobile (600px breakpoint, touch-friendly tap targets via pointer: coarse)
- [x] Swipe approvals (touch gesture handler: swipe right to approve, swipe left to reject)
- [x] Version bump to 0.9.0
- [x] 352 tests across 21 files (scheduler: 25, policy-advanced: 20, server-api: +12)
- [x] Zero new npm dependencies

**Phase 10: Fort Knox -Security Sweep & Beta Polish** ✓
- [x] Input validation & security helpers (src/validate.js: assertString, assertIn, safeRegex, redactSecrets)
- [x] ReDoS protection in policy.js (safeRegex wrapper for user-supplied regex patterns)
- [x] Secrets redaction in SSE output (agent.js + server.js task stream)
- [x] CSRF protection on all POST/PUT/DELETE endpoints (X-Requested-With: SafeClaw)
- [x] Rate limiting expanded to all 14 write endpoints
- [x] File permission hardening (0o600) across 6 modules (audit, cache, session, scheduler, settings, policy)
- [x] Structured JSON logger (src/logger.js: SAFECLAW_LOG_LEVEL env var, stderr output)
- [x] Graceful shutdown (SIGTERM/SIGINT → close SSE connections, stop scheduler, drain server)
- [x] Enhanced health check (/api/health: version, uptime, scheduler status, audit integrity, pending approvals)
- [x] Error classification (HttpError/ValidationError/NotFoundError → proper 400/404 vs 500)
- [x] CLI --dry-run flag (preview task config, policy simulation, budget status)
- [x] Post-init smoke test (doctor diagnostics after safeclaw init)
- [x] CHANGELOG.md covering all 10 phases
- [x] README.md rewritten for beta (features, security model, architecture, CLI reference, configuration)
- [x] Version bump to 1.0.0-beta
- [x] 418 tests across 24 files (validate: 30, security: 21, integration: 15)
- [x] Zero new npm dependencies
