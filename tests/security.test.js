import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

// --- Security tests for Phase 10 ---
// Tests CSRF protection, file permissions, ReDoS prevention,
// secrets redaction, and oversized payload rejection.

// --- Mock modules (same pattern as server-api.test.js) ---

const mockConfig = {
  activeProfile: 'default',
  profiles: {
    default: {
      provider: { name: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY', model: '' },
      authToken: 'test-token',
      controlPlane: 'https://api.authensor.com',
      installId: 'test',
      policy: { path: '/tmp/test-policy.json', id: 'default' },
    },
  },
};

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  saveConfig: vi.fn(),
  getProfile: vi.fn((cfg) => {
    const name = cfg.activeProfile || 'default';
    return cfg.profiles[name] ? { profile: cfg.profiles[name], name } : null;
  }),
  ensureProfile: vi.fn(),
  setActiveProfile: vi.fn(),
  configPaths: vi.fn(() => ({ CONFIG_DIR: path.join(os.tmpdir(), '.safeclaw-sec-test') })),
  loadDotEnv: vi.fn(),
  writeEnvVar: vi.fn(),
}));

vi.mock('../src/audit.js', () => ({
  readEntries: vi.fn(() => []),
  rotateLog: vi.fn(),
  verifyAuditIntegrity: vi.fn(() => ({ valid: true, totalEntries: 0, chainedEntries: 0, errors: [] })),
  appendEntry: vi.fn(),
}));

vi.mock('../src/doctor.js', () => ({
  runDiagnostics: vi.fn(async () => []),
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
  listPolicyVersions: vi.fn(() => []),
  rollbackPolicy: vi.fn(() => null),
  simulatePolicy: vi.fn(() => ({ matchedRule: null, effect: 'deny', reason: 'No rule matched' })),
}));

vi.mock('../src/analytics.js', () => ({
  computeCostSummary: vi.fn(() => ({})),
  computeApprovalMetrics: vi.fn(() => ({})),
  computeToolUsage: vi.fn(() => ({})),
  exportAudit: vi.fn(() => '[]'),
  computeMcpUsage: vi.fn(() => ({})),
  getKnownMcpServers: vi.fn(() => []),
}));

vi.mock('../src/authensor.js', () => ({
  AuthensorClient: class MockAuthensorClient {
    constructor() {}
    async health() { return { status: 'ok' }; }
    async listPendingApprovals() { return { items: [] }; }
    async createPolicy() { return { policyId: 'test', version: 1 }; }
    async setActivePolicy() { return {}; }
    async resolveApproval() { return {}; }
    async listReceipts() { return { items: [] }; }
    async provisionDemo() { return null; }
  },
}));

vi.mock('../src/rate-limit.js', () => ({
  enforceRateLimit: vi.fn(() => false),
}));

vi.mock('../src/webhook.js', () => ({
  sendWebhook: vi.fn(async () => {}),
}));

vi.mock('../src/budget.js', () => ({
  checkBudget: vi.fn(() => ({ enabled: false, exceeded: false })),
}));

vi.mock('../src/agent.js', () => ({
  runAgent: vi.fn(async () => {}),
}));

vi.mock('../src/scheduler.js', () => ({
  getSchedules: vi.fn(() => []),
  addSchedule: vi.fn(() => ({ id: 'sched_1' })),
  removeSchedule: vi.fn(() => true),
  updateSchedule: vi.fn(() => ({ id: 'sched_1' })),
  isQuietHours: vi.fn(() => false),
  nextCronRun: vi.fn(() => null),
  parseCron: vi.fn(() => ({})),
}));

vi.mock('../src/workspace.js', () => ({
  createWorkspaceConfig: vi.fn(() => '/tmp/.safeclaw.json'),
  detectWorkspace: vi.fn(() => ({ rootDir: '/tmp', scope: 'project' })),
}));

// Import after mocks
const { startServer, eventBus } = await import('../src/server.js');

// --- Helpers ---

function makeRequest(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Tests ---

describe('Security: CSRF protection', () => {
  let server, port;

  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const result = await startServer({ open: false });
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    delete process.env.ANTHROPIC_API_KEY;
    // Wait for server to fully close
    await new Promise(r => setTimeout(r, 50));
  });

  it('rejects POST without X-Requested-With header', async () => {
    const res = await makeRequest(port, 'POST', '/api/task', { task: 'test' });
    expect(res.status).toBe(403);
    expect(res.json.error).toContain('CSRF');
  });

  it('rejects PUT without X-Requested-With header', async () => {
    const res = await makeRequest(port, 'PUT', '/api/settings', { approvalTimeoutSeconds: 300 });
    expect(res.status).toBe(403);
    expect(res.json.error).toContain('CSRF');
  });

  it('rejects DELETE without X-Requested-With header', async () => {
    const res = await makeRequest(port, 'DELETE', '/api/task/queue/fake-id');
    expect(res.status).toBe(403);
    expect(res.json.error).toContain('CSRF');
  });

  it('allows POST with correct X-Requested-With header', async () => {
    const res = await makeRequest(port, 'POST', '/api/policy/simulate',
      { actionType: 'filesystem.write', resource: '/tmp/test.txt' },
      { 'X-Requested-With': 'SafeClaw' }
    );
    // Should not be 403 (may be 400 or 200 depending on mock state)
    expect(res.status).not.toBe(403);
  });

  it('allows GET requests without CSRF header', async () => {
    const res = await makeRequest(port, 'GET', '/api/status');
    expect(res.status).toBe(200);
  });
});

describe('Security: secrets redaction in validate.js', () => {
  // Import actual validate module (not mocked)
  let redactSecrets;

  beforeEach(async () => {
    const mod = await import('../src/validate.js');
    redactSecrets = mod.redactSecrets;
  });

  it('redacts Anthropic API keys', () => {
    const input = 'Using key sk-ant-abc123def456-ghi789';
    expect(redactSecrets(input)).not.toContain('sk-ant-abc123');
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts OpenAI API keys', () => {
    const input = 'Key is sk-proj-abcdefghij1234567890abcd';
    expect(redactSecrets(input)).not.toContain('sk-proj-');
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer sk-ant-secret123abc';
    expect(redactSecrets(input)).not.toContain('sk-ant-secret');
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts env var assignments', () => {
    const input = 'ANTHROPIC_API_KEY=sk-ant-secret123 OPENAI_API_KEY=sk-abcdef';
    const result = redactSecrets(input);
    expect(result).not.toContain('sk-ant-secret123');
    expect(result).toContain('[REDACTED]');
  });

  it('leaves normal text unchanged', () => {
    const input = 'Hello world, this is safe text.';
    expect(redactSecrets(input)).toBe(input);
  });
});

describe('Security: ReDoS prevention in safeRegex', () => {
  let safeRegex;

  beforeEach(async () => {
    const mod = await import('../src/validate.js');
    safeRegex = mod.safeRegex;
  });

  it('rejects nested quantifier pattern (a+)+b', () => {
    const result = safeRegex('(a+)+b');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('nested quantifiers');
  });

  it('rejects nested star quantifier (a*)*', () => {
    const result = safeRegex('(a*)*');
    expect(result.valid).toBe(false);
  });

  it('accepts safe patterns', () => {
    const result = safeRegex('^/tmp/.*\\.txt$');
    expect(result.valid).toBe(true);
    expect(result.regex).toBeInstanceOf(RegExp);
  });

  it('rejects invalid regex syntax', () => {
    const result = safeRegex('[unclosed');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('does not hang on malicious pattern', () => {
    const start = Date.now();
    safeRegex('(a+)+b');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be near-instant (static check)
  });
});

describe('Security: file permissions', () => {
  it('cache.js writes files with 0o600 permissions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-perm-'));
    const cachePath = path.join(tmpDir, 'test-cache.json');

    // Import actual cache module
    const { cacheDecision, _resetMemCache } = await import('../src/cache.js');
    _resetMemCache();
    cacheDecision('test.action', '/test', 'allow', 3600, cachePath);

    const stat = fs.statSync(cachePath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('audit.js writes files with 0o600 permissions', async () => {
    // Use real audit module for permission check
    const { appendEntry: realAppendEntry, _resetLastHash } = await vi.importActual('../src/audit.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-audit-perm-'));
    const auditPath = path.join(tmpDir, 'test-audit.jsonl');
    _resetLastHash();

    realAppendEntry({ timestamp: new Date().toISOString(), toolName: 'test', actionType: 'test', resource: '/test', outcome: 'allow', source: 'test' }, auditPath);

    const stat = fs.statSync(auditPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('Security: oversized payload rejection', () => {
  let server, port;

  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const result = await startServer({ open: false });
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    delete process.env.ANTHROPIC_API_KEY;
    await new Promise(r => setTimeout(r, 50));
  });

  it('rejects body larger than 1MB', async () => {
    const largeBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await new Promise((resolve, reject) => {
      const opts = {
        hostname: '127.0.0.1',
        port,
        path: '/api/setup',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'SafeClaw',
        },
      };
      const req = http.request(opts, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() });
        });
      });
      req.on('error', (err) => {
        // Connection may be destroyed by server -that's the expected behavior
        resolve({ status: 0, text: err.message });
      });
      req.write(largeBody);
      req.end();
    });

    // Server should either return an error status or destroy the connection
    expect(res.status === 0 || res.status >= 400).toBe(true);
  });
});

describe('Security: error classification', () => {
  let server, port;

  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const result = await startServer({ open: false });
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    delete process.env.ANTHROPIC_API_KEY;
    await new Promise(r => setTimeout(r, 50));
  });

  it('returns 404 for unknown API route', async () => {
    const res = await makeRequest(port, 'GET', '/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 for missing session', async () => {
    const res = await makeRequest(port, 'GET', '/api/sessions/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await makeRequest(port, 'POST', '/api/policy/simulate',
      { resource: '/tmp' },  // missing actionType
      { 'X-Requested-With': 'SafeClaw' }
    );
    expect(res.status).toBe(400);
  });
});
