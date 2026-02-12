import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthensorClient } from '../src/authensor.js';
import { isRetryable, getBackoffMs } from '../src/authensor.js';

let mockFetch;

function jsonResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: { get: (key) => headers[key.toLowerCase()] || null },
  };
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isRetryable', () => {
  it('retries on 429', () => {
    expect(isRetryable(null, 429)).toBe(true);
  });

  it('retries on 500', () => {
    expect(isRetryable(null, 500)).toBe(true);
  });

  it('retries on 502', () => {
    expect(isRetryable(null, 502)).toBe(true);
  });

  it('retries on 503', () => {
    expect(isRetryable(null, 503)).toBe(true);
  });

  it('does NOT retry on 400', () => {
    expect(isRetryable(null, 400)).toBe(false);
  });

  it('does NOT retry on 404', () => {
    expect(isRetryable(null, 404)).toBe(false);
  });

  it('does NOT retry on AbortError', () => {
    const err = new DOMException('aborted', 'AbortError');
    expect(isRetryable(err, null)).toBe(false);
  });

  it('retries on ECONNREFUSED network error', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    expect(isRetryable(err, null)).toBe(true);
  });

  it('retries on ETIMEDOUT network error', () => {
    const err = new Error('ETIMEDOUT');
    expect(isRetryable(err, null)).toBe(true);
  });
});

describe('getBackoffMs', () => {
  it('returns 1000ms for attempt 0 with no header', () => {
    expect(getBackoffMs(0, null)).toBe(1000);
  });

  it('returns 2000ms for attempt 1', () => {
    expect(getBackoffMs(1, null)).toBe(2000);
  });

  it('returns 4000ms for attempt 2', () => {
    expect(getBackoffMs(2, null)).toBe(4000);
  });

  it('respects Retry-After header in seconds', () => {
    expect(getBackoffMs(0, '3')).toBe(3000);
  });
});

describe('AuthensorClient retry behavior', () => {
  const client = new AuthensorClient({
    controlPlaneUrl: 'https://cp.test',
    authToken: 'tok',
  });

  it('retries 500 then succeeds on 200', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'Internal error' }, 500))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const result = await client.health();
    expect(result.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries 429 with Retry-After header', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const result = await client.health();
    expect(result.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries 2 consecutive 500s then succeeds (maxRetries=2)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'err' }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'err' }, 500))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    // Use maxRetries=2 to keep real backoff manageable (1s + 2s)
    const result = await client._fetch('/health', { maxRetries: 2 });
    expect(result.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws after exceeding max retries on 500', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'server down' }, 500));

    // Use maxRetries=1 to keep real backoff short (only 1s wait)
    await expect(
      client._fetch('/health', { maxRetries: 1 })
    ).rejects.toThrow('server down');
    // 1 initial + 1 retry = 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 (client error)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));

    await expect(client.health()).rejects.toThrow('bad request');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on network error then succeeds', async () => {
    const netErr = new Error('fetch failed');
    netErr.cause = { code: 'ECONNREFUSED' };
    mockFetch
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));

    const result = await client.health();
    expect(result.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
