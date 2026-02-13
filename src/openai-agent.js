// Custom agent loop for OpenAI/GPT models.
// Uses raw fetch() -zero new dependencies.
// Routes every tool call through the same Authensor gateway hook as Claude.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createGatewayHook } from './gateway.js';
import { isRetryable, getBackoffMs, sleep } from './authensor.js';
import { detectWorkspace } from './workspace.js';
import { safeRegex, redactSecrets } from './validate.js';
import { estimateOpenAICost } from './budget.js';

const MAX_TURNS = 50;
const DEFAULT_MODEL = 'gpt-4o';
const API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MAX_RETRIES = 3;

const SYSTEM_PROMPT = `You are a helpful AI assistant that can use tools to complete tasks on the user's local machine.

Available tools:
- read_file: Read file contents
- write_file: Create or overwrite files
- edit_file: Make targeted edits to existing files (find and replace)
- run_command: Execute shell commands
- list_files: Find files matching a glob pattern
- search_files: Search file contents with regex

Work step by step. Use tools to gather information before making changes. When done, provide a clear summary of what you did.`;

// --- Tool definitions (OpenAI function calling format) ---

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path (absolute or relative)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it if it does not exist',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Find and replace a string in a file. The old_string must match exactly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'The exact string to find' },
          new_string: { type: 'string', description: 'The replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command and return stdout + stderr',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files matching a glob pattern in a directory',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "*.js", "**/*.ts")' },
          directory: { type: 'string', description: 'Base directory (default: current directory)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a regex pattern in file contents',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          directory: { type: 'string', description: 'Directory to search in (default: current directory)' },
          file_glob: { type: 'string', description: 'Only search files matching this glob (e.g. "*.js")' },
        },
        required: ['pattern'],
      },
    },
  },
];

// Map OpenAI tool names to classifier-compatible names (for the gateway hook)
const TOOL_NAME_MAP = {
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  run_command: 'Bash',
  list_files: 'Glob',
  search_files: 'Grep',
};

// Transform OpenAI tool input to classifier-compatible input format
function toClassifierInput(toolName, args) {
  switch (toolName) {
    case 'read_file':
      return { file_path: args.path };
    case 'write_file':
      return { file_path: args.path, content: args.content };
    case 'edit_file':
      return { file_path: args.path, old_string: args.old_string, new_string: args.new_string };
    case 'run_command':
      return { command: args.command };
    case 'list_files':
      return { pattern: args.pattern, path: args.directory };
    case 'search_files':
      return { pattern: args.pattern, path: args.directory };
    default:
      return args;
  }
}

// --- Tool implementations ---

function toolReadFile(args) {
  const filePath = path.resolve(args.path);
  if (!fs.existsSync(filePath)) return `Error: File not found: ${args.path}`;
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return `Error: ${args.path} is a directory, not a file`;
  if (stat.size > 1024 * 1024) return `Error: File too large (${stat.size} bytes). Max 1MB.`;
  return fs.readFileSync(filePath, 'utf-8');
}

function toolWriteFile(args) {
  const filePath = path.resolve(args.path);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, args.content);
  return `File written: ${args.path} (${args.content.length} bytes)`;
}

function toolEditFile(args) {
  const filePath = path.resolve(args.path);
  if (!fs.existsSync(filePath)) return `Error: File not found: ${args.path}`;
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes(args.old_string)) {
    return `Error: old_string not found in ${args.path}. Make sure it matches exactly.`;
  }
  const count = content.split(args.old_string).length - 1;
  if (count > 1) {
    return `Error: old_string found ${count} times in ${args.path}. It must be unique. Include more context.`;
  }
  const newContent = content.replace(args.old_string, args.new_string);
  fs.writeFileSync(filePath, newContent);
  return `File edited: ${args.path}`;
}

function toolRunCommand(args) {
  const timeout = args.timeout_ms || 30000;
  try {
    const output = execSync(args.command, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output || '(no output)';
  } catch (err) {
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    if (err.killed) return `Error: Command timed out after ${timeout}ms\n${stdout}\n${stderr}`;
    return `Exit code ${err.status || 1}\n${stdout}\n${stderr}`.trim();
  }
}

function toolListFiles(args) {
  const dir = path.resolve(args.directory || '.');
  if (!fs.existsSync(dir)) return `Error: Directory not found: ${args.directory || '.'}`;

  const pattern = args.pattern || '*';
  const regex = globToRegex(pattern);
  const results = [];

  function walk(current, relative) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Only recurse if pattern contains **
        if (pattern.includes('**')) walk(path.join(current, entry.name), rel);
      } else {
        if (regex.test(rel) || regex.test(entry.name)) {
          results.push(rel);
        }
      }
    }
  }

  walk(dir, '');
  if (!results.length) return 'No files matched the pattern.';
  if (results.length > 200) return results.slice(0, 200).join('\n') + `\n... and ${results.length - 200} more`;
  return results.join('\n');
}

function toolSearchFiles(args) {
  const dir = path.resolve(args.directory || '.');
  if (!fs.existsSync(dir)) return `Error: Directory not found: ${args.directory || '.'}`;

  const check = safeRegex(args.pattern);
  if (!check.valid) {
    return `Error: Invalid or unsafe regex: ${check.error || 'pattern rejected'}`;
  }
  const regex = new RegExp(args.pattern, 'gm');

  const fileGlob = args.file_glob ? globToRegex(args.file_glob) : null;
  const matches = [];
  const MAX_MATCHES = 100;

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full);
      } else {
        if (fileGlob && !fileGlob.test(entry.name)) continue;
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
            if (regex.test(lines[i])) {
              const rel = path.relative(dir, full);
              matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
            }
            regex.lastIndex = 0; // reset for next test
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
  }

  walk(dir);
  if (!matches.length) return 'No matches found.';
  return matches.join('\n');
}

// Convert a simple glob pattern to a regex
function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');
  return new RegExp(`^${escaped}$`);
}

// Exported for testing
export { TOOLS, toClassifierInput, globToRegex };

const TOOL_EXECUTORS = {
  read_file: toolReadFile,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
  list_files: toolListFiles,
  search_files: toolSearchFiles,
};

// --- Streaming SSE parser ---

async function* parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') return;
      if (trimmed.startsWith('data: ')) {
        try {
          yield JSON.parse(trimmed.slice(6));
        } catch {
          // skip malformed chunks
        }
      }
    }
  }
}

// --- Main agent loop ---

/**
 * Run a task using an OpenAI model with Authensor action gating.
 *
 * @param {{ task: string, profile: object, verbose?: boolean, emitter?: EventEmitter, taskId?: string }} opts
 */
export async function runOpenAIAgent({ task, profile, verbose = false, emitter = null, taskId = null, signal = null }) {
  const model = profile.provider?.model || DEFAULT_MODEL;
  const keyEnv = profile.provider?.apiKeyEnv || 'OPENAI_API_KEY';
  const apiKey = process.env[keyEnv];

  if (!apiKey) {
    throw new Error(`Missing OpenAI API key. Set ${keyEnv} in your environment.`);
  }

  const approvalTimeout = parseInt(process.env.SAFECLAW_APPROVAL_TIMEOUT_SECONDS || '300', 10);

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

  function emit(type, data) {
    if (emitter && taskId) {
      emitter.emit(`task:${taskId}`, { type, data });
    }
  }

  if (verbose) {
    process.stderr.write(`[SafeClaw] Starting OpenAI agent (${model})\n`);
    process.stderr.write(`[SafeClaw] Control plane: ${profile.controlPlane}\n`);
    process.stderr.write(`[SafeClaw] Install ID: ${profile.installId}\n`);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: task },
  ];

  // Accumulate token usage across all turns for cost tracking
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0 };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Call OpenAI API with streaming + retry for transient errors
      let response;
      for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
        const fetchSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000);
        response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          signal: fetchSignal,
          body: JSON.stringify({
            model,
            messages,
            tools: TOOLS,
            stream: true,
            stream_options: { include_usage: true },
          }),
        });

        if (response.ok) break;

        if (attempt < OPENAI_MAX_RETRIES && isRetryable(null, response.status)) {
          const backoff = getBackoffMs(attempt, response.headers.get('retry-after'));
          if (verbose) process.stderr.write(`[OpenAI] ${response.status}, retrying in ${backoff}ms...\n`);
          await sleep(backoff);
          continue;
        }

        const errText = await response.text();
        let errMsg;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errText;
        } catch {
          errMsg = errText;
        }
        throw new Error(`OpenAI API error (${response.status}): ${errMsg}`);
      }

      // Parse streaming response
      let contentText = '';
      const toolCalls = []; // { id, name, arguments }

      for await (const chunk of parseSSEStream(response)) {
        // Capture usage from stream (appears in final chunk when stream_options.include_usage is set)
        if (chunk.usage) {
          totalUsage.prompt_tokens += chunk.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += chunk.usage.completion_tokens || 0;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        // Stream text content
        if (delta?.content) {
          contentText += delta.content;
          process.stdout.write(delta.content);
          emit('agent:text', { text: redactSecrets(delta.content) });
        }

        // Accumulate tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', name: tc.function?.name || '', arguments: '' };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
          }
        }

        // Check for finish
        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
          // Agent is done -no tool calls, just text
          if (contentText) process.stdout.write('\n');
          if (verbose) {
            process.stderr.write(`[SafeClaw] OpenAI agent completed (${turn + 1} turns)\n`);
          }
          const cost = estimateOpenAICost(totalUsage, model);
          emit('agent:done', { success: true, cost });
          return;
        }
      }

      // If no tool calls were collected but we got text, agent is done
      if (!toolCalls.length) {
        if (contentText) process.stdout.write('\n');
        const cost = estimateOpenAICost(totalUsage, model);
        emit('agent:done', { success: true, cost });
        return;
      }

      // Build the assistant message with tool calls
      const assistantMsg = { role: 'assistant', content: contentText || null, tool_calls: [] };
      for (const tc of toolCalls) {
        if (tc) {
          assistantMsg.tool_calls.push({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          });
        }
      }
      messages.push(assistantMsg);

      // Process each tool call
      for (const tc of assistantMsg.tool_calls) {
        const toolName = tc.function.name;
        let toolArgs;
        try {
          toolArgs = JSON.parse(tc.function.arguments);
        } catch {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: Invalid JSON arguments' });
          continue;
        }

        const classifierName = TOOL_NAME_MAP[toolName] || toolName;
        const classifierInput = toClassifierInput(toolName, toolArgs);
        const inputSummary = summarizeInput(toolName, toolArgs);

        emit('agent:tool_call', { toolUseId: tc.id, toolName: classifierName, inputSummary });

        if (verbose) {
          process.stderr.write(`[SafeClaw] Tool: ${classifierName} ${inputSummary}\n`);
        }

        // Route through gateway hook
        let hookResult;
        try {
          hookResult = await gatewayHook(
            { tool_name: classifierName, tool_input: classifierInput },
            tc.id,
            { signal: AbortSignal.timeout(approvalTimeout * 1000 + 30000) }
          );
        } catch (err) {
          const msg = `Gateway error: ${err.message}`;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: msg });
          continue;
        }

        const decision = hookResult?.hookSpecificOutput?.permissionDecision;
        const reason = hookResult?.hookSpecificOutput?.permissionDecisionReason || '';

        if (decision !== 'allow' && decision !== 'approved') {
          process.stderr.write(`[SafeClaw] Denied: ${classifierName} -${reason || decision || 'no explicit allow'}\n`);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `Action denied by SafeClaw: ${reason || 'not explicitly allowed'}`,
          });
          continue;
        }

        // Execute the tool
        const executor = TOOL_EXECUTORS[toolName];
        if (!executor) {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `Unknown tool: ${toolName}` });
          continue;
        }

        let result;
        try {
          result = executor(toolArgs);
        } catch (err) {
          result = `Tool error: ${err.message}`;
        }

        // Truncate very large results
        if (typeof result === 'string' && result.length > 50000) {
          result = result.slice(0, 50000) + '\n... (truncated)';
        }

        messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }

    // Max turns reached
    process.stderr.write(`[SafeClaw] Max turns (${MAX_TURNS}) reached\n`);
    const cost = estimateOpenAICost(totalUsage, model);
    emit('agent:done', { success: false, error: `Max turns (${MAX_TURNS}) reached`, cost });
  } catch (err) {
    process.stderr.write(`[SafeClaw] Fatal: ${err.message}\n`);
    process.exitCode = 1;
    const cost = estimateOpenAICost(totalUsage, model);
    emit('agent:done', { success: false, error: err.message, cost });
  }
}

function summarizeInput(toolName, args) {
  if (!args) return '';
  if (toolName === 'read_file') return args.path || '';
  if (toolName === 'write_file') return args.path || '';
  if (toolName === 'edit_file') return args.path || '';
  if (toolName === 'run_command') return (args.command || '').slice(0, 120);
  if (toolName === 'list_files') return args.pattern || '';
  if (toolName === 'search_files') return args.pattern || '';
  return '';
}
