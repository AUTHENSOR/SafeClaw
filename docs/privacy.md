# Privacy

SafeClaw is designed so your sensitive data never leaves your machine.

## What stays local

- **Your API keys** -`ANTHROPIC_API_KEY` is used by the Claude Agent SDK directly on your machine. SafeClaw never reads, stores, or transmits it.
- **Your files** -all file reads and writes happen locally
- **Your secrets** -environment variables, credentials, tokens
- **Agent conversations** -the full conversation between you and the agent

## What goes to Authensor

Only action metadata, with secrets stripped:
- `action.type` -e.g. `filesystem.write`, `code.exec`
- `action.resource` -e.g. `/tmp/output.txt` (API keys and tokens are redacted before transmission)
- `principal.id` -your install ID
- `timestamp`

## Stored by Authensor

- Policy metadata (per installId)
- Receipts (action type, resource, decision, timestamp)
- Approval decisions

## Not stored by Authensor

- Your API keys (never transmitted)
- File contents
- Agent conversation history
- Command output
