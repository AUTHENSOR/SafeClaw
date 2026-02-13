import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import os from 'os';

// --- Integration tests for Phase 10 ---
// Start a real HTTP server and test endpoint behavior end-to-end.

// --- Mock modules ---

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
  configPaths: vi.fn(() => ({ CONFIG_DIR: path.join(os.tmpdir(), '.safeclaw-int-test') })),
  loadDotEnv: vi.fn(),
  writeEnvVar: vi.fn(),
}));

vi.mock('../src/audit.js', () => ({
  readEntries: vi.fn(() => []),
  rotateLog: vi.fn(),
  verifyAuditIntegrity: vi.fn(() => ({ valid: true, totalEntries: 5, chainedEntries: 5, errors: [] })),
  appendEntry: vi.fn(),
}));

vi.mock('../src/doctor.js', () => ({
  runDiagnostics: vi.fn(async () => [
    { name: 'Node.js version', status: 'ok', message: 'v22.0.0' },
  ]),
}));

vi.mock('../src/settings.js', () => ({
  loadSettings: vi.fn(() => ({ approvalTimeoutSeconds: 300, auditRetentionDays: 90 })),
  saveSettings: vi.fn(),
  validateSettings: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../src/session.js', () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn((id) => id === 'existing-session' ? { id, task: 'test', messages: [] } : null),
  listSessions: vi.fn(() => [{ id: 'task_1', task: 'test', status: 'success', startedAt: '2026-01-01T00:00:00Z' }]),
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
  computeCostSummary: vi.fn(() => ({ totalUsd: 1.5, count: 10 })),
  computeApprovalMetrics: vi.fn(() => ({ total: 5, approved: 3, rejected: 2 })),
  computeToolUsage: vi.fn(() => ({ tools: {} })),
  exportAudit: vi.fn((format) => format === 'csv' ? 'timestamp,action\n' : '[]'),
  computeMcpUsage: vi.fn(() => ({})),
  getKnownMcpServers: vi.fn(() => []),
}));

vi.mock('../src/authensor.js', () => ({
  AuthensorClient: class MockAuthensorClient {
    constructor() {}
    async health() { return { status: 'ok' }; }
    async listPendingApprovals() { return { items: [{ id: 'a1' }, { id: 'a2' }] }; }
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

const { startServer, eventBus } = await import('../src/server.js');

// --- Helpers ---

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
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
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// --- Tests ---

describe('Integration: API endpoints', () => {
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

  it('GET /api/status returns expected shape', async () => {
    const res = await request(port, 'GET', '/api/status');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('setupComplete');
    expect(res.json).toHaveProperty('activeProfile');
    expect(res.json).toHaveProperty('agentStatus');
    expect(res.json).toHaveProperty('queueLength');
    expect(res.json.agentStatus).toBe('idle');
  });

  it('GET /api/health returns version and uptime', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json.version).toBe('1.0.0-beta.2');
    expect(typeof res.json.uptime).toBe('number');
    expect(res.json).toHaveProperty('schedulerRunning');
    expect(res.json).toHaveProperty('auditIntegrity');
    expect(res.json).toHaveProperty('pendingApprovals');
  });

  it('GET /api/health includes audit integrity', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.json.auditIntegrity).toBe('ok');
  });

  it('GET /api/health includes pending approvals count', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.json.pendingApprovals).toBe(2);
  });

  it('POST without CSRF header returns 403', async () => {
    const res = await request(port, 'POST', '/api/task', { task: 'test' });
    expect(res.status).toBe(403);
  });

  it('GET /api/sessions returns list', async () => {
    const res = await request(port, 'GET', '/api/sessions');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('sessions');
    expect(Array.isArray(res.json.sessions)).toBe(true);
  });

  it('GET /api/settings returns settings object', async () => {
    const res = await request(port, 'GET', '/api/settings');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('approvalTimeoutSeconds');
  });

  it('GET /api/budget returns budget status', async () => {
    const res = await request(port, 'GET', '/api/budget');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('enabled');
  });

  it('returns 404 for unknown API route', async () => {
    const res = await request(port, 'GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('serves static files for non-API routes', async () => {
    // This should try to serve static; may 404 if file doesn't exist but shouldn't 500
    const res = await request(port, 'GET', '/nonexistent.html');
    expect(res.status === 200 || res.status === 404).toBe(true);
  });

  it('includes security headers in responses', async () => {
    const res = await request(port, 'GET', '/api/status');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('GET /api/doctor returns checks array', async () => {
    const res = await request(port, 'GET', '/api/doctor');
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('checks');
    expect(Array.isArray(res.json.checks)).toBe(true);
  });

  it('GET /api/profiles returns profiles and active', async () => {
    const res = await request(port, 'GET', '/api/profiles');
    expect(res.status).toBe(200);
    expect(res.json.active).toBe('default');
    expect(Array.isArray(res.json.profiles)).toBe(true);
  });

  it('GET /api/analytics/cost returns cost data', async () => {
    const res = await request(port, 'GET', '/api/analytics/cost');
    expect(res.status).toBe(200);
  });
});

describe('Integration: SSE connections', () => {
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

  it('SSE /api/events connects and receives heartbeat header', async () => {
    const result = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
          // As soon as we get the connected comment, resolve
          if (data.includes(': connected')) {
            req.destroy();
            resolve({ status: res.statusCode, data });
          }
        });
      });
      // Timeout after 2s
      setTimeout(() => {
        req.destroy();
        resolve({ status: 0, data: '' });
      }, 2000);
    });

    expect(result.status).toBe(200);
    expect(result.data).toContain(': connected');
  });
});
