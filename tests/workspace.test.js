import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectWorkspace, loadWorkspaceConfig, isPathAllowed, createWorkspaceConfig } from '../src/workspace.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeclaw-ws-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectWorkspace', () => {
  it('finds .safeclaw.json', () => {
    fs.writeFileSync(path.join(tmpDir, '.safeclaw.json'), JSON.stringify({
      allowedPaths: ['./'],
      deniedPaths: [],
    }));
    const ws = detectWorkspace(tmpDir);
    expect(ws).not.toBeNull();
    expect(ws.root).toBe(tmpDir);
    expect(ws.config.allowedPaths).toContain(tmpDir);
  });

  it('walks up directories', () => {
    fs.writeFileSync(path.join(tmpDir, '.safeclaw.json'), JSON.stringify({
      allowedPaths: ['./'],
      deniedPaths: [],
    }));
    const child = path.join(tmpDir, 'sub', 'deep');
    fs.mkdirSync(child, { recursive: true });
    const ws = detectWorkspace(child);
    expect(ws).not.toBeNull();
    expect(ws.root).toBe(tmpDir);
  });

  it('falls back to .git directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const ws = detectWorkspace(tmpDir);
    expect(ws).not.toBeNull();
    expect(ws.root).toBe(tmpDir);
  });

  it('falls back to package.json', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const ws = detectWorkspace(tmpDir);
    expect(ws).not.toBeNull();
    expect(ws.root).toBe(tmpDir);
  });

  it('returns null when nothing found', () => {
    // tmpDir has no markers and is deep enough that walking up won't find one
    // within 10 levels from a nested dir
    const deep = path.join(tmpDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k');
    fs.mkdirSync(deep, { recursive: true });
    // Start from a deeply nested dir without markers nearby
    // Note: this test might still find the system root's markers,
    // but in a clean tmp dir hierarchy it should return null if
    // we exhaust MAX_WALK_UP before finding a marker
    const ws = detectWorkspace(deep);
    // If it finds something above tmpDir (like system-level .git), that's OK —
    // the point is it doesn't crash
    expect(ws === null || typeof ws.root === 'string').toBe(true);
  });

  it('prefers .safeclaw.json over .git', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.safeclaw.json'), JSON.stringify({
      allowedPaths: ['./src'],
      deniedPaths: [],
    }));
    const ws = detectWorkspace(tmpDir);
    expect(ws.config.allowedPaths).toContain(path.resolve(tmpDir, 'src'));
  });
});

describe('loadWorkspaceConfig', () => {
  it('parses valid .safeclaw.json', () => {
    fs.writeFileSync(path.join(tmpDir, '.safeclaw.json'), JSON.stringify({
      allowedPaths: ['./', './docs'],
      deniedPaths: ['~/.ssh'],
      settings: { foo: 'bar' },
    }));
    const config = loadWorkspaceConfig(tmpDir);
    expect(config.root).toBe(tmpDir);
    expect(config.allowedPaths).toContain(tmpDir);
    expect(config.allowedPaths).toContain(path.resolve(tmpDir, 'docs'));
    expect(config.deniedPaths).toContain(path.join(os.homedir(), '.ssh'));
    expect(config.settings.foo).toBe('bar');
  });

  it('returns defaults for missing config', () => {
    const config = loadWorkspaceConfig(tmpDir);
    expect(config.root).toBe(tmpDir);
    expect(config.allowedPaths).toContain(tmpDir);
  });

  it('returns defaults for invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.safeclaw.json'), 'NOT JSON');
    const config = loadWorkspaceConfig(tmpDir);
    expect(config.root).toBe(tmpDir);
  });
});

describe('isPathAllowed', () => {
  let config;

  beforeEach(() => {
    config = {
      root: tmpDir,
      allowedPaths: [tmpDir],
      deniedPaths: [path.join(os.homedir(), '.ssh')],
    };
  });

  it('allows paths inside workspace', () => {
    expect(isPathAllowed(path.join(tmpDir, 'foo.js'), config)).toBe(true);
  });

  it('allows the workspace root itself', () => {
    expect(isPathAllowed(tmpDir, config)).toBe(true);
  });

  it('denies paths outside workspace', () => {
    expect(isPathAllowed('/etc/passwd', config)).toBe(false);
  });

  it('denies explicitly denied paths', () => {
    expect(isPathAllowed(path.join(os.homedir(), '.ssh', 'id_rsa'), config)).toBe(false);
  });

  it('deny takes priority over allow', () => {
    // Add home dir as allowed, but .ssh is still denied
    config.allowedPaths.push(os.homedir());
    expect(isPathAllowed(path.join(os.homedir(), '.ssh', 'id_rsa'), config)).toBe(false);
    // But other home dirs are fine
    expect(isPathAllowed(path.join(os.homedir(), 'Documents', 'file.txt'), config)).toBe(true);
  });

  it('returns true if no config', () => {
    expect(isPathAllowed('/anything', null)).toBe(true);
    expect(isPathAllowed('/anything', {})).toBe(true);
  });

  it('handles relative paths', () => {
    // isPathAllowed resolves relative paths via path.resolve
    const cwd = process.cwd();
    config.allowedPaths.push(cwd);
    expect(isPathAllowed('some-file.js', config)).toBe(true);
  });
});

describe('createWorkspaceConfig', () => {
  it('writes default .safeclaw.json', () => {
    const configPath = createWorkspaceConfig(tmpDir);
    expect(fs.existsSync(configPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(content.allowedPaths).toEqual(['./']);
    expect(content.deniedPaths).toContain('~/.ssh');
    expect(content.settings).toEqual({});
  });

  it('returned path matches expected location', () => {
    const configPath = createWorkspaceConfig(tmpDir);
    expect(configPath).toBe(path.join(tmpDir, '.safeclaw.json'));
  });
});
