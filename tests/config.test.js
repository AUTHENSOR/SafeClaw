import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { ensureProfile, getProfile, setActiveProfile, expandHome, defaultPolicyPath } from '../src/config.js';

describe('expandHome', () => {
  it('expands ~/path to home directory', () => {
    const result = expandHome('~/documents');
    expect(result).toBe(path.join(os.homedir(), 'documents'));
  });

  it('returns absolute paths unchanged', () => {
    expect(expandHome('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('returns null/undefined unchanged', () => {
    expect(expandHome(null)).toBe(null);
    expect(expandHome(undefined)).toBe(undefined);
  });

  it('returns empty string unchanged', () => {
    expect(expandHome('')).toBe('');
  });
});

describe('defaultPolicyPath', () => {
  it('returns path under policies directory', () => {
    const result = defaultPolicyPath('myprofile');
    expect(result).toContain('myprofile.json');
    expect(result).toContain('.safeclaw');
    expect(result).toContain('policies');
  });
});

describe('ensureProfile', () => {
  it('creates a new profile with correct defaults', () => {
    const cfg = { profiles: {} };
    const profile = ensureProfile(cfg, 'test');

    expect(profile.installId).toBeDefined();
    expect(profile.installId.length).toBeGreaterThan(10);
    expect(profile.controlPlane).toBe('https://authensor-api-production.up.railway.app');
    expect(profile.authToken).toBe('');
    expect(profile.provider.name).toBe('claude');
    expect(profile.provider.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(profile.policy.path).toContain('test.json');
  });

  it('does not overwrite an existing profile', () => {
    const cfg = {
      profiles: {
        test: { installId: 'keep-me', authToken: 'tok', controlPlane: 'https://cp.test', provider: { name: 'claude', apiKeyEnv: 'KEY' }, policy: { path: '/p', id: '' } }
      }
    };
    const profile = ensureProfile(cfg, 'test');
    expect(profile.installId).toBe('keep-me');
    expect(profile.authToken).toBe('tok');
  });

  it('sets activeProfile if not already set', () => {
    const cfg = { profiles: {} };
    ensureProfile(cfg, 'myprof');
    expect(cfg.activeProfile).toBe('myprof');
  });

  it('does not overwrite existing activeProfile', () => {
    const cfg = { activeProfile: 'existing', profiles: {} };
    ensureProfile(cfg, 'new');
    expect(cfg.activeProfile).toBe('existing');
  });
});

describe('getProfile', () => {
  const cfg = {
    activeProfile: 'default',
    profiles: {
      default: { installId: 'id1', authToken: 'tok1' },
      other: { installId: 'id2', authToken: 'tok2' },
    }
  };

  it('returns active profile when no name given', () => {
    const result = getProfile(cfg);
    expect(result.name).toBe('default');
    expect(result.profile.installId).toBe('id1');
  });

  it('returns named profile', () => {
    const result = getProfile(cfg, 'other');
    expect(result.name).toBe('other');
    expect(result.profile.installId).toBe('id2');
  });

  it('returns null for missing profile', () => {
    expect(getProfile(cfg, 'nonexistent')).toBe(null);
  });

  it('returns null for empty config', () => {
    expect(getProfile({ profiles: {} }, 'test')).toBe(null);
  });
});

describe('setActiveProfile', () => {
  it('sets the activeProfile field', () => {
    const cfg = { activeProfile: 'old' };
    setActiveProfile(cfg, 'new');
    expect(cfg.activeProfile).toBe('new');
  });
});
