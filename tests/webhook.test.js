import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendWebhook } from '../src/webhook.js';

let fetchCalls;
let fetchResponses;

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  // Mock global fetch
  globalThis._originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    const response = fetchResponses.shift() || { ok: true, status: 200 };
    return response;
  };
});

afterEach(() => {
  globalThis.fetch = globalThis._originalFetch;
  delete globalThis._originalFetch;
});

describe('sendWebhook', () => {
  it('returns false with no URL', async () => {
    const result = await sendWebhook('task_completed', { task: 'test' }, { url: '', events: [] });
    expect(result).toBe(false);
    expect(fetchCalls.length).toBe(0);
  });

  it('skips non-configured events', async () => {
    const result = await sendWebhook('task_completed', { task: 'test' }, {
      url: 'https://example.com/webhook',
      events: ['approval_required'],
    });
    expect(result).toBe(false);
    expect(fetchCalls.length).toBe(0);
  });

  it('sends POST to configured URL', async () => {
    fetchResponses.push({ ok: true, status: 200 });
    const result = await sendWebhook('task_completed', { task: 'test' }, {
      url: 'https://example.com/webhook',
      events: ['task_completed'],
    });
    expect(result).toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe('https://example.com/webhook');
    const body = JSON.parse(fetchCalls[0].opts.body);
    expect(body.event).toBe('task_completed');
    expect(body.data).toEqual({ task: 'test' });
  });

  it('sends Slack format for Slack URLs', async () => {
    fetchResponses.push({ ok: true, status: 200 });
    await sendWebhook('task_completed', { task: 'hi' }, {
      url: 'https://hooks.slack.com/services/xxx',
      events: ['task_completed'],
    });
    const body = JSON.parse(fetchCalls[0].opts.body);
    expect(body.text).toContain('[SafeClaw] Task completed');
    expect(body.event).toBeUndefined();
  });

  it('sends Discord format for Discord URLs', async () => {
    fetchResponses.push({ ok: true, status: 200 });
    await sendWebhook('task_failed', { error: 'boom' }, {
      url: 'https://discord.com/api/webhooks/123/abc',
      events: ['task_failed'],
    });
    const body = JSON.parse(fetchCalls[0].opts.body);
    expect(body.content).toContain('[SafeClaw] Task failed');
    expect(body.text).toBeUndefined();
  });

  it('retries on 500', async () => {
    fetchResponses.push({ ok: false, status: 500 });
    fetchResponses.push({ ok: true, status: 200 });
    const result = await sendWebhook('task_completed', { task: 'test' }, {
      url: 'https://example.com/webhook',
      events: [],
    });
    expect(result).toBe(true);
    expect(fetchCalls.length).toBe(2);
  });

  it('fails after max retries', async () => {
    fetchResponses.push({ ok: false, status: 500 });
    fetchResponses.push({ ok: false, status: 500 });
    fetchResponses.push({ ok: false, status: 500 });
    const result = await sendWebhook('task_completed', { task: 'test' }, {
      url: 'https://example.com/webhook',
      events: [],
    });
    expect(result).toBe(false);
    expect(fetchCalls.length).toBe(3); // initial + 2 retries
  });

  it('sends all events when events array is empty', async () => {
    fetchResponses.push({ ok: true, status: 200 });
    const result = await sendWebhook('approval_required', { actionType: 'code.exec', resource: 'ls' }, {
      url: 'https://example.com/webhook',
      events: [],
    });
    expect(result).toBe(true);
  });
});
