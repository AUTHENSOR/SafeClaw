import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeCostSummary, computeApprovalMetrics, computeToolUsage, exportAudit, computeMcpUsage, getKnownMcpServers } from '../src/analytics.js';
import { _resetLastHash } from '../src/audit.js';
import { appendEntry } from '../src/audit.js';
import { saveSession } from '../src/session.js';

let tmpDir;
let auditPath;
let sessionsDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-analytics-'));
  auditPath = path.join(tmpDir, 'audit.jsonl');
  sessionsDir = path.join(tmpDir, 'sessions');
  _resetLastHash();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSession(overrides = {}) {
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    task: 'Test',
    provider: 'claude',
    model: '',
    profile: 'default',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'success',
    cost: null,
    error: null,
    messages: [],
    toolCalls: [],
    ...overrides,
  };
}

function makeEntry(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    toolName: 'Bash',
    actionType: 'code.exec',
    resource: 'ls',
    outcome: 'allow',
    receiptId: null,
    taskId: null,
    profile: 'default',
    source: 'authensor',
    ...overrides,
  };
}

describe('computeCostSummary', () => {
  it('returns zero totals with no sessions', () => {
    const result = computeCostSummary('day', sessionsDir);
    expect(result.total).toBe(0);
    expect(result.byPeriod).toEqual([]);
  });

  it('sums costs by provider', () => {
    saveSession(makeSession({ id: 'c1', provider: 'claude', cost: '0.0100' }), sessionsDir);
    saveSession(makeSession({ id: 'c2', provider: 'claude', cost: '0.0200' }), sessionsDir);
    saveSession(makeSession({ id: 'o1', provider: 'openai', cost: '0.0050' }), sessionsDir);

    const result = computeCostSummary('day', sessionsDir);
    expect(result.total).toBeCloseTo(0.035, 4);
    expect(result.byProvider.claude).toBeCloseTo(0.03, 4);
    expect(result.byProvider.openai).toBeCloseTo(0.005, 4);
  });

  it('groups by day period', () => {
    saveSession(makeSession({ id: 'd1', cost: '0.01', startedAt: '2026-01-15T10:00:00Z' }), sessionsDir);
    saveSession(makeSession({ id: 'd2', cost: '0.02', startedAt: '2026-01-15T14:00:00Z' }), sessionsDir);
    saveSession(makeSession({ id: 'd3', cost: '0.03', startedAt: '2026-01-16T10:00:00Z' }), sessionsDir);

    const result = computeCostSummary('day', sessionsDir);
    expect(result.byPeriod.length).toBe(2);
    const jan15 = result.byPeriod.find(p => p.label === '2026-01-15');
    expect(jan15.cost).toBeCloseTo(0.03, 4);
  });

  it('groups by month period', () => {
    saveSession(makeSession({ id: 'm1', cost: '0.01', startedAt: '2026-01-15T10:00:00Z' }), sessionsDir);
    saveSession(makeSession({ id: 'm2', cost: '0.02', startedAt: '2026-02-10T10:00:00Z' }), sessionsDir);

    const result = computeCostSummary('month', sessionsDir);
    expect(result.byPeriod.length).toBe(2);
    expect(result.byPeriod[0].label).toBe('2026-01');
    expect(result.byPeriod[1].label).toBe('2026-02');
  });
});

describe('computeApprovalMetrics', () => {
  it('returns zeros with no entries', () => {
    const result = computeApprovalMetrics(auditPath);
    expect(result.total).toBe(0);
    expect(result.allowed).toBe(0);
    expect(result.approvalRate).toBe(0);
  });

  it('counts outcomes correctly', () => {
    appendEntry(makeEntry({ outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ outcome: 'deny' }), auditPath);

    const result = computeApprovalMetrics(auditPath);
    expect(result.total).toBe(3);
    expect(result.allowed).toBe(2);
    expect(result.denied).toBe(1);
  });

  it('computes approval rate', () => {
    appendEntry(makeEntry({ outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ outcome: 'deny' }), auditPath);

    const result = computeApprovalMetrics(auditPath);
    expect(result.approvalRate).toBeCloseTo(0.5, 2);
  });

  it('computes top actions', () => {
    for (let i = 0; i < 5; i++) appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);
    for (let i = 0; i < 3; i++) appendEntry(makeEntry({ actionType: 'filesystem.write' }), auditPath);
    appendEntry(makeEntry({ actionType: 'network.http' }), auditPath);

    const result = computeApprovalMetrics(auditPath);
    expect(result.topActions[0].actionType).toBe('code.exec');
    expect(result.topActions[0].count).toBe(5);
  });
});

describe('computeToolUsage', () => {
  it('counts by tool name', () => {
    appendEntry(makeEntry({ toolName: 'Bash' }), auditPath);
    appendEntry(makeEntry({ toolName: 'Bash' }), auditPath);
    appendEntry(makeEntry({ toolName: 'Read', outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ toolName: 'Bash', outcome: 'deny' }), auditPath);

    const result = computeToolUsage(auditPath);
    const bash = result.find(t => t.toolName === 'Bash');
    expect(bash.count).toBe(3);
    expect(bash.allowRate).toBeCloseTo(2 / 3, 2);
  });
});

describe('exportAudit', () => {
  it('returns valid JSON', () => {
    appendEntry(makeEntry({ resource: 'cmd1' }), auditPath);
    appendEntry(makeEntry({ resource: 'cmd2' }), auditPath);

    const result = exportAudit('json', auditPath);
    const parsed = JSON.parse(result);
    expect(parsed.length).toBe(2);
  });

  it('returns valid CSV', () => {
    appendEntry(makeEntry({ resource: 'ls' }), auditPath);
    appendEntry(makeEntry({ resource: 'rm,dangerous' }), auditPath);

    const result = exportAudit('csv', auditPath);
    const lines = result.split('\n');
    expect(lines[0]).toBe('timestamp,toolName,actionType,resource,outcome,receiptId,taskId,profile,source');
    expect(lines.length).toBe(3); // header + 2 rows
    // CSV-escaped comma in resource
    expect(lines[2]).toContain('"rm,dangerous"');
  });
});

describe('computeMcpUsage', () => {
  it('returns empty for no MCP entries', () => {
    appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);
    const result = computeMcpUsage(auditPath);
    expect(result).toEqual([]);
  });

  it('groups by MCP server', () => {
    appendEntry(makeEntry({ actionType: 'mcp.github.create_issue', outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.github.list_repos', outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.slack.send_message', outcome: 'deny' }), auditPath);

    const result = computeMcpUsage(auditPath);
    expect(result.length).toBe(2);
    const github = result.find(s => s.server === 'github');
    expect(github.totalCalls).toBe(2);
    expect(github.allowRate).toBe(1.0);
    expect(github.actions.length).toBe(2);
  });

  it('counts actions within a server', () => {
    appendEntry(makeEntry({ actionType: 'mcp.db.query', outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.db.query', outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.db.write', outcome: 'deny' }), auditPath);

    const result = computeMcpUsage(auditPath);
    const db = result.find(s => s.server === 'db');
    expect(db.totalCalls).toBe(3);
    expect(db.allowRate).toBeCloseTo(2 / 3, 2);
    expect(db.actions[0].action).toBe('query');
    expect(db.actions[0].count).toBe(2);
  });

  it('sorts by total calls descending', () => {
    for (let i = 0; i < 5; i++) appendEntry(makeEntry({ actionType: 'mcp.a.action' }), auditPath);
    for (let i = 0; i < 10; i++) appendEntry(makeEntry({ actionType: 'mcp.b.action' }), auditPath);

    const result = computeMcpUsage(auditPath);
    expect(result[0].server).toBe('b');
    expect(result[1].server).toBe('a');
  });
});

describe('getKnownMcpServers', () => {
  it('returns unique server names sorted', () => {
    appendEntry(makeEntry({ actionType: 'mcp.github.create_issue' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.slack.send' }), auditPath);
    appendEntry(makeEntry({ actionType: 'mcp.github.list_repos' }), auditPath);
    appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);

    const result = getKnownMcpServers(auditPath);
    expect(result).toEqual(['github', 'slack']);
  });

  it('returns empty for no MCP entries', () => {
    appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);
    const result = getKnownMcpServers(auditPath);
    expect(result).toEqual([]);
  });
});
