# FAQ

## Are my API keys safe?
Yes. API keys are stored locally on your machine with restricted file permissions (`0o600`, owner-only access). They are never sent to Authensor or any other remote service. The CLI reads them from environment variables at runtime.

## What data is stored?
- Policy metadata
- Approvals and receipts
- Minimal run metadata (task text is optional and configurable)

## Can I run multiple installs?
Yes. Use CLI profiles to create multiple installIds and policies.

## Can I use a different model provider?
Yes. SafeClaw supports Claude (via the Agent SDK) and OpenAI (via a custom agent loop). Set the provider during setup with `--provider openai`.

## Does the UI allow approvals?
Yes. The dashboard at `http://localhost:7702` shows pending approvals and lets you approve or reject them. SMS notifications are also supported via Twilio.

## Does SafeClaw support containerized execution?
Yes, optionally. The CLI can run tasks inside Docker or Podman containers as an extra safety layer. Use `safeclaw run --container` to enable it.
