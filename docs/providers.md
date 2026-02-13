# Providers

SafeClaw currently uses the Claude Agent SDK, which calls the Anthropic API directly from your machine.

## How keys work

- Your `ANTHROPIC_API_KEY` is set as an environment variable
- The Claude Agent SDK reads it directly -SafeClaw never touches it
- The key is never sent to Authensor or any other service
- Only action descriptions (tool name + sanitized resource) go to Authensor for policy checks

## Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...
safeclaw init --api-key-env ANTHROPIC_API_KEY
```

## Custom env var name

If your key is in a different environment variable:

```bash
safeclaw init --api-key-env MY_CLAUDE_KEY
```

## Multi-provider support (planned)

Future phases will support additional providers (OpenAI, etc.) via a custom agent loop. The gateway and classifier modules are provider-agnostic -they work with any tool call regardless of which model generated it.
