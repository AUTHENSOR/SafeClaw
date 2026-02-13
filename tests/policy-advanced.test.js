import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  savePolicy, loadPolicy, listPolicyVersions, loadPolicyVersion,
  rollbackPolicy, filterActiveRules, simulatePolicy,
} from '../src/policy.js';

// Temp dir for test policy files
const tmpDir = path.join(os.tmpdir(), 'safeclaw-policy-test-' + Date.now());
const policyFile = path.join(tmpDir, 'test-policy.json');

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  // Clean up any leftover files
  const files = fs.readdirSync(tmpDir);
  for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// --- Policy Versioning ---

describe('Policy versioning', () => {
  it('first save creates v1', () => {
    const policy = { id: 'test', name: 'Test', defaultEffect: 'deny', rules: [] };
    savePolicy(policyFile, policy);
    const loaded = loadPolicy(policyFile);
    expect(loaded.version).toBe('v1');
  });

  it('second save creates backup and bumps to v2', () => {
    const policy1 = { id: 'test', name: 'Test', defaultEffect: 'deny', rules: [{ id: 'r1' }] };
    savePolicy(policyFile, policy1);

    const policy2 = { id: 'test', name: 'Test', defaultEffect: 'deny', rules: [{ id: 'r1' }, { id: 'r2' }] };
    savePolicy(policyFile, policy2);

    const loaded = loadPolicy(policyFile);
    expect(loaded.version).toBe('v2');

    // Backup should exist
    const backupPath = policyFile + '.v1';
    expect(fs.existsSync(backupPath)).toBe(true);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    expect(backup.rules).toHaveLength(1);
  });

  it('listPolicyVersions returns sorted versions', () => {
    savePolicy(policyFile, { id: 'test', rules: [] });
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }] });
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }, { id: 'r2' }] });

    const versions = listPolicyVersions(policyFile);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    // Sorted descending
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i - 1].version).toBeGreaterThan(versions[i].version);
    }
  });

  it('loadPolicyVersion returns specific version', () => {
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }] });
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }, { id: 'r2' }] });

    const v1 = loadPolicyVersion(policyFile, 1);
    expect(v1).not.toBeNull();
    expect(v1.rules).toHaveLength(1);
  });

  it('loadPolicyVersion returns null for nonexistent version', () => {
    expect(loadPolicyVersion(policyFile, 999)).toBeNull();
  });

  it('rollbackPolicy restores previous version', () => {
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }] });
    savePolicy(policyFile, { id: 'test', rules: [{ id: 'r1' }, { id: 'r2' }] });

    const before = loadPolicy(policyFile);
    expect(before.rules).toHaveLength(2);

    const result = rollbackPolicy(policyFile, 1);
    expect(result).not.toBeNull();
    const after = loadPolicy(policyFile);
    expect(after.rules).toHaveLength(1);
  });

  it('rollbackPolicy returns null for nonexistent version', () => {
    savePolicy(policyFile, { id: 'test', rules: [] });
    expect(rollbackPolicy(policyFile, 999)).toBeNull();
  });
});

// --- filterActiveRules ---

describe('filterActiveRules', () => {
  it('returns all rules when no schedule or expiry', () => {
    const rules = [
      { id: 'r1', effect: 'allow' },
      { id: 'r2', effect: 'deny' },
    ];
    expect(filterActiveRules(rules)).toHaveLength(2);
  });

  it('filters expired rules', () => {
    const rules = [
      { id: 'active', effect: 'allow' },
      { id: 'expired', effect: 'deny', expiresAt: '2020-01-01T00:00:00Z' },
    ];
    const result = filterActiveRules(rules);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('active');
  });

  it('keeps non-expired rules', () => {
    const rules = [
      { id: 'future', effect: 'allow', expiresAt: '2099-01-01T00:00:00Z' },
    ];
    expect(filterActiveRules(rules)).toHaveLength(1);
  });

  it('filters by UTC hour window', () => {
    const rules = [
      { id: 'business', effect: 'allow', schedule: { hoursUtc: [9, 17] } },
    ];

    // During business hours (noon UTC)
    const noon = new Date('2026-02-10T12:00:00Z');
    expect(filterActiveRules(rules, noon)).toHaveLength(1);

    // Outside business hours (3am UTC)
    const earlyMorning = new Date('2026-02-10T03:00:00Z');
    expect(filterActiveRules(rules, earlyMorning)).toHaveLength(0);
  });

  it('filters by day of week', () => {
    const rules = [
      { id: 'weekday', effect: 'allow', schedule: { daysOfWeek: [1, 2, 3, 4, 5] } },
    ];

    // Tuesday (day 2)
    const tuesday = new Date('2026-02-10T12:00:00Z'); // Feb 10 2026 is a Tuesday
    expect(filterActiveRules(rules, tuesday)).toHaveLength(1);

    // Sunday (day 0) -Feb 15 2026 is a Sunday
    const sunday = new Date('2026-02-15T12:00:00Z');
    expect(filterActiveRules(rules, sunday)).toHaveLength(0);
  });

  it('returns empty array for null/undefined input', () => {
    expect(filterActiveRules(null)).toEqual([]);
    expect(filterActiveRules(undefined)).toEqual([]);
  });
});

// --- simulatePolicy ---

describe('simulatePolicy', () => {
  const policy = {
    id: 'test',
    defaultEffect: 'deny',
    rules: [
      {
        id: 'allow-reads',
        effect: 'allow',
        description: 'Allow safe reads',
        condition: { any: [{ field: 'action.type', operator: 'startsWith', value: 'safe.read' }] },
      },
      {
        id: 'deny-secrets',
        effect: 'deny',
        description: 'Block secret access',
        condition: { any: [{ field: 'action.resource', operator: 'contains', value: '/etc/passwd' }] },
      },
      {
        id: 'approve-writes',
        effect: 'require_approval',
        description: 'Require approval for writes',
        condition: { any: [{ field: 'action.type', operator: 'eq', value: 'filesystem.write' }] },
      },
    ],
  };

  it('matches startsWith rule', () => {
    const result = simulatePolicy(policy, 'safe.read.file', '/tmp/foo.txt');
    expect(result.effect).toBe('allow');
    expect(result.matchedRule.id).toBe('allow-reads');
  });

  it('matches contains rule on resource', () => {
    const result = simulatePolicy(policy, 'filesystem.read', '/etc/passwd');
    expect(result.effect).toBe('deny');
    expect(result.matchedRule.id).toBe('deny-secrets');
  });

  it('matches eq rule', () => {
    const result = simulatePolicy(policy, 'filesystem.write', '/tmp/output.txt');
    expect(result.effect).toBe('require_approval');
    expect(result.matchedRule.id).toBe('approve-writes');
  });

  it('returns defaultEffect when no rules match', () => {
    const result = simulatePolicy(policy, 'unknown.action', '/foo');
    expect(result.effect).toBe('deny');
    expect(result.matchedRule).toBeNull();
    expect(result.reason).toContain('default');
  });

  it('handles null policy', () => {
    const result = simulatePolicy(null, 'test', '/foo');
    expect(result.effect).toBe('deny');
  });

  it('handles condition with all predicates', () => {
    const policyAll = {
      defaultEffect: 'deny',
      rules: [{
        id: 'all-match',
        effect: 'allow',
        condition: {
          all: [
            { field: 'action.type', operator: 'startsWith', value: 'filesystem' },
            { field: 'action.resource', operator: 'startsWith', value: '/tmp/' },
          ],
        },
      }],
    };
    const result = simulatePolicy(policyAll, 'filesystem.write', '/tmp/file.txt');
    expect(result.effect).toBe('allow');

    const miss = simulatePolicy(policyAll, 'filesystem.write', '/etc/config');
    expect(miss.effect).toBe('deny');
  });

  it('handles matches operator (regex)', () => {
    const policyRegex = {
      defaultEffect: 'deny',
      rules: [{
        id: 'regex-test',
        effect: 'allow',
        condition: { any: [{ field: 'action.type', operator: 'matches', value: '^safe\\.read' }] },
      }],
    };
    expect(simulatePolicy(policyRegex, 'safe.read.file', '').effect).toBe('allow');
    expect(simulatePolicy(policyRegex, 'unsafe.read', '').effect).toBe('deny');
  });
});
