// Global settings module -load, save, and validate ~/.safeclaw/settings.json.
// All Phase 5 features (cache, webhooks, analytics) read from this.

import fs from 'fs';
import path from 'path';
import { configPaths } from './config.js';

const DEFAULT_SETTINGS_FILE = path.join(configPaths().CONFIG_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  approvalTimeoutSeconds: 300,
  notifyChannels: {
    sms: true,
    webhook: { url: '', events: [] },
  },
  auditRetentionDays: 90,
  costTrackingEnabled: true,
  offlineCacheEnabled: false,
  offlineCacheTtlSeconds: 300,
  theme: 'auto',
  browserNotifications: false,
  costBudget: { enabled: false, limitUsd: 10.00, period: 'daily', action: 'warn' },
};

const VALID_THEMES = ['auto', 'light', 'dark'];
const VALID_WEBHOOK_EVENTS = ['approval_required', 'approval_resolved', 'task_completed', 'task_failed', 'budget_warning', 'budget_exceeded'];
const VALID_BUDGET_PERIODS = ['daily', 'weekly', 'monthly'];
const VALID_BUDGET_ACTIONS = ['warn', 'require_approval', 'block'];

/**
 * Load settings, merging defaults for any missing keys.
 * @param {string} [settingsPath] Override path (for testing)
 * @returns {object}
 */
export function loadSettings(settingsPath) {
  const filePath = settingsPath || DEFAULT_SETTINGS_FILE;
  if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return mergeDefaults(raw, DEFAULT_SETTINGS);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to disk. Atomic write (tmp + rename).
 * @param {object} settings
 * @param {string} [settingsPath] Override path (for testing)
 */
export function saveSettings(settings, settingsPath) {
  const filePath = settingsPath || DEFAULT_SETTINGS_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/**
 * Validate a settings object.
 * @param {object} s
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSettings(s) {
  const errors = [];

  if (typeof s.approvalTimeoutSeconds !== 'number' || s.approvalTimeoutSeconds < 10 || s.approvalTimeoutSeconds > 3600) {
    errors.push('approvalTimeoutSeconds must be a number between 10 and 3600');
  }
  if (typeof s.auditRetentionDays !== 'number' || s.auditRetentionDays < 1 || s.auditRetentionDays > 365) {
    errors.push('auditRetentionDays must be a number between 1 and 365');
  }
  if (!VALID_THEMES.includes(s.theme)) {
    errors.push('theme must be one of: ' + VALID_THEMES.join(', '));
  }
  if (s.notifyChannels?.webhook?.url) {
    const url = s.notifyChannels.webhook.url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      errors.push('webhook URL must start with http:// or https://');
    } else {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const PRIVATE_PATTERNS = [
          /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
          /^169\.254\./, /^0\./, /^localhost$/i, /^::1$/, /^\[::1\]$/,
          /^fc[0-9a-f]{2}:/i, /^fe80:/i,
        ];
        if (PRIVATE_PATTERNS.some(p => p.test(host))) {
          errors.push('webhook URL must not point to a private or loopback address');
        }
      } catch {
        errors.push('webhook URL is not a valid URL');
      }
    }
  }
  if (s.notifyChannels?.webhook?.events) {
    for (const e of s.notifyChannels.webhook.events) {
      if (!VALID_WEBHOOK_EVENTS.includes(e)) {
        errors.push('Unknown webhook event: ' + e);
      }
    }
  }
  if (typeof s.offlineCacheTtlSeconds !== 'number' || s.offlineCacheTtlSeconds < 60 || s.offlineCacheTtlSeconds > 300) {
    errors.push('offlineCacheTtlSeconds must be a number between 60 and 300');
  }
  if (s.costBudget) {
    const b = s.costBudget;
    if (b.limitUsd !== undefined && (typeof b.limitUsd !== 'number' || b.limitUsd <= 0 || b.limitUsd > 10000)) {
      errors.push('costBudget.limitUsd must be a number between 0 and 10000');
    }
    if (b.period && !VALID_BUDGET_PERIODS.includes(b.period)) {
      errors.push('costBudget.period must be one of: ' + VALID_BUDGET_PERIODS.join(', '));
    }
    if (b.action && !VALID_BUDGET_ACTIONS.includes(b.action)) {
      errors.push('costBudget.action must be one of: ' + VALID_BUDGET_ACTIONS.join(', '));
    }
  }

  return { valid: errors.length === 0, errors };
}

// Deep merge, keeping existing values where present
function mergeDefaults(obj, defaults) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key in obj) {
      if (defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])) {
        result[key] = mergeDefaults(obj[key] || {}, defaults[key]);
      } else {
        result[key] = obj[key];
      }
    }
  }
  return result;
}
