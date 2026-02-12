// Structured JSON logger — zero dependencies.
// Writes to stderr so stdout remains clean for agent output.
// Control level via SAFECLAW_LOG_LEVEL env var (debug, info, warn, error).

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL = LOG_LEVELS[process.env.SAFECLAW_LOG_LEVEL || 'info'] ?? 1;

function log(level, msg, extra = {}) {
  if (LOG_LEVELS[level] < LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...extra };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  debug: (msg, extra) => log('debug', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};
