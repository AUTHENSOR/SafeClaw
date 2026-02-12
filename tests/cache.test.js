import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cacheDecision, getCachedDecision, clearCache, _resetMemCache } from '../src/cache.js';

let tmpDir;
let cachePath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-cache-'));
  cachePath = path.join(tmpDir, 'decision-cache.json');
  _resetMemCache();
});

afterEach(() => {
  _resetMemCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cacheDecision + getCachedDecision', () => {
  it('stores and retrieves allow decisions', () => {
    cacheDecision('code.exec', 'ls', 'allow', 3600, cachePath);
    const result = getCachedDecision('code.exec', 'ls', cachePath);
    expect(result).toEqual({ outcome: 'allow' });
  });

  it('returns null for missing keys', () => {
    const result = getCachedDecision('code.exec', 'ls', cachePath);
    expect(result).toBeNull();
  });

  it('returns null for expired entries', () => {
    cacheDecision('code.exec', 'ls', 'allow', -1, cachePath); // already expired
    const result = getCachedDecision('code.exec', 'ls', cachePath);
    expect(result).toBeNull();
  });

  it('does not cache deny outcomes', () => {
    cacheDecision('code.exec', 'rm -rf /', 'deny', 3600, cachePath);
    const result = getCachedDecision('code.exec', 'rm -rf /', cachePath);
    expect(result).toBeNull();
  });

  it('does not cache require_approval outcomes', () => {
    cacheDecision('code.exec', 'deploy', 'require_approval', 3600, cachePath);
    const result = getCachedDecision('code.exec', 'deploy', cachePath);
    expect(result).toBeNull();
  });

  it('separates keys by actionType and resource', () => {
    cacheDecision('code.exec', 'ls', 'allow', 3600, cachePath);
    cacheDecision('filesystem.write', '/tmp/x', 'allow', 3600, cachePath);

    expect(getCachedDecision('code.exec', 'ls', cachePath)).toEqual({ outcome: 'allow' });
    expect(getCachedDecision('filesystem.write', '/tmp/x', cachePath)).toEqual({ outcome: 'allow' });
    expect(getCachedDecision('code.exec', '/tmp/x', cachePath)).toBeNull();
  });

  it('persists to disk and survives memory reset', () => {
    cacheDecision('code.exec', 'ls', 'allow', 3600, cachePath);
    _resetMemCache(); // force reload from disk
    const result = getCachedDecision('code.exec', 'ls', cachePath);
    expect(result).toEqual({ outcome: 'allow' });
  });

  it('prunes expired entries on disk reload', () => {
    cacheDecision('code.exec', 'ls', 'allow', -1, cachePath); // expired
    cacheDecision('code.exec', 'cat', 'allow', 3600, cachePath); // valid
    _resetMemCache();
    expect(getCachedDecision('code.exec', 'ls', cachePath)).toBeNull();
    expect(getCachedDecision('code.exec', 'cat', cachePath)).toEqual({ outcome: 'allow' });
  });
});

describe('clearCache', () => {
  it('removes all cached decisions and disk file', () => {
    cacheDecision('code.exec', 'ls', 'allow', 3600, cachePath);
    clearCache(cachePath);
    expect(getCachedDecision('code.exec', 'ls', cachePath)).toBeNull();
    expect(fs.existsSync(cachePath)).toBe(false);
  });
});
