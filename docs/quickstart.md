# SafeClaw Quickstart

## Prerequisites

- Node.js 20+
- An Anthropic API key (`ANTHROPIC_API_KEY`)
- An Authensor demo token (get one at https://forms.gle/QdfeWAr2G4pc8GxQA)

## 1. Install

```bash
git clone https://github.com/AUTHENSOR/SafeClaw.git
cd SafeClaw
npm install
npm link
```

## 2. Set your API key

Your Anthropic key stays local — it's used by the Claude Agent SDK directly on your machine and is never sent to Authensor.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## 3. Initialize a profile

```bash
safeclaw init --auth-token <your-authensor-token>
```

This creates a profile at `~/.safeclaw/config.json` with a unique install ID and a default deny-by-default policy.

## 4. Apply your policy

```bash
safeclaw policy apply
```

This uploads your local policy to the Authensor control plane and activates it.

## 5. Run a task

```bash
safeclaw run "Summarize this document"
```

The agent runs locally. Read operations execute immediately. Write, network, and exec operations are checked against your policy — risky ones pause and wait for your approval.

## 6. Approve risky actions

When the agent tries something risky, it pauses and prints:

```
[SafeClaw] Approval required: code.exec on ls -la /
  Receipt: rcpt_abc123
  Approve via: safeclaw approvals approve rcpt_abc123
  Waiting up to 300s...
```

In another terminal:

```bash
safeclaw approvals approve rcpt_abc123
```

Or check all pending approvals:

```bash
safeclaw approvals
```

## Customize your policy

Edit `~/.safeclaw/policies/default.json` or copy a template from `policies/`:

- `policies/default-safe.json` — recommended (reads allowed, writes need approval)
- `policies/high-risk-approval.json` — everything non-read needs approval
- `policies/sandbox-readonly.json` — read-only with approval for all writes
- `policies/strict-deny.json` — deny everything (nothing runs)
- `policies/allowlist.example.json` — allow specific domains only

After editing, re-apply: `safeclaw policy apply`

## Notes

- Each profile has its own `installId` and policy file
- Your API key never leaves your machine
- If Authensor is unreachable, all non-read actions are denied (fail closed)
- Use `safeclaw health` to verify connectivity to the control plane
