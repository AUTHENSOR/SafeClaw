# FAQ

## Is BYOK less safe?
BYOK is safer for you as the operator because you are not paying for users' requests, and provider keys are not stored server-side. The key is sent per request from the CLI. The CLI does not store keys unless you opt in with `--persist-key`.

## What data is stored?
- Policy metadata
- Approvals and receipts
- Minimal run metadata (task text is optional and should be configurable)

## Can I run multiple installs?
Yes. Use CLI profiles to create multiple installIds and policies.

## Can I use a different model provider?
Yes. SafeClaw is model-agnostic. Your server decides which providers are supported.

## Does the UI allow approvals?
Yes, if your server exposes approval endpoints and the UI is hosted with access to them.

## Does SafeClaw support containerized execution?
Yes, optionally. The server can run tasks in containers as an extra safety layer. This is off by default and must be enabled server-side.
