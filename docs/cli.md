# CLI Reference

## Commands

### dashboard (default)

Open the browser dashboard with setup wizard and task runner. This is the default when no command is given.

```bash
safeclaw                    # Open dashboard
safeclaw dashboard          # Same thing
safeclaw --no-open          # Start dashboard server without opening browser
```

### init

Create or overwrite a profile.

```bash
safeclaw init [flags]
```

Flags:
- `--profile <name>` -- profile name (default: `default`)
- `--control-plane <url>` -- Authensor control plane URL
- `--auth-token <token>` -- Authensor API token
- `--api-key-env <var>` -- environment variable for your API key (default: `ANTHROPIC_API_KEY`)
- `--provider <name>` -- AI provider: `claude` (default) or `openai`
- `--model <model>` -- model override (e.g. `gpt-4o`, `gpt-4o-mini`)
- `--demo` -- auto-provision a demo Authensor token
- `--workspace` -- create a `.safeclaw.json` workspace config in the current directory

### run

Run a task locally. Your API key stays on your machine.

```bash
safeclaw run "your task here" [flags]
```

Flags:
- `--verbose`, `-v` -- show detailed output
- `--provider <name>` -- override provider for this run
- `--model <model>` -- override model for this run
- `--container` -- run the agent inside a Docker/Podman container
- `--rebuild` -- rebuild the container image before running
- `--workspace <path>` -- workspace directory for container mode (default: cwd)
- `--dry-run` -- show task config + policy simulation without actually running

### policy

Manage policies.

```bash
safeclaw policy show     # Print local policy file
safeclaw policy apply    # Upload and activate policy on Authensor
safeclaw policy help     # Show policy tips and examples
```

### approvals

Manage pending approvals.

```bash
safeclaw approvals                # List pending
safeclaw approvals approve <id>   # Approve
safeclaw approvals reject <id>    # Reject
```

### receipts

View the receipt trail.

```bash
safeclaw receipts
```

### audit

View and verify the local audit log.

```bash
safeclaw audit            # Show recent audit entries
safeclaw audit verify     # Verify hash chain integrity
```

### history

View past task sessions.

```bash
safeclaw history
```

### doctor

Run 10 diagnostic checks on your setup.

```bash
safeclaw doctor
```

Checks: Node version, config file, auth token, API key, control plane connectivity, policy file, audit log, Docker/Podman availability, .env permissions, SMS configuration.

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

### --version

Show the installed version.

```bash
safeclaw --version
```

## Config file

Location: `~/.safeclaw/config.json`

```json
{
  "activeProfile": "default",
  "profiles": {
    "default": {
      "installId": "2f8f2a0a-8d1c-4d1c-b76b-2d95bdf5b3f9",
      "controlPlane": "https://authensor-api-production.up.railway.app",
      "authToken": "authensor_...",
      "provider": {
        "name": "claude",
        "apiKeyEnv": "ANTHROPIC_API_KEY",
        "model": ""
      },
      "policy": {
        "path": "~/.safeclaw/policies/default.json",
        "id": ""
      }
    }
  }
}
```

## Examples

```bash
# First-time setup with Claude
export ANTHROPIC_API_KEY=sk-ant-...
safeclaw init --demo
safeclaw run "List all TODO comments in this project"

# Setup with OpenAI instead
export OPENAI_API_KEY=sk-...
safeclaw init --provider openai --api-key-env OPENAI_API_KEY --demo

# Dry-run to preview config and policy
safeclaw run "Refactor the auth module" --dry-run

# Run in a container for extra isolation
safeclaw run "Deploy the staging build" --container

# Check what's pending
safeclaw approvals

# Approve a specific action
safeclaw approvals approve rcpt_abc123

# Use a different profile for a different project
safeclaw init --profile work --auth-token authensor_work_token
safeclaw profile use work
safeclaw run "Refactor the auth module"

# Verify audit log integrity
safeclaw audit verify

# Run diagnostics
safeclaw doctor
```
