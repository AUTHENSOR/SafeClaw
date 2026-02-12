# Safety Model

SafeClaw is deny-by-default. The agent runs locally, and every tool call is intercepted and checked against your policy before execution. Your API keys never leave your machine.

## Default posture

- **Read-only actions are safe** — file reads, search, grep are allowed without approval
- **File writes require approval** — Write, Edit, NotebookEdit
- **Code execution requires approval** — Bash commands
- **Network access requires approval** — HTTP requests, web search
- **Secrets and payments require approval** — any access to secrets or payment APIs
- **MCP tools require approval** — external tool integrations
- **Unknown actions are denied** — anything not in a rule is blocked

## How risk is determined

The classifier (`src/classifier.js`) maps each Claude Agent SDK tool call to an action type:

| Tool | action.type | Risk level |
|------|------------|------------|
| Read, Glob, Grep | `safe.read.*` | Safe (auto-allowed) |
| Write, Edit | `filesystem.write` | Risky |
| Bash | `code.exec` | Risky |
| WebFetch | `network.http` | Risky |
| WebSearch | `network.search` | Risky |
| MCP tools | `mcp.<server>.<action>` | Risky |
| Unknown tools | `unknown.<name>` | Denied |

## Secret sanitization

Before any action description leaves your machine, the classifier strips:
- API keys (sk-*, sk-ant-*)
- Bearer tokens
- GitHub/GitLab/Slack tokens
- Environment variable references to secrets ($*KEY*, $*TOKEN*, $*SECRET*)

## Fail closed

If the Authensor control plane is unreachable, all non-read actions are denied. This ensures that a network outage doesn't cause the agent to run uncontrolled.

## Approvals

When a tool call hits a `require_approval` rule:
1. The agent pauses
2. A receipt is created on the Authensor control plane
3. You are notified in the terminal
4. You can approve or reject via CLI or thin UI
5. The agent continues or stops

## Receipts

Every policy decision emits a receipt for audit and debugging.

## Per-install policy

Each install has its own policy file and installId. This allows separate risk postures per team, project, or environment.
