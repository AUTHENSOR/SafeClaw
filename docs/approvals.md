# Approvals

Approvals are triggered when a tool call matches a policy rule with effect `require_approval`.

## How it works

1. The agent tries to use a risky tool (e.g. `Bash`, `Write`, `WebFetch`)
2. The gateway hook classifies the action and sends it to the Authensor control plane
3. The control plane evaluates the policy and returns `require_approval`
4. The agent pauses and prints the receipt ID to your terminal
5. You approve or reject via CLI or thin UI
6. The agent continues (if approved) or the tool is blocked (if rejected)

## Terminal output

```
[SafeClaw] Approval required: code.exec on rm -rf /tmp/old
  Receipt: rcpt_abc123
  Approve via: safeclaw approvals approve rcpt_abc123
  Waiting up to 300s...
```

## Approve via CLI

```bash
# List pending
safeclaw approvals

# Approve
safeclaw approvals approve rcpt_abc123

# Reject
safeclaw approvals reject rcpt_abc123
```

## Approve via thin UI

Open the thin UI with your control plane URL and install ID:

```
http://localhost:8080/ui/?controlPlane=https://authensor-control-plane.onrender.com&installId=your-id
```

## Approve via email (if configured)

If the Authensor Apps Script backend is set up, approval emails with signed links are sent automatically for pending actions.

## What should require approval

The default policy requires approval for:
- `filesystem.write` -file writes and edits
- `code.exec` -bash commands
- `network.http` -HTTP requests
- `network.search` -web searches
- `secrets.*` -secret access
- `payments.*` -payment operations
- `mcp.*` -MCP tool calls

## Timeout

By default, the agent waits up to 300 seconds for approval. Configure with:

```bash
SAFECLAW_APPROVAL_TIMEOUT_SECONDS=600 safeclaw run "task"
```

If the timeout expires, the action is denied (fail closed).

## "Always allow" rules

When approving via the Authensor email flow, you can choose "Always Allow" to create a permanent policy rule for that action type. This avoids repeated approvals for the same operation.
