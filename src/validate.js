// Input validation and security helpers — zero dependencies.

/**
 * Assert that a value is a non-empty string within a max length.
 * @param {*} val
 * @param {string} name - Field name for error messages
 * @param {number} [maxLen=1000]
 */
export function assertString(val, name, maxLen = 1000) {
  if (typeof val !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  if (val.length > maxLen) {
    throw new Error(`${name} must be at most ${maxLen} characters`);
  }
}

/**
 * Assert that a value is one of the allowed values.
 * @param {*} val
 * @param {string} name - Field name for error messages
 * @param {Array} allowed
 */
export function assertIn(val, name, allowed) {
  if (!allowed.includes(val)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
}

// Static patterns that indicate likely ReDoS vulnerability.
// Matches nested quantifiers: (x+)+, (x*)+, (x+)*, (x|y+)+, etc.
const REDOS_PATTERNS = [
  /\([^)]*[+*]\)[+*]/,           // (a+)+, (a*)+, (a+)*, (a*)*
  /\([^)]*[+*]\)\{/,             // (a+){2,}, (a*){3}
  /\(\?:[^)]*[+*]\)[+*]/,        // (?:a+)+
  /\([^)]*\|[^)]*[+*]\)[+*]/,    // (a|b+)+
];

/**
 * Safely compile a regex pattern with ReDoS protection.
 * Uses static analysis to reject patterns with nested quantifiers,
 * then validates the pattern compiles.
 * @param {string} pattern
 * @returns {{ valid: boolean, regex: RegExp|null, error: string|null }}
 */
export function safeRegex(pattern) {
  if (typeof pattern !== 'string') {
    return { valid: false, regex: null, error: 'Pattern must be a string' };
  }

  // Static check: reject patterns with nested quantifiers (ReDoS risk)
  for (const dangerous of REDOS_PATTERNS) {
    if (dangerous.test(pattern)) {
      return { valid: false, regex: null, error: 'Pattern contains nested quantifiers (ReDoS risk)' };
    }
  }

  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    return { valid: false, regex: null, error: err.message };
  }

  return { valid: true, regex, error: null };
}

// Patterns for secret detection — mirrors classifier.js SECRET_PATTERNS.
// Both files must cover the same secrets. This list is the superset used for
// SSE output redaction (user-facing), so it uses prefix-preserving replacements.
const SECRET_PATTERNS = [
  { re: /sk-ant-[a-zA-Z0-9\-_]{3,}/g, replacement: 'sk-ant-[REDACTED]' },
  { re: /sk-(?!ant-)[a-zA-Z0-9\-_]{6,}/g, replacement: 'sk-[REDACTED]' },
  { re: /authensor_[a-zA-Z0-9_]{3,}/g, replacement: 'authensor_[REDACTED]' },
  { re: /Bearer\s+[a-zA-Z0-9._\-]{6,}/gi, replacement: 'Bearer [REDACTED]' },
  { re: /ghp_[a-zA-Z0-9]{6,}/g, replacement: 'ghp_[REDACTED]' },
  { re: /gho_[a-zA-Z0-9]{6,}/g, replacement: 'gho_[REDACTED]' },
  { re: /glpat-[a-zA-Z0-9\-]{6,}/g, replacement: 'glpat-[REDACTED]' },
  { re: /xoxb-[a-zA-Z0-9\-]{6,}/g, replacement: 'xoxb-[REDACTED]' },
  { re: /xoxp-[a-zA-Z0-9\-]{6,}/g, replacement: 'xoxp-[REDACTED]' },
  // Specific named env vars must come before generic KEY=value to preserve key names
  { re: /(ANTHROPIC_API_KEY|OPENAI_API_KEY|TWILIO_AUTH_TOKEN|TWILIO_ACCOUNT_SID)=[^\s]+/g, replacement: '$1=[REDACTED]' },
  { re: /(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)=[^\s&\[]{3,}/gi, replacement: '[REDACTED]' },
];

/**
 * Redact API keys and secrets from text.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const { re, replacement } of SECRET_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}
