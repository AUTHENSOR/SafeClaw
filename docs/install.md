# Install

## Prerequisites

- Node.js 20+
- An Anthropic API key
- An Authensor demo token

## CLI

```bash
git clone https://github.com/AUTHENSOR/SafeClaw.git
cd SafeClaw
npm install
npm link
```

This makes the `safeclaw` command available globally.

## Thin UI

Serve the `ui/` folder as static files. Pass `controlPlane` and `installId` as query params if hosted separately:

```
https://your-ui-host/ui/?controlPlane=https://authensor-control-plane.onrender.com&installId=your-install-id
```

## Auth

Your Authensor token is set during init:

```bash
safeclaw init --auth-token <your-token>
```

Get a demo token: https://forms.gle/QdfeWAr2G4pc8GxQA

## Verify setup

```bash
safeclaw health        # Check control plane connectivity
safeclaw config show   # View your config
safeclaw policy show   # View your active policy
```
