import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, enforceRateLimit, resetRateLimits } from '../src/rate-limit.js';

beforeEach(() => {
  resetRateLimits();
});

describe('checkRateLimit', () => {
  it('allows requests within limit', () => {
    const r = checkRateLimit('test', 3, 60000);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('denies requests exceeding limit', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('test', 3, 60000);
    const r = checkRateLimit('test', 3, 60000);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('returns correct remaining count', () => {
    checkRateLimit('test', 5, 60000);
    checkRateLimit('test', 5, 60000);
    const r = checkRateLimit('test', 5, 60000);
    expect(r.remaining).toBe(2);
  });

  it('returns retryAfterMs when exceeded', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('test', 3, 60000);
    const r = checkRateLimit('test', 3, 60000);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  it('resets after window passes', async () => {
    // Use a 50ms window for fast test
    for (let i = 0; i < 3; i++) checkRateLimit('test', 3, 50);
    const r1 = checkRateLimit('test', 3, 50);
    expect(r1.allowed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 60));

    const r2 = checkRateLimit('test', 3, 50);
    expect(r2.allowed).toBe(true);
  });

  it('separates keys independently', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('a', 3, 60000);
    expect(checkRateLimit('a', 3, 60000).allowed).toBe(false);
    expect(checkRateLimit('b', 3, 60000).allowed).toBe(true);
  });
});

describe('resetRateLimits', () => {
  it('clears all state', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('test', 3, 60000);
    expect(checkRateLimit('test', 3, 60000).allowed).toBe(false);
    resetRateLimits();
    expect(checkRateLimit('test', 3, 60000).allowed).toBe(true);
  });
});

describe('enforceRateLimit', () => {
  it('sends 429 when exceeded', () => {
    const headers = {};
    let statusCode = 0;
    let body = '';
    const res = {
      writeHead(code, h) { statusCode = code; Object.assign(headers, h); },
      end(data) { body = data; },
    };

    for (let i = 0; i < 3; i++) checkRateLimit('enforce-test', 3, 60000);
    const exceeded = enforceRateLimit(res, 'enforce-test', 3, 60000);
    expect(exceeded).toBe(true);
    expect(statusCode).toBe(429);
    expect(headers['Retry-After']).toBeDefined();
    const parsed = JSON.parse(body);
    expect(parsed.error).toBe('Rate limit exceeded');
  });

  it('returns false when within limit', () => {
    const res = { writeHead() {}, end() {} };
    const exceeded = enforceRateLimit(res, 'ok-test', 10, 60000);
    expect(exceeded).toBe(false);
  });
});
