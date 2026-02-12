import fs from 'fs';
import path from 'path';
import { configPaths, expandHome } from './config.js';
import { defaultPolicyTemplate } from './templates.js';
import { safeRegex } from './validate.js';

export function ensurePolicyFile(policyPath) {
  const { POLICY_DIR } = configPaths();
  const realPath = expandHome(policyPath);
  if (!fs.existsSync(POLICY_DIR)) fs.mkdirSync(POLICY_DIR, { recursive: true });
  if (!fs.existsSync(realPath)) {
    fs.writeFileSync(realPath, JSON.stringify(defaultPolicyTemplate, null, 2), { mode: 0o600 });
  }
  return realPath;
}

export function loadPolicy(policyPath) {
  const realPath = expandHome(policyPath);
  const raw = fs.readFileSync(realPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Save a policy, auto-versioning and creating a backup of the previous version.
 */
export function savePolicy(policyPath, policy) {
  const realPath = expandHome(policyPath);

  // Auto-version: backup current file before overwriting
  if (fs.existsSync(realPath)) {
    try {
      const current = JSON.parse(fs.readFileSync(realPath, 'utf-8'));
      const currentVersion = extractVersionNumber(current.version);
      const backupPath = realPath + '.v' + currentVersion;
      fs.writeFileSync(backupPath, JSON.stringify(current, null, 2), { mode: 0o600 });
      // Bump version on the new policy
      policy.version = 'v' + (currentVersion + 1);
    } catch {
      // If current file is corrupt, just overwrite
      if (!policy.version) policy.version = 'v1';
    }
  } else {
    if (!policy.version) policy.version = 'v1';
  }

  fs.writeFileSync(realPath, JSON.stringify(policy, null, 2), { mode: 0o600 });
}

/**
 * List available policy versions (backup files).
 */
export function listPolicyVersions(policyPath) {
  const realPath = expandHome(policyPath);
  const dir = path.dirname(realPath);
  const base = path.basename(realPath);

  if (!fs.existsSync(dir)) return [];

  const versions = [];
  const files = fs.readdirSync(dir);
  const pattern = new RegExp('^' + escapeRegExp(base) + '\\.v(\\d+)$');

  for (const f of files) {
    const match = f.match(pattern);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    const filePath = path.join(dir, f);
    const stat = fs.statSync(filePath);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      versions.push({
        version,
        savedAt: stat.mtime.toISOString(),
        ruleCount: (content.rules || []).length,
        name: content.name || content.id || '',
      });
    } catch {
      versions.push({ version, savedAt: stat.mtime.toISOString(), ruleCount: 0, name: '' });
    }
  }

  return versions.sort((a, b) => b.version - a.version);
}

/**
 * Load a specific version backup.
 */
export function loadPolicyVersion(policyPath, version) {
  const realPath = expandHome(policyPath);
  const backupPath = realPath + '.v' + version;
  if (!fs.existsSync(backupPath)) return null;
  return JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
}

/**
 * Rollback to a specific version — copies backup to active (creating a new version).
 */
export function rollbackPolicy(policyPath, version) {
  const old = loadPolicyVersion(policyPath, version);
  if (!old) return null;
  savePolicy(policyPath, old); // savePolicy will auto-version
  return loadPolicy(policyPath);
}

// --- Time-based rules & auto-expire ---

/**
 * Filter rules to only those currently active (within schedule window, not expired).
 * @param {Array} rules
 * @param {Date} [now]
 * @returns {Array} active rules
 */
export function filterActiveRules(rules, now) {
  if (!rules) return [];
  const d = now || new Date();
  const hourUtc = d.getUTCHours();
  const dayOfWeek = d.getUTCDay();

  return rules.filter(rule => {
    // Check expiry
    if (rule.expiresAt) {
      if (new Date(rule.expiresAt) < d) return false;
    }

    // Check schedule
    if (rule.schedule) {
      const sched = rule.schedule;
      if (sched.hoursUtc && sched.hoursUtc.length === 2) {
        const [start, end] = sched.hoursUtc;
        if (start <= end) {
          if (hourUtc < start || hourUtc >= end) return false;
        } else {
          // Wraps midnight
          if (hourUtc < start && hourUtc >= end) return false;
        }
      }
      if (sched.daysOfWeek && sched.daysOfWeek.length > 0) {
        if (!sched.daysOfWeek.includes(dayOfWeek)) return false;
      }
    }

    return true;
  });
}

// --- Policy simulation ---

/**
 * Simulate a policy evaluation against a given action.
 * @param {object} policy - full policy object with rules and defaultEffect
 * @param {string} actionType - e.g. "filesystem.write"
 * @param {string} resource - e.g. "/etc/passwd"
 * @returns {{ matchedRule: object|null, effect: string, reason: string }}
 */
export function simulatePolicy(policy, actionType, resource) {
  if (!policy) return { matchedRule: null, effect: 'deny', reason: 'No policy loaded' };

  const rules = filterActiveRules(policy.rules || []);
  const action = { type: actionType, resource };

  for (const rule of rules) {
    if (matchesCondition(rule.condition, action)) {
      return {
        matchedRule: { id: rule.id, description: rule.description, effect: rule.effect },
        effect: rule.effect,
        reason: 'Matched rule: ' + (rule.description || rule.id),
      };
    }
  }

  const defaultEffect = policy.defaultEffect || 'deny';
  return {
    matchedRule: null,
    effect: defaultEffect,
    reason: 'No rule matched, using default: ' + defaultEffect,
  };
}

/**
 * Evaluate a condition against an action object.
 */
function matchesCondition(condition, action) {
  if (!condition) return false;

  if (condition.any) {
    return condition.any.some(pred => evaluatePredicate(pred, action));
  }
  if (condition.all) {
    return condition.all.every(pred => evaluatePredicate(pred, action));
  }

  // Single predicate at top level
  if (condition.field && condition.operator) {
    return evaluatePredicate(condition, action);
  }

  return false;
}

function evaluatePredicate(pred, action) {
  // Resolve field value: "action.type" → action.type, "action.resource" → action.resource
  let actual;
  if (pred.field === 'action.type') actual = action.type || '';
  else if (pred.field === 'action.resource') actual = action.resource || '';
  else return false;

  const value = pred.value || '';
  switch (pred.operator) {
    case 'eq': return actual === value;
    case 'startsWith': return actual.startsWith(value);
    case 'contains': return actual.includes(value);
    case 'matches': {
      const check = safeRegex(value);
      return check.valid && check.regex ? check.regex.test(actual) : false;
    }
    case 'in':
      if (Array.isArray(value)) return value.includes(actual);
      return String(value).split(',').map(s => s.trim()).includes(actual);
    default: return false;
  }
}

// --- Helpers ---

function extractVersionNumber(version) {
  if (!version) return 0;
  if (typeof version === 'number') return version;
  const match = String(version).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function policyHelp() {
  return `Policy tips:
- defaultEffect: deny
- use require_approval for risky actions
- action.type should be namespaced (network.http, secrets.read, payments.charge)
`;
}
