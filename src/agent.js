// Local agent runner using Claude Agent SDK with Authensor gateway hook.
// The Anthropic API key is resolved from the environment by the SDK -we never touch it.
// Only action descriptions leave the machine via the gateway hook.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createGatewayHook } from './gateway.js';
import { detectWorkspace } from './workspace.js';
import { redactSecrets } from './validate.js';

/**
 * Run a task locally using the Claude Agent SDK with Authensor action gating.
 *
 * @param {{ task: string, profile: object, verbose?: boolean, emitter?: EventEmitter, taskId?: string }} opts
 */
export async function runAgent({ task, profile, verbose = false, emitter = null, taskId = null }) {
  // Provider dispatch -OpenAI uses a custom agent loop
  if (profile.provider?.name === 'openai') {
    const { runOpenAIAgent } = await import('./openai-agent.js');
    return runOpenAIAgent({ task, profile, verbose, emitter, taskId });
  }

  const approvalTimeout = parseInt(
    process.env.SAFECLAW_APPROVAL_TIMEOUT_SECONDS || '300',
    10
  );

  // Detect workspace for path enforcement
  const ws = detectWorkspace(process.cwd());

  const gatewayHook = createGatewayHook({
    controlPlaneUrl: profile.controlPlane,
    authToken: profile.authToken,
    approvalTimeoutSeconds: approvalTimeout,
    installId: profile.installId,
    emitter,
    taskId,
    profileName: profile.name || 'default',
    workspaceConfig: ws?.config || null,
  });

  // Standard Claude Code toolset -all gated by the gateway hook
  const allowedTools = [
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
    'AskUserQuestion', 'NotebookEdit',
  ];

  const hookTimeout = approvalTimeout + 30; // buffer for poll loop

  const options = {
    allowedTools,
    permissionMode: 'bypassPermissions', // gateway hook IS the permission system
    allowDangerouslySkipPermissions: true, // required with bypassPermissions -safety is handled by the gateway hook
    hooks: {
      PreToolUse: [
        {
          hooks: [gatewayHook],
          timeout: hookTimeout,
        },
      ],
    },
  };

  if (verbose) {
    process.stderr.write(`[SafeClaw] Starting agent\n`);
    process.stderr.write(`[SafeClaw] Control plane: ${profile.controlPlane}\n`);
    process.stderr.write(`[SafeClaw] Install ID: ${profile.installId}\n`);
    process.stderr.write(`[SafeClaw] Approval timeout: ${approvalTimeout}s\n`);
  }

  function emit(type, data) {
    if (emitter && taskId) {
      emitter.emit(`task:${taskId}`, { type, data });
    }
  }

  try {
    for await (const message of query({ prompt: task, options })) {
      // Stream assistant text to stdout
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              const safeText = redactSecrets(block.text);
              process.stdout.write(safeText);
              emit('agent:text', { text: safeText });
            } else if (block.type === 'tool_use') {
              const inputSummary = summarizeToolInput(block.name, block.input);
              emit('agent:tool_call', { toolUseId: block.id, toolName: block.name, inputSummary });
            }
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          process.stdout.write('\n');
          const cost = message.total_cost_usd != null ? parseFloat(message.total_cost_usd.toFixed(4)) : null;
          if (verbose && cost) {
            process.stderr.write(`[SafeClaw] Done. Cost: $${cost}\n`);
          }
          emit('agent:done', { success: true, cost });
        } else {
          const errMsg = message.errors?.join(', ') || message.subtype || 'unknown';
          process.stderr.write(`\n[SafeClaw] Error: ${errMsg}\n`);
          process.exitCode = 1;
          emit('agent:done', { success: false, error: errMsg });
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[SafeClaw] Fatal: ${err.message}\n`);
    process.exitCode = 1;
    emit('agent:done', { success: false, error: err.message });
  }
}

/**
 * Create a short summary of tool input for display in the UI.
 */
function summarizeToolInput(toolName, input) {
  if (!input) return '';
  if (toolName === 'Read' && input.file_path) return input.file_path;
  if (toolName === 'Write' && input.file_path) return input.file_path;
  if (toolName === 'Edit' && input.file_path) return input.file_path;
  if (toolName === 'Bash' && input.command) return input.command.slice(0, 120);
  if (toolName === 'Glob' && input.pattern) return input.pattern;
  if (toolName === 'Grep' && input.pattern) return input.pattern;
  if (toolName === 'WebFetch' && input.url) return input.url;
  if (toolName === 'WebSearch' && input.query) return input.query;
  return '';
}
