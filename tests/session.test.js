import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveSession, loadSession, listSessions } from '../src/session.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-session-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSession(overrides = {}) {
  return {
    id: `task_${Date.now()}_abc`,
    task: 'Test task',
    provider: 'claude',
    model: '',
    profile: 'default',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'success',
    cost: null,
    error: null,
    messages: [{ type: 'text', text: 'Hello', timestamp: new Date().toISOString() }],
    toolCalls: [{ toolName: 'Read', inputSummary: '/foo.js', timestamp: new Date().toISOString() }],
    ...overrides,
  };
}

describe('saveSession', () => {
  it('writes a session JSON file', () => {
    const session = makeSession({ id: 'task_001' });
    saveSession(session, tmpDir);

    const filePath = path.join(tmpDir, 'task_001.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(saved.id).toBe('task_001');
    expect(saved.task).toBe('Test task');
  });

  it('auto-creates sessions directory', () => {
    const nested = path.join(tmpDir, 'sub', 'sessions');
    const session = makeSession({ id: 'task_002' });
    saveSession(session, nested);
    expect(fs.existsSync(path.join(nested, 'task_002.json'))).toBe(true);
  });

  it('caps messages at 200', () => {
    const messages = Array.from({ length: 300 }, (_, i) => ({
      type: 'text', text: `msg${i}`, timestamp: new Date().toISOString(),
    }));
    const session = makeSession({ id: 'task_cap', messages });
    saveSession(session, tmpDir);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'task_cap.json'), 'utf-8'));
    expect(saved.messages.length).toBe(200);
  });
});

describe('loadSession', () => {
  it('reads and parses a saved session', () => {
    const session = makeSession({ id: 'task_load' });
    saveSession(session, tmpDir);

    const loaded = loadSession('task_load', tmpDir);
    expect(loaded.id).toBe('task_load');
    expect(loaded.task).toBe('Test task');
    expect(loaded.messages.length).toBe(1);
  });

  it('returns null for missing session', () => {
    expect(loadSession('nonexistent', tmpDir)).toBe(null);
  });
});

describe('listSessions', () => {
  it('returns sessions sorted newest-first', () => {
    // Save sessions with slight delays to ensure different mtimes
    saveSession(makeSession({ id: 'task_old', startedAt: '2026-01-01T00:00:00Z' }), tmpDir);
    saveSession(makeSession({ id: 'task_new', startedAt: '2026-01-03T00:00:00Z' }), tmpDir);

    const sessions = listSessions({}, tmpDir);
    expect(sessions.length).toBe(2);
    // Newest by mtime should be last written
    expect(sessions[0].id).toBe('task_new');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      saveSession(makeSession({ id: `task_lim_${i}` }), tmpDir);
    }
    const sessions = listSessions({ limit: 2 }, tmpDir);
    expect(sessions.length).toBe(2);
  });

  it('returns empty for missing directory', () => {
    const sessions = listSessions({}, path.join(tmpDir, 'nonexistent'));
    expect(sessions).toEqual([]);
  });

  it('returns summaries without messages/toolCalls', () => {
    saveSession(makeSession({ id: 'task_summary' }), tmpDir);
    const sessions = listSessions({}, tmpDir);
    expect(sessions[0].id).toBe('task_summary');
    expect(sessions[0].messages).toBeUndefined();
    expect(sessions[0].toolCalls).toBeUndefined();
  });
});
