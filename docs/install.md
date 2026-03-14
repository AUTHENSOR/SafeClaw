# Install

## Prerequisites

- Node.js 20+
- An Anthropic API key (or OpenAI key with `--provider openai`)
- An Authensor control plane (self-host with `npx authensor up`, or request a demo token)

## CLI

```bash
git clone https://github.com/AUTHENSOR/SafeClaw.git
cd SafeClaw
npm install
npm link
```

This makes the `safeclaw` command available globally.

## Thin UI

The thin approvals UI is served by the SafeClaw dashboard at `http://localhost:7702/approvals/`. To point it at a different control plane or install ID, pass query params:

```
http://localhost:7702/approvals/?controlPlane=http://localhost:3000&installId=your-install-id
```

## Auth

Your Authensor token is set during init:

```bash
safeclaw init --auth-token <your-token>
```

Get a demo token: https://forms.gle/QdfeWAr2G4pc8GxQA
Or self-host the control plane: `npx authensor up` (runs at http://localhost:3000)

## Verify setup

```bash
safeclaw health        # Check control plane connectivity
safeclaw config show   # View your config
safeclaw policy show   # View your active policy
```
