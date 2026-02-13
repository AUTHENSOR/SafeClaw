# SafeClaw Quickstart

## Prerequisites

- Node.js 20+
- An API key (Anthropic or OpenAI)

## 1. Install and launch

```bash
npx @authensor/safeclaw
```

Your browser opens with a setup wizard that walks you through everything.

**Alternative: clone and run**

```bash
git clone https://github.com/AUTHENSOR/SafeClaw.git
cd SafeClaw
npm install && npm start
```

## 2. Set your API key

Your API key stays local -- it's used by the agent directly on your machine and is never sent to Authensor.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or for OpenAI:

```bash
export OPENAI_API_KEY=sk-...
```

## 3. Initialize a profile

The setup wizard handles this automatically. Or via CLI:

```bash
safeclaw init --demo
```

This creates a profile at `~/.safeclaw/config.json` with a unique install ID, a demo Authensor token, and a deny-by-default policy.

## 4. Run a task

```bash
safeclaw run "Summarize this document"
```

The agent runs locally. Read operations execute immediately. Write, network, and exec operations are checked against your policy -- risky ones pause and wait for your approval.

## 5. Approve risky actions

When the agent tries something risky, it pauses and prints:

```
[SafeClaw] Approval required: code.exec on ls -la /
  Receipt: rcpt_abc123
  Approve via: safeclaw approvals approve rcpt_abc123
  Waiting up to 300s...
```

Approve from the dashboard, or in another terminal:

```bash
safeclaw approvals approve rcpt_abc123
```

## Customize your policy

Edit `~/.safeclaw/policies/default.json` or copy a template from `policies/`:

- `policies/default-safe.json` -- recommended (reads allowed, writes need approval)
- `policies/high-risk-approval.json` -- everything non-read needs approval
- `policies/sandbox-readonly.json` -- read-only with approval for all writes
- `policies/strict-deny.json` -- deny everything (nothing runs)
- `policies/allowlist.example.json` -- allow specific domains only

After editing, re-apply: `safeclaw policy apply`

## Notes

- Each profile has its own `installId` and policy file
- Your API key never leaves your machine
- If Authensor is unreachable, all non-read actions are denied (fail closed)
- Use `safeclaw doctor` to run 10 diagnostic checks on your setup
