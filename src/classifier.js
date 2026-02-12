// Maps Claude Agent SDK tool names and inputs to Authensor action types.
// Pure function — no side effects, no network calls.
// Only action.type and action.resource leave the machine.

const TOOL_MAP = {
  Read:              'safe.read.file',
  Glob:              'safe.read.glob',
  Grep:              'safe.read.grep',
  Write:             'filesystem.write',
  Edit:              'filesystem.write',
  Bash:              'code.exec',
  WebFetch:          'network.http',
  WebSearch:         'network.search',
  Task:              'agent.subagent',
  NotebookEdit:      'filesystem.write',
  TodoWrite:         'safe.read.meta',
  AskUserQuestion:   'safe.read.meta',
  ExitPlanMode:      'safe.read.meta',
  EnterPlanMode:     'safe.read.meta',
  ListMcpResourcesTool: 'safe.read.meta',
  ReadMcpResourceTool:  'safe.read.meta',
  Skill:             'safe.read.meta',
  TaskOutput:        'safe.read.meta',
  TaskStop:          'code.exec.kill',
};

// Patterns that indicate secrets — stripped before anything leaves the machine
const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9\-_]{3,}/g,            // Anthropic keys (match first, more specific)
  /sk-[a-zA-Z0-9\-_]{6,}/g,                // OpenAI / generic sk- keys
  /authensor_[a-zA-Z0-9_]{3,}/g,           // Authensor tokens
  /Bearer\s+[a-zA-Z0-9._\-]{6,}/gi,        // Bearer tokens
  /ghp_[a-zA-Z0-9]{6,}/g,                  // GitHub PATs
  /gho_[a-zA-Z0-9]{6,}/g,                  // GitHub OAuth
  /glpat-[a-zA-Z0-9\-]{6,}/g,              // GitLab PATs
  /xoxb-[a-zA-Z0-9\-]{6,}/g,              // Slack bot tokens
  /xoxp-[a-zA-Z0-9\-]{6,}/g,              // Slack user tokens
  /(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=[^\s&]{3,}/gi, // KEY=value pairs
  /\$[A-Z_]{2,}(?:KEY|TOKEN|SECRET|PASS)[A-Z_]*/g, // Env var references to secrets
];

/**
 * Sanitize a string by redacting anything that looks like a secret.
 * Truncates to 200 chars max.
 */
export function sanitize(value) {
  if (typeof value !== 'string') return String(value || '');
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result.slice(0, 200);
}

/**
 * Classify a Claude Agent SDK tool call into an Authensor action envelope.
 *
 * @param {string} toolName - SDK tool name (e.g. 'Bash', 'Read', 'mcp__server__action')
 * @param {object} toolInput - Tool input parameters
 * @returns {{ actionType: string, resource: string }}
 */
export function classify(toolName, toolInput) {
  const input = toolInput || {};

  // Handle MCP tools: mcp__<server>__<action>
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const server = parts[1] || 'unknown';
    const action = parts.slice(2).join('.') || 'unknown';
    return {
      actionType: `mcp.${server}.${action}`,
      resource: sanitize(JSON.stringify(input).slice(0, 200)),
    };
  }

  const actionType = TOOL_MAP[toolName] || `unknown.${toolName}`;

  let resource = '';
  if (input.file_path)      resource = sanitize(input.file_path);
  else if (input.notebook_path) resource = sanitize(input.notebook_path);
  else if (input.url)        resource = sanitize(input.url);
  else if (input.command)    resource = sanitize(input.command);
  else if (input.pattern)    resource = sanitize(input.pattern);
  else if (input.query)      resource = sanitize(input.query);
  else if (input.description) resource = sanitize(input.description);
  else if (input.skill)      resource = sanitize(input.skill);
  else                        resource = sanitize(JSON.stringify(input).slice(0, 200));

  return { actionType, resource };
}

/**
 * Check if an action type is in the safe-read category (local pre-filter).
 */
export function isSafeRead(actionType) {
  return actionType.startsWith('safe.read');
}
