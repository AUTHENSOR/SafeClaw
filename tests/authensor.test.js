import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthensorClient } from '../src/authensor.js';

// Mock global fetch
let mockFetch;

function jsonResponse(data, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: { get: (key) => headers[key.toLowerCase()] || null },
  };
}

function errorResponse(msg, status = 400) {
  return jsonResponse({ error: msg }, status);
}

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthensorClient', () => {
  const client = new AuthensorClient({
    controlPlaneUrl: 'https://cp.test',
    authToken: 'test-token',
  });

  it('sets auth header on requests', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await client.health();

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });

  it('health() calls GET /health', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: 'ok' }));
    const result = await client.health();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/health');
    expect(result.status).toBe('ok');
  });

  it('evaluate() POSTs envelope', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ outcome: 'allow', receiptId: 'r1' }));
    const envelope = { action: { type: 'code.exec', resource: 'ls' } };
    const result = await client.evaluate(envelope);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/evaluate');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual(envelope);
    expect(result.outcome).toBe('allow');
  });

  it('getReceipt() calls GET /receipts/:id', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 'r1', status: 'approved' }));
    const result = await client.getReceipt('r1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/receipts/r1');
    expect(result.status).toBe('approved');
  });

  it('resolveApproval() PATCHes receipt', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await client.resolveApproval('r1', 'approved');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/receipts/r1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body).status).toBe('approved');
  });

  it('createPolicy() POSTs to /policies', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ policyId: 'p1', version: 'v1' }));
    const policy = { id: 'test', version: 'v1', rules: [] };
    const result = await client.createPolicy(policy);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/policies');
    expect(opts.method).toBe('POST');
    expect(result.policyId).toBe('p1');
  });

  it('provisionDemo() POSTs to /provision/demo', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'demo-tok', expiresAt: '2025-01-01' }));
    const result = await client.provisionDemo('install-1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://cp.test/provision/demo');
    expect(opts.method).toBe('POST');
    expect(result.token).toBe('demo-tok');
  });

  it('provisionDemo() returns null on 404', async () => {
    mockFetch.mockResolvedValue(errorResponse('HTTP 404: Not Found', 404));
    const result = await client.provisionDemo('install-1');
    expect(result).toBe(null);
  });

  it('throws on HTTP error with message', async () => {
    mockFetch.mockResolvedValue(errorResponse('Bad request', 400));
    await expect(client.health()).rejects.toThrow('Bad request');
  });

  it('extracts nested error message', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: { message: 'nested msg', code: 'ERR' } }, 422));
    await expect(client.health()).rejects.toThrow('nested msg');
  });

  it('strips trailing slash from controlPlaneUrl', () => {
    const c = new AuthensorClient({ controlPlaneUrl: 'https://cp.test/' });
    // Verify by checking it can build URLs correctly (no double slash)
    expect(c.baseUrl).toBe('https://cp.test');
  });
});
