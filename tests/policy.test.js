import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensurePolicyFile, loadPolicy, policyHelp } from '../src/policy.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ensurePolicyFile', () => {
  it('creates default policy file when missing', () => {
    const policyPath = path.join(tmpDir, 'policy.json');
    ensurePolicyFile(policyPath);
    expect(fs.existsSync(policyPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
    expect(content.id).toBe('safeclaw-default');
    expect(content.defaultEffect).toBe('deny');
  });

  it('does not overwrite existing policy file', () => {
    const policyPath = path.join(tmpDir, 'policy.json');
    fs.writeFileSync(policyPath, JSON.stringify({ id: 'custom', version: 'v1' }));

    ensurePolicyFile(policyPath);

    const content = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
    expect(content.id).toBe('custom');
  });

  it('handles path with expandHome', () => {
    // ensurePolicyFile resolves ~/... paths via expandHome
    // Test with a real absolute path (no ~ expansion needed)
    const policyPath = path.join(tmpDir, 'expanded.json');
    ensurePolicyFile(policyPath);
    expect(fs.existsSync(policyPath)).toBe(true);
  });
});

describe('loadPolicy', () => {
  it('loads and parses a JSON policy file', () => {
    const policyPath = path.join(tmpDir, 'test.json');
    fs.writeFileSync(policyPath, JSON.stringify({ id: 'test', version: 'v1' }));

    const policy = loadPolicy(policyPath);
    expect(policy.id).toBe('test');
    expect(policy.version).toBe('v1');
  });
});

describe('policyHelp', () => {
  it('returns a non-empty help string', () => {
    const help = policyHelp();
    expect(typeof help).toBe('string');
    expect(help.length).toBeGreaterThan(0);
  });
});
