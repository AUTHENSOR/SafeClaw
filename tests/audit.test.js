import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { appendEntry, readEntries, rotateLog, verifyAuditIntegrity, _resetLastHash } from '../src/audit.js';

let tmpDir;
let auditPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-audit-'));
  auditPath = path.join(tmpDir, 'audit.jsonl');
  _resetLastHash();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
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

describe('appendEntry', () => {
  it('creates audit file if missing', () => {
    appendEntry(makeEntry(), auditPath);
    expect(fs.existsSync(auditPath)).toBe(true);
  });

  it('appends valid JSONL lines', () => {
    appendEntry(makeEntry({ resource: 'cmd1' }), auditPath);
    appendEntry(makeEntry({ resource: 'cmd2' }), auditPath);
    appendEntry(makeEntry({ resource: 'cmd3' }), auditPath);

    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).resource).toBe('cmd1');
    expect(JSON.parse(lines[2]).resource).toBe('cmd3');
  });

  it('creates parent directory if missing', () => {
    const nested = path.join(tmpDir, 'sub', 'dir', 'audit.jsonl');
    appendEntry(makeEntry(), nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('adds prevHash field', () => {
    appendEntry(makeEntry(), auditPath);
    const line = fs.readFileSync(auditPath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.prevHash).toBeDefined();
  });

  it('first entry has prevHash GENESIS', () => {
    appendEntry(makeEntry(), auditPath);
    const line = fs.readFileSync(auditPath, 'utf-8').trim();
    const entry = JSON.parse(line);
    expect(entry.prevHash).toBe('GENESIS');
  });

  it('second entry prevHash is sha256 of first line', () => {
    appendEntry(makeEntry({ resource: 'first' }), auditPath);
    appendEntry(makeEntry({ resource: 'second' }), auditPath);
    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
    const secondEntry = JSON.parse(lines[1]);
    const expectedHash = sha256(lines[0]);
    expect(secondEntry.prevHash).toBe(expectedHash);
  });
});

describe('readEntries', () => {
  it('returns entries newest-first', () => {
    appendEntry(makeEntry({ resource: 'first', timestamp: '2026-01-01T00:00:00Z' }), auditPath);
    appendEntry(makeEntry({ resource: 'second', timestamp: '2026-01-02T00:00:00Z' }), auditPath);
    appendEntry(makeEntry({ resource: 'third', timestamp: '2026-01-03T00:00:00Z' }), auditPath);

    const entries = readEntries({}, auditPath);
    expect(entries[0].resource).toBe('third');
    expect(entries[2].resource).toBe('first');
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      appendEntry(makeEntry({ resource: `cmd${i}` }), auditPath);
    }
    const entries = readEntries({ limit: 3 }, auditPath);
    expect(entries.length).toBe(3);
  });

  it('filters by actionType', () => {
    appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);
    appendEntry(makeEntry({ actionType: 'filesystem.write' }), auditPath);
    appendEntry(makeEntry({ actionType: 'code.exec' }), auditPath);

    const entries = readEntries({ filter: { actionType: 'code.exec' } }, auditPath);
    expect(entries.length).toBe(2);
    expect(entries.every(e => e.actionType === 'code.exec')).toBe(true);
  });

  it('filters by outcome', () => {
    appendEntry(makeEntry({ outcome: 'allow' }), auditPath);
    appendEntry(makeEntry({ outcome: 'deny' }), auditPath);
    appendEntry(makeEntry({ outcome: 'allow' }), auditPath);

    const entries = readEntries({ filter: { outcome: 'deny' } }, auditPath);
    expect(entries.length).toBe(1);
    expect(entries[0].outcome).toBe('deny');
  });

  it('returns empty array for missing file', () => {
    const entries = readEntries({}, path.join(tmpDir, 'nonexistent.jsonl'));
    expect(entries).toEqual([]);
  });

  it('skips corrupt JSONL lines', () => {
    fs.writeFileSync(auditPath, '{"valid":true}\nNOT_JSON\n{"also":"valid"}\n');
    const entries = readEntries({}, auditPath);
    expect(entries.length).toBe(2);
  });
});

describe('rotateLog', () => {
  it('renames current file and creates fresh one', () => {
    appendEntry(makeEntry({ resource: 'old1' }), auditPath);
    appendEntry(makeEntry({ resource: 'old2' }), auditPath);

    rotateLog(auditPath);

    // New file should be empty
    const newEntries = readEntries({}, auditPath);
    expect(newEntries.length).toBe(0);

    // Backup should have old entries
    const backup = auditPath + '.1';
    expect(fs.existsSync(backup)).toBe(true);
    const backupEntries = readEntries({}, backup);
    expect(backupEntries.length).toBe(2);
  });

  it('does nothing for missing file', () => {
    rotateLog(path.join(tmpDir, 'nonexistent.jsonl'));
    // Should not throw
  });
});

describe('verifyAuditIntegrity', () => {
  it('returns valid for empty/missing file', () => {
    const result = verifyAuditIntegrity(path.join(tmpDir, 'nope.jsonl'));
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(0);
    expect(result.chainedEntries).toBe(0);
  });

  it('returns valid for properly chained entries', () => {
    appendEntry(makeEntry({ resource: 'a' }), auditPath);
    appendEntry(makeEntry({ resource: 'b' }), auditPath);
    appendEntry(makeEntry({ resource: 'c' }), auditPath);

    const result = verifyAuditIntegrity(auditPath);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
    expect(result.chainedEntries).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it('detects tampered entries', () => {
    appendEntry(makeEntry({ resource: 'a' }), auditPath);
    appendEntry(makeEntry({ resource: 'b' }), auditPath);

    // Tamper with the first line
    const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.resource = 'TAMPERED';
    lines[0] = JSON.stringify(tampered);
    fs.writeFileSync(auditPath, lines.join('\n') + '\n');

    const result = verifyAuditIntegrity(auditPath);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles pre-chain entries gracefully', () => {
    // Write entries without prevHash (pre-chain format)
    fs.writeFileSync(auditPath,
      '{"toolName":"Bash","actionType":"code.exec","resource":"ls","outcome":"allow"}\n'
    );
    _resetLastHash();
    // Now append a chained entry
    appendEntry(makeEntry({ resource: 'chained' }), auditPath);

    const result = verifyAuditIntegrity(auditPath);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(2);
    expect(result.chainedEntries).toBe(1);
  });

  it('_resetLastHash clears the cache', () => {
    appendEntry(makeEntry(), auditPath);
    _resetLastHash();
    // After reset, getLastHash will re-read from disk on next append
    // This just verifies it doesn't throw
    appendEntry(makeEntry(), auditPath);
    const result = verifyAuditIntegrity(auditPath);
    expect(result.valid).toBe(true);
  });
});
