# CLI Reference

## Commands

### init

Create or overwrite a profile.

```bash
safeclaw init [flags]
```

Flags:
- `--profile <name>` — profile name (default: `default`)
- `--control-plane <url>` — Authensor control plane URL (default: `https://authensor-control-plane.onrender.com`)
- `--auth-token <token>` — Authensor API token
- `--api-key-env <var>` — environment variable for your Anthropic key (default: `ANTHROPIC_API_KEY`)

### run

Run a task locally. Your API key stays on your machine.

```bash
safeclaw run "your task here" [--verbose]
```

### policy

Manage policies.

```bash
safeclaw policy show     # Print local policy file
safeclaw policy apply    # Upload and activate policy on Authensor
safeclaw policy help     # Show policy tips
```

### approvals

Manage pending approvals.

```bash
safeclaw approvals                # List pending
safeclaw approvals approve <id>   # Approve
safeclaw approvals reject <id>    # Reject
```

### receipts

View the audit trail.

```bash
safeclaw receipts
```

### profile

Manage profiles (separate install IDs and policies).

```bash
safeclaw profile list           # List all profiles (* = active)
safeclaw profile use <name>     # Switch active profile
```

### health

Check Authensor control plane connectivity.

```bash
safeclaw health
```

### config

Show the active profile configuration.

```bash
safeclaw config show
```

## Config file

Location: `~/.safeclaw/config.json`

```json
{
  "activeProfile": "default",
  "profiles": {
    "default": {
      "installId": "2f8f2a0a-8d1c-4d1c-b76b-2d95bdf5b3f9",
      "controlPlane": "https://authensor-control-plane.onrender.com",
      "authToken": "authensor_demo_...",
      "provider": {
        "apiKeyEnv": "ANTHROPIC_API_KEY"
      },
      "policy": {
        "path": "~/.safeclaw/policies/default.json",
        "id": "safeclaw-default"
      }
    }
  }
}
```

## Examples

```bash
# First-time setup
export ANTHROPIC_API_KEY=sk-ant-...
safeclaw init --auth-token authensor_demo_abc123
safeclaw policy apply
safeclaw run "List all TODO comments in this project"

# Check what's pending
safeclaw approvals

# Approve a specific action
safeclaw approvals approve rcpt_abc123

# Use a different profile for a different project
safeclaw init --profile work --auth-token authensor_work_token
safeclaw profile use work
safeclaw run "Refactor the auth module"
```
