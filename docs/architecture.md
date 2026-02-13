# Architecture

SafeClaw runs locally on your machine. The agent executes tasks using the Claude Agent SDK, and every tool call is intercepted and checked against Authensor's hosted control plane before it runs.

```
+---------------------+                     +------------------------+
|  Your machine       |                     |  Authensor Cloud       |
|                     |                     |                        |
|  safeclaw CLI       |                     |  Control Plane         |
|    ↓                |                     |  (policy engine,       |
|  Claude Agent SDK   |   action metadata   |   risk scoring,        |
|    ↓                |  ────────────────>   |   receipts)            |
|  PreToolUse hook    |                     |                        |
|    ↓                |   allow/deny/       |  Email/SMS approvals   |
|  gateway.js         |  <────────────────  |  (Google Apps Script)  |
|    ↓                |   require_approval  |                        |
|  Tool executes      |                     +------------------------+
|  (or waits/blocks)  |
|                     |        +-------------------+
|  ANTHROPIC_API_KEY  |  ───>  |  Anthropic API    |
|  (stays here)       |        |  (Claude models)  |
+---------------------+        +-------------------+
```

## What leaves your machine

Only action metadata:
- `action.type`: e.g. `filesystem.write`, `code.exec`, `network.http`
- `action.resource`: e.g. `/tmp/output.txt`, `curl https://example.com` (secrets redacted)
- `principal.id`: your install ID
- `timestamp`

## What stays local

- Your `ANTHROPIC_API_KEY` -resolved by the SDK, never sent to Authensor
- Your files and filesystem
- Tool execution output
- The agent conversation

## Data flow

1. You run `safeclaw run "task"`.
2. The Claude Agent SDK runs locally, decides to use tools.
3. Each tool call hits the `PreToolUse` hook in `gateway.js`.
4. The classifier maps the tool to an action type and sanitized resource.
5. Safe reads (`safe.read.*`) are allowed locally -no network call.
6. Everything else is sent to `POST /evaluate` on the Authensor control plane.
7. The control plane evaluates the action against your active policy.
8. Allow → tool executes. Deny → tool blocked. Require approval → agent waits.
9. Approvals can be completed via CLI (`safeclaw approvals approve <id>`) or thin UI.
10. Receipts are stored on the control plane for audit.

## Per-install isolation

Each `installId` has its own policy and approval stream. Use profiles to separate environments, projects, or teams.

## Key modules

| Module | Purpose |
|--------|---------|
| `agent.js` | Runs the Claude Agent SDK with gateway hook |
| `gateway.js` | PreToolUse hook -intercepts tools, calls Authensor |
| `classifier.js` | Maps tool names to action types, sanitizes secrets |
| `authensor.js` | HTTP client for the Authensor control plane |
| `cli.js` | CLI commands (init, run, approvals, policy, etc.) |
| `config.js` | Profile and config management (~/.safeclaw/) |
