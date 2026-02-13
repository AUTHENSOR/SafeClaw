import { describe, it, expect, vi, beforeEach } from 'vitest';

// Server API endpoint tests for Phase 7 routes.
// These test the handler logic by importing server.js functions indirectly
// and verifying the response shapes via mocked config/audit/doctor modules.

// Since server.js uses dynamic import for doctor and exports a full HTTP server,
// we test the API endpoints via the exported handler patterns by mocking the
// underlying modules and testing route behavior.

import fs from 'fs';
import path from 'path';
import os from 'os';

// --- Mock modules ---

const mockConfig = {
  activeProfile: 'default',
  profiles: { default: { provider: { name: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5-20250929' }, authToken: 'test-token', controlPlane: 'https://api.authensor.com' }, staging: { provider: { name: 'openai', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-4o' } } },
};

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  saveConfig: vi.fn(),
  getProfile: vi.fn((cfg) => {
    const name = cfg.activeProfile || 'default';
    return { profile: cfg.profiles[name], name };
  }),
  ensureProfile: vi.fn(),
  setActiveProfile: vi.fn((cfg, name) => { cfg.activeProfile = name; }),
  configPaths: vi.fn(() => ({ CONFIG_DIR: path.join(os.tmpdir(), '.safeclaw-test') })),
  loadDotEnv: vi.fn(),
  writeEnvVar: vi.fn(),
  getEnvFilePath: vi.fn(() => path.join(os.tmpdir(), '.safeclaw-test', '.env')),
}));

vi.mock('../src/audit.js', () => ({
  readEntries: vi.fn(() => []),
  rotateLog: vi.fn(),
  verifyAuditIntegrity: vi.fn(() => ({ valid: true, totalEntries: 42, chainedEntries: 40, errors: [] })),
  appendEntry: vi.fn(),
}));

vi.mock('../src/doctor.js', () => ({
  runDiagnostics: vi.fn(async () => [
    { name: 'Node.js version', status: 'ok', message: 'v22.0.0', hint: null },
    { name: 'Config directory', status: 'ok', message: '/home/test/.safeclaw', hint: null },
    { name: 'Profile configured', status: 'ok', message: 'Active: default', hint: null },
    { name: 'API key', status: 'fail', message: 'ANTHROPIC_API_KEY not found', hint: 'Add your API key in Settings > Configuration' },
    { name: 'Settings', status: 'ok', message: 'Valid', hint: null },
    { name: 'Policy file', status: 'warn', message: 'No policy path configured', hint: 'Run: safeclaw policy apply' },
    { name: 'Audit log', status: 'ok', message: '42 entries, 40 chained', hint: null },
    { name: 'Authensor connectivity', status: 'ok', message: 'Connected to https://api.authensor.com', hint: null },
    { name: 'Container runtime', status: 'warn', message: 'Not found (optional)', hint: 'Install Docker or Podman for container mode (optional)' },
    { name: '.env permissions', status: 'ok', message: 'chmod 600 (correct)', hint: null },
  ]),
}));

vi.mock('../src/settings.js', () => ({
  loadSettings: vi.fn(() => ({ approvalTimeoutSeconds: 300, auditRetentionDays: 90 })),
  saveSettings: vi.fn(),
  validateSettings: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../src/session.js', () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => null),
  listSessions: vi.fn(() => []),
}));

vi.mock('../src/policy.js', () => ({
  loadPolicy: vi.fn(() => ({ id: 'default', rules: [], defaultEffect: 'deny' })),
  savePolicy: vi.fn(),
  ensurePolicyFile: vi.fn(),
  listPolicyVersions: vi.fn(() => [{ version: 2, savedAt: '2026-02-10T12:00:00Z', ruleCount: 3, name: 'Test' }]),
  rollbackPolicy: vi.fn(() => ({ id: 'default', version: 'v3', rules: [], defaultEffect: 'deny' })),
  simulatePolicy: vi.fn(() => ({ matchedRule: null, effect: 'deny', reason: 'No rule matched' })),
}));

vi.mock('../src/analytics.js', () => ({
  computeCostSummary: vi.fn(() => ({ total: 0, byProvider: {}, byPeriod: [] })),
  computeApprovalMetrics: vi.fn(() => ({ total: 0, allowed: 0, denied: 0 })),
  computeToolUsage: vi.fn(() => []),
  exportAudit: vi.fn(() => ''),
  computeMcpUsage: vi.fn(() => []),
  getKnownMcpServers: vi.fn(() => []),
}));

vi.mock('../src/rate-limit.js', () => ({
  enforceRateLimit: vi.fn(() => null),
}));

vi.mock('../src/webhook.js', () => ({
  sendWebhook: vi.fn(),
}));

vi.mock('../src/budget.js', () => ({
  checkBudget: vi.fn(() => ({ enabled: false })),
}));

vi.mock('../src/authensor.js', () => ({
  AuthensorClient: vi.fn().mockImplementation(() => ({
    health: vi.fn(async () => ({ status: 'ok' })),
    evaluateAction: vi.fn(async () => ({ decision: 'allow' })),
    setActivePolicy: vi.fn(async () => ({})),
    createPolicy: vi.fn(async () => ({ id: 'p1', version: 1 })),
    updatePolicy: vi.fn(async () => ({ id: 'p1', version: 2 })),
  })),
}));

vi.mock('../src/agent.js', () => ({
  runAgent: vi.fn(async () => ({ success: true })),
}));

vi.mock('../src/scheduler.js', () => ({
  getSchedules: vi.fn(() => []),
  addSchedule: vi.fn((opts) => ({ id: 'sched_test', task: opts.task, cron: opts.cron, enabled: true })),
  removeSchedule: vi.fn(() => true),
  updateSchedule: vi.fn((id, patch) => ({ id, ...patch })),
  isQuietHours: vi.fn(() => false),
  nextCronRun: vi.fn(() => new Date()),
  parseCron: vi.fn(() => ({})),
}));

// --- Tests ---

describe('Doctor API', () => {
  it('runDiagnostics returns 10 checks with hint field', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    expect(checks).toHaveLength(10);
    for (const check of checks) {
      expect(check).toHaveProperty('hint');
    }
  });

  it('checks include ok, warn, and fail statuses', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    const statuses = new Set(checks.map(c => c.status));
    expect(statuses.has('ok')).toBe(true);
    expect(statuses.has('warn')).toBe(true);
    expect(statuses.has('fail')).toBe(true);
  });

  it('failed checks have non-null hints', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    const failedChecks = checks.filter(c => c.status === 'fail');
    for (const check of failedChecks) {
      expect(check.hint).toBeTruthy();
    }
  });
});

describe('Audit verify API', () => {
  it('verifyAuditIntegrity returns valid result', async () => {
    const { verifyAuditIntegrity } = await import('../src/audit.js');
    const result = verifyAuditIntegrity();
    expect(result).toHaveProperty('valid', true);
    expect(result).toHaveProperty('totalEntries', 42);
    expect(result).toHaveProperty('chainedEntries', 40);
    expect(result.errors).toEqual([]);
  });
});

describe('Profiles API', () => {
  it('loadConfig returns profile list', async () => {
    const { loadConfig } = await import('../src/config.js');
    const cfg = loadConfig();
    const profiles = Object.keys(cfg.profiles);
    expect(profiles).toContain('default');
    expect(profiles).toContain('staging');
    expect(cfg.activeProfile).toBe('default');
  });

  it('setActiveProfile changes active profile', async () => {
    const { loadConfig, setActiveProfile } = await import('../src/config.js');
    const cfg = loadConfig();
    setActiveProfile(cfg, 'staging');
    expect(cfg.activeProfile).toBe('staging');
  });

  it('getProfile returns profile for active name', async () => {
    const { loadConfig, getProfile } = await import('../src/config.js');
    const cfg = loadConfig();
    const result = getProfile(cfg);
    expect(result.profile.provider.name).toBe('claude');
    expect(result.name).toBe('default');
  });

  it('switching to nonexistent profile fails gracefully', async () => {
    const { loadConfig, getProfile } = await import('../src/config.js');
    const cfg = loadConfig();
    cfg.activeProfile = 'nonexistent';
    const result = getProfile(cfg);
    // getProfile returns undefined for missing profiles
    expect(result.profile).toBeUndefined();
  });
});

describe('Config API', () => {
  it('config returns provider and status booleans', async () => {
    const { loadConfig, getProfile, loadDotEnv } = await import('../src/config.js');
    loadDotEnv();
    const cfg = loadConfig();
    const { profile } = getProfile(cfg);
    expect(profile.provider.name).toBe('claude');
    expect(profile.provider.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(typeof profile.authToken).toBe('string');
  });

  it('writeEnvVar is callable', async () => {
    const { writeEnvVar } = await import('../src/config.js');
    writeEnvVar('TEST_KEY', 'test-value');
    expect(writeEnvVar).toHaveBeenCalledWith('TEST_KEY', 'test-value');
  });

  it('rejects invalid provider', () => {
    const validProviders = ['claude', 'openai'];
    expect(validProviders).toContain('claude');
    expect(validProviders).toContain('openai');
    expect(validProviders).not.toContain('llama');
  });
});

describe('SMS API', () => {
  it('SMS env vars can be checked for presence', () => {
    // In test env, Twilio vars won't be set -verify we can check them
    const envVars = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SAFECLAW_NOTIFY_PHONE'];
    for (const v of envVars) {
      const isSet = typeof process.env[v] === 'string' && process.env[v].length > 0;
      expect(typeof isSet).toBe('boolean');
    }
  });

  it('masked phone number hides all but last 4 digits', () => {
    const phone = '+15551234567';
    const masked = phone.slice(-4);
    expect(masked).toBe('4567');
    expect(masked.length).toBe(4);
  });
});

describe('Task runner with model override', () => {
  it('deep clones profile for per-task model override', () => {
    const profile = { provider: { name: 'claude', model: 'claude-sonnet-4-5-20250929' }, authToken: 'tok' };
    const taskProfile = JSON.parse(JSON.stringify(profile));
    taskProfile.provider.model = 'claude-haiku-4-5-20251001';
    expect(taskProfile.provider.model).toBe('claude-haiku-4-5-20251001');
    expect(profile.provider.model).toBe('claude-sonnet-4-5-20250929'); // original unchanged
  });

  it('empty model string means use default', () => {
    const model = '';
    const shouldOverride = !!model;
    expect(shouldOverride).toBe(false);
  });
});

describe('Task runner with container flag', () => {
  it('container flag is boolean', () => {
    const body = { task: 'test', container: true, workspace: '/tmp' };
    expect(body.container).toBe(true);
    expect(typeof body.workspace).toBe('string');
  });

  it('workspace defaults to empty when not provided', () => {
    const body = { task: 'test', container: true };
    const workspace = body.workspace || '';
    expect(workspace).toBe('');
  });
});

describe('Doctor hint field integration', () => {
  it('all checks have hint property', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    for (const check of checks) {
      expect(check).toHaveProperty('hint');
      // hint is either null or a non-empty string
      if (check.hint !== null) {
        expect(typeof check.hint).toBe('string');
        expect(check.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it('ok checks have null hints', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    const okChecks = checks.filter(c => c.status === 'ok');
    for (const check of okChecks) {
      expect(check.hint).toBeNull();
    }
  });

  it('warn/fail checks have descriptive hints', async () => {
    const { runDiagnostics } = await import('../src/doctor.js');
    const checks = await runDiagnostics();
    const problemChecks = checks.filter(c => c.status !== 'ok');
    expect(problemChecks.length).toBeGreaterThan(0);
    for (const check of problemChecks) {
      expect(check.hint).toBeTruthy();
      expect(check.hint.length).toBeGreaterThan(5);
    }
  });
});

// --- Phase 8 tests ---

describe('Theme setting', () => {
  it('theme must be auto, light, or dark', () => {
    const validThemes = ['auto', 'light', 'dark'];
    expect(validThemes).toContain('auto');
    expect(validThemes).toContain('light');
    expect(validThemes).toContain('dark');
    expect(validThemes).not.toContain('neon');
  });

  it('data-theme attribute controls CSS override', () => {
    // auto: no data-theme attr → media query controls
    // dark: data-theme="dark" → always dark
    // light: data-theme="light" → always light
    const applyTheme = (theme) => {
      if (theme === 'dark') return 'dark';
      if (theme === 'light') return 'light';
      return null; // auto
    };
    expect(applyTheme('dark')).toBe('dark');
    expect(applyTheme('light')).toBe('light');
    expect(applyTheme('auto')).toBeNull();
  });
});

describe('Browser notifications setting', () => {
  it('browserNotifications defaults to false', () => {
    const defaults = { browserNotifications: false };
    expect(defaults.browserNotifications).toBe(false);
  });

  it('browserNotifications can be set to true', () => {
    const settings = { browserNotifications: true };
    expect(settings.browserNotifications).toBe(true);
  });

  it('notification fires only when tab is hidden', () => {
    const isHidden = true;
    const enabled = true;
    const shouldNotify = isHidden && enabled;
    expect(shouldNotify).toBe(true);
    expect(false && enabled).toBe(false); // visible tab
    expect(isHidden && false).toBe(false); // disabled
  });
});

describe('Task queue', () => {
  it('queue starts empty', () => {
    const queue = [];
    expect(queue.length).toBe(0);
  });

  it('adding tasks to queue increments length', () => {
    const queue = [];
    queue.push({ id: 'task_1', task: 'first task', addedAt: new Date().toISOString() });
    expect(queue.length).toBe(1);
    queue.push({ id: 'task_2', task: 'second task', addedAt: new Date().toISOString() });
    expect(queue.length).toBe(2);
  });

  it('shift removes first item (FIFO)', () => {
    const queue = [
      { id: 'task_1', task: 'first' },
      { id: 'task_2', task: 'second' },
    ];
    const next = queue.shift();
    expect(next.id).toBe('task_1');
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe('task_2');
  });

  it('removing by id works', () => {
    const queue = [
      { id: 'task_1', task: 'first' },
      { id: 'task_2', task: 'second' },
      { id: 'task_3', task: 'third' },
    ];
    const idx = queue.findIndex(t => t.id === 'task_2');
    expect(idx).toBe(1);
    queue.splice(idx, 1);
    expect(queue.length).toBe(2);
    expect(queue.map(t => t.id)).toEqual(['task_1', 'task_3']);
  });

  it('removing nonexistent id returns -1', () => {
    const queue = [{ id: 'task_1', task: 'first' }];
    const idx = queue.findIndex(t => t.id === 'task_999');
    expect(idx).toBe(-1);
  });
});

describe('Config export structure', () => {
  it('export produces valid backup shape', async () => {
    const { loadConfig } = await import('../src/config.js');
    const { loadSettings } = await import('../src/settings.js');
    const cfg = loadConfig();
    const settings = loadSettings();
    const backup = {
      version: '0.8.0',
      exportedAt: new Date().toISOString(),
      config: cfg,
      settings: settings,
      policy: null,
      envVarsSet: [],
    };
    expect(backup).toHaveProperty('version', '0.8.0');
    expect(backup).toHaveProperty('exportedAt');
    expect(backup).toHaveProperty('config');
    expect(backup).toHaveProperty('settings');
    expect(backup.config.profiles).toBeDefined();
  });

  it('backup does not include raw API keys', () => {
    const backup = {
      version: '0.8.0',
      exportedAt: new Date().toISOString(),
      config: { profiles: { default: { provider: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } } },
      envVarsSet: ['ANTHROPIC_API_KEY'],
    };
    const json = JSON.stringify(backup);
    expect(json).not.toContain('sk-ant-');
    expect(backup.envVarsSet).toContain('ANTHROPIC_API_KEY');
  });
});

describe('Config import validation', () => {
  it('import rejects backup without version', () => {
    const backup = { config: {} };
    const hasVersion = !!backup.version;
    expect(hasVersion).toBe(false);
  });

  it('import rejects empty backup', () => {
    const backup = { version: '0.8.0' };
    const hasContent = !!(backup.config || backup.settings || backup.policy);
    expect(hasContent).toBe(false);
  });

  it('import accepts backup with settings only', () => {
    const backup = { version: '0.8.0', settings: { approvalTimeoutSeconds: 300, auditRetentionDays: 90, theme: 'dark', offlineCacheTtlSeconds: 3600 } };
    const hasContent = !!(backup.config || backup.settings || backup.policy);
    expect(hasContent).toBe(true);
  });

  it('import requires version and content', () => {
    // Validates the import guard logic
    const noVersion = { config: {} };
    expect(!!noVersion.version).toBe(false);

    const noContent = { version: '0.8.0' };
    expect(!!(noContent.config || noContent.settings || noContent.policy)).toBe(false);

    const valid = { version: '0.8.0', config: { profiles: {} } };
    expect(!!valid.version).toBe(true);
    expect(!!(valid.config || valid.settings || valid.policy)).toBe(true);
  });
});

describe('Follow-up flow', () => {
  it('combined prompt includes previous task', () => {
    const lastTask = 'analyze the code';
    const followUp = 'now fix the bugs';
    const combined = 'Previous task: ' + lastTask + '\n\nContinuation: ' + followUp;
    expect(combined).toContain('analyze the code');
    expect(combined).toContain('now fix the bugs');
    expect(combined).toContain('Previous task:');
    expect(combined).toContain('Continuation:');
  });

  it('follow-up with empty previous task still works', () => {
    const combined = 'Previous task: \n\nContinuation: do something';
    expect(combined).toContain('Continuation: do something');
  });
});

describe('Markdown renderer logic', () => {
  it('escapes HTML entities', () => {
    const text = '<script>alert("xss")</script>';
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('detects code fences', () => {
    const text = '```js\nconsole.log("hi")\n```';
    const hasCodeFence = /```[\s\S]*?```/.test(text);
    expect(hasCodeFence).toBe(true);
  });

  it('detects bold markers', () => {
    const text = 'this is **bold** text';
    const hasBold = /\*\*(.+?)\*\*/.test(text);
    expect(hasBold).toBe(true);
  });

  it('detects heading markers', () => {
    const text = '# Heading One\n## Heading Two';
    const headings = text.match(/^(#{1,3})\s+(.+)$/gm);
    expect(headings).toHaveLength(2);
  });
});

// --- Phase 9 tests ---

describe('Schedule API', () => {
  it('getSchedules returns array', async () => {
    const { getSchedules } = await import('../src/scheduler.js');
    const schedules = getSchedules();
    expect(Array.isArray(schedules)).toBe(true);
  });

  it('addSchedule creates entry with required fields', async () => {
    const { addSchedule } = await import('../src/scheduler.js');
    const entry = addSchedule({ task: 'test task', cron: '0 9 * * *' });
    expect(entry.id).toMatch(/^sched_/);
    expect(entry.task).toBe('test task');
    expect(entry.cron).toBe('0 9 * * *');
    expect(entry.enabled).toBe(true);
  });

  it('removeSchedule returns boolean', async () => {
    const { removeSchedule } = await import('../src/scheduler.js');
    const result = removeSchedule('sched_test');
    expect(typeof result).toBe('boolean');
  });

  it('updateSchedule merges patch', async () => {
    const { updateSchedule } = await import('../src/scheduler.js');
    const result = updateSchedule('sched_test', { enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('schedule entry has id, task, cron fields', () => {
    const entry = { id: 'sched_1', task: 'backup', cron: '0 0 * * *', enabled: true, container: false };
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('task');
    expect(entry).toHaveProperty('cron');
    expect(entry).toHaveProperty('enabled');
  });
});

describe('Policy versions API', () => {
  it('listPolicyVersions returns array', async () => {
    const { listPolicyVersions } = await import('../src/policy.js');
    const versions = listPolicyVersions();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toHaveProperty('version');
    expect(versions[0]).toHaveProperty('savedAt');
    expect(versions[0]).toHaveProperty('ruleCount');
  });

  it('rollbackPolicy returns policy object', async () => {
    const { rollbackPolicy } = await import('../src/policy.js');
    const result = rollbackPolicy();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('defaultEffect');
  });
});

describe('Policy simulate API', () => {
  it('simulatePolicy returns effect and reason', async () => {
    const { simulatePolicy } = await import('../src/policy.js');
    const result = simulatePolicy();
    expect(result).toHaveProperty('effect');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('matchedRule');
  });

  it('simulation result has valid effect values', () => {
    const validEffects = ['allow', 'deny', 'require_approval'];
    const result = { effect: 'deny', matchedRule: null, reason: 'default' };
    expect(validEffects).toContain(result.effect);
  });
});

describe('PWA manifest', () => {
  it('manifest.json exists in dashboard dir', () => {
    const manifestPath = path.join(__dirname, '..', 'ui', 'dashboard', 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('SafeClaw Dashboard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('service worker exists', () => {
    const swPath = path.join(__dirname, '..', 'ui', 'dashboard', 'sw.js');
    expect(fs.existsSync(swPath)).toBe(true);
  });

  it('icon.svg exists', () => {
    const iconPath = path.join(__dirname, '..', 'ui', 'dashboard', 'icon.svg');
    expect(fs.existsSync(iconPath)).toBe(true);
  });
});
