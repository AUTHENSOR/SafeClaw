import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { estimateOpenAICost, getCurrentSpend, checkBudget } from '../src/budget.js';

// --- estimateOpenAICost ---

describe('estimateOpenAICost', () => {
  it('calculates gpt-4o cost', () => {
    const cost = estimateOpenAICost({ prompt_tokens: 1000, completion_tokens: 500 }, 'gpt-4o');
    // 1000/1M * 2.50 + 500/1M * 10.00 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('calculates gpt-4o-mini cost', () => {
    const cost = estimateOpenAICost({ prompt_tokens: 10000, completion_tokens: 5000 }, 'gpt-4o-mini');
    // 10000/1M * 0.15 + 5000/1M * 0.60 = 0.0015 + 0.003 = 0.0045
    expect(cost).toBeCloseTo(0.0045, 6);
  });

  it('falls back to gpt-4o pricing for unknown model', () => {
    const cost = estimateOpenAICost({ prompt_tokens: 1000, completion_tokens: 500 }, 'gpt-5-turbo');
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('returns 0 for null usage', () => {
    expect(estimateOpenAICost(null, 'gpt-4o')).toBe(0);
  });

  it('handles zero tokens', () => {
    expect(estimateOpenAICost({ prompt_tokens: 0, completion_tokens: 0 }, 'gpt-4o')).toBe(0);
  });
});

// --- getCurrentSpend + checkBudget ---

describe('getCurrentSpend', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
  });

  function writeSession(id, cost, startedAt) {
    const session = { id, cost, startedAt, status: 'success' };
    fs.writeFileSync(path.join(tmpDir, `${id}.json`), JSON.stringify(session));
  }

  it('returns 0 for no sessions', () => {
    // Mock settings to provide budget config
    vi.stubEnv('HOME', tmpDir);
    const result = getCurrentSpend(tmpDir);
    expect(result.totalUsd).toBe(0);
    vi.unstubAllEnvs();
  });

  it('sums costs from sessions in current period', () => {
    const now = new Date();
    writeSession('s1', 0.05, now.toISOString());
    writeSession('s2', 0.10, now.toISOString());
    const result = getCurrentSpend(tmpDir);
    expect(result.totalUsd).toBeCloseTo(0.15, 4);
  });

  it('ignores sessions outside the period', () => {
    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 30);
    writeSession('s1', 0.05, now.toISOString());
    writeSession('s2', 10.00, old.toISOString());
    const result = getCurrentSpend(tmpDir);
    expect(result.totalUsd).toBeCloseTo(0.05, 4);
  });

  it('ignores sessions with no cost', () => {
    const now = new Date();
    writeSession('s1', null, now.toISOString());
    writeSession('s2', 0.03, now.toISOString());
    const result = getCurrentSpend(tmpDir);
    expect(result.totalUsd).toBeCloseTo(0.03, 4);
  });
});

describe('checkBudget', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-check-'));
  });

  it('returns not exceeded when disabled', () => {
    const result = checkBudget(tmpDir, { costBudget: { enabled: false } });
    expect(result.exceeded).toBe(false);
    expect(result.enabled).toBe(false);
  });

  it('returns not exceeded when under limit', () => {
    const now = new Date();
    fs.writeFileSync(
      path.join(tmpDir, 's1.json'),
      JSON.stringify({ id: 's1', cost: 0.50, startedAt: now.toISOString(), status: 'success' })
    );
    const result = checkBudget(tmpDir, {
      costBudget: { enabled: true, limitUsd: 10.00, period: 'daily', action: 'warn' },
    });
    expect(result.exceeded).toBe(false);
    expect(result.currentUsd).toBeCloseTo(0.50, 4);
    expect(result.limitUsd).toBe(10.00);
    expect(result.percentUsed).toBeCloseTo(5, 0);
    expect(result.enabled).toBe(true);
  });

  it('returns exceeded when over limit', () => {
    const now = new Date();
    fs.writeFileSync(
      path.join(tmpDir, 's1.json'),
      JSON.stringify({ id: 's1', cost: 15.00, startedAt: now.toISOString(), status: 'success' })
    );
    const result = checkBudget(tmpDir, {
      costBudget: { enabled: true, limitUsd: 10.00, period: 'daily', action: 'block' },
    });
    expect(result.exceeded).toBe(true);
    expect(result.action).toBe('block');
    expect(result.percentUsed).toBe(100);
  });

  it('returns correct percentUsed', () => {
    const now = new Date();
    fs.writeFileSync(
      path.join(tmpDir, 's1.json'),
      JSON.stringify({ id: 's1', cost: 7.50, startedAt: now.toISOString(), status: 'success' })
    );
    const result = checkBudget(tmpDir, {
      costBudget: { enabled: true, limitUsd: 10.00, period: 'daily', action: 'warn' },
    });
    expect(result.percentUsed).toBeCloseTo(75, 0);
  });
});
