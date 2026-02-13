import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSettings, saveSettings, validateSettings } from '../src/settings.js';

let tmpDir;
let settingsPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-settings-'));
  settingsPath = path.join(tmpDir, 'settings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('returns defaults when no file exists', () => {
    const s = loadSettings(settingsPath);
    expect(s.approvalTimeoutSeconds).toBe(300);
    expect(s.theme).toBe('auto');
    expect(s.offlineCacheEnabled).toBe(false);
  });

  it('merges defaults for missing keys', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ theme: 'dark' }));
    const s = loadSettings(settingsPath);
    expect(s.theme).toBe('dark');
    expect(s.approvalTimeoutSeconds).toBe(300);
    expect(s.costTrackingEnabled).toBe(true);
  });

  it('deep merges nested objects', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      notifyChannels: { sms: false },
    }));
    const s = loadSettings(settingsPath);
    expect(s.notifyChannels.sms).toBe(false);
    expect(s.notifyChannels.webhook.url).toBe('');
  });

  it('returns defaults for invalid JSON', () => {
    fs.writeFileSync(settingsPath, 'NOT JSON');
    const s = loadSettings(settingsPath);
    expect(s.approvalTimeoutSeconds).toBe(300);
  });
});

describe('saveSettings', () => {
  it('writes valid JSON and can be re-loaded', () => {
    const settings = { approvalTimeoutSeconds: 60, theme: 'light' };
    saveSettings(settings, settingsPath);
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(raw.approvalTimeoutSeconds).toBe(60);
    expect(raw.theme).toBe('light');
  });

  it('creates directory if missing', () => {
    const nested = path.join(tmpDir, 'sub', 'dir', 'settings.json');
    saveSettings({ theme: 'dark' }, nested);
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe('validateSettings', () => {
  function validSettings() {
    return {
      approvalTimeoutSeconds: 300,
      auditRetentionDays: 90,
      costTrackingEnabled: true,
      offlineCacheEnabled: false,
      offlineCacheTtlSeconds: 300,
      theme: 'auto',
      notifyChannels: { sms: true, webhook: { url: '', events: [] } },
    };
  }

  it('accepts valid settings', () => {
    const result = validateSettings(validSettings());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-numeric timeout', () => {
    const s = { ...validSettings(), approvalTimeoutSeconds: 'abc' };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('rejects timeout out of range', () => {
    const s = { ...validSettings(), approvalTimeoutSeconds: 5 };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('rejects invalid theme', () => {
    const s = { ...validSettings(), theme: 'neon' };
    expect(validateSettings(s).valid).toBe(false);
  });

  it('rejects invalid webhook URL', () => {
    const s = validSettings();
    s.notifyChannels.webhook.url = 'ftp://bad';
    expect(validateSettings(s).valid).toBe(false);
  });

  it('accepts valid webhook URL', () => {
    const s = validSettings();
    s.notifyChannels.webhook.url = 'https://hooks.slack.com/test';
    expect(validateSettings(s).valid).toBe(true);
  });

  it('rejects unknown webhook events', () => {
    const s = validSettings();
    s.notifyChannels.webhook.events = ['approval_required', 'bogus'];
    expect(validateSettings(s).valid).toBe(false);
  });

  it('rejects cache TTL out of range', () => {
    const s = { ...validSettings(), offlineCacheTtlSeconds: 10 };
    expect(validateSettings(s).valid).toBe(false);
  });
});
