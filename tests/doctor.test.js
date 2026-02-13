import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDiagnostics } from '../src/doctor.js';

// Doctor tests -note these test real system state, so results will vary.
// We verify the shape and basic logic of the checks.

describe('runDiagnostics', () => {
  it('returns an array of checks', async () => {
    const checks = await runDiagnostics();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBe(10);
  }, 15000);

  it('each check has name, status, and message', async () => {
    const checks = await runDiagnostics();
    for (const check of checks) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('message');
      expect(['ok', 'warn', 'fail']).toContain(check.status);
    }
  });

  it('Node version check passes for current runtime', async () => {
    const checks = await runDiagnostics();
    const nodeCheck = checks.find(c => c.name === 'Node.js version');
    expect(nodeCheck).toBeDefined();
    // We're running on Node >= 20 (package.json requires it)
    expect(nodeCheck.status).toBe('ok');
  });

  it('config directory check matches existence', async () => {
    const checks = await runDiagnostics();
    const dirCheck = checks.find(c => c.name === 'Config directory');
    expect(dirCheck).toBeDefined();
    const configDir = path.join(os.homedir(), '.safeclaw');
    if (fs.existsSync(configDir)) {
      expect(dirCheck.status).toBe('ok');
    } else {
      expect(dirCheck.status).toBe('fail');
    }
  });

  it('returns container runtime as warn when not found', async () => {
    const checks = await runDiagnostics();
    const containerCheck = checks.find(c => c.name === 'Container runtime');
    expect(containerCheck).toBeDefined();
    // Status can be 'ok' (if docker/podman installed) or 'warn' (not found)
    expect(['ok', 'warn']).toContain(containerCheck.status);
  });

  it('settings check returns ok or warn', async () => {
    const checks = await runDiagnostics();
    const settingsCheck = checks.find(c => c.name === 'Settings');
    expect(settingsCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(settingsCheck.status);
  });

  it('audit log check returns ok or warn or fail', async () => {
    const checks = await runDiagnostics();
    const auditCheck = checks.find(c => c.name === 'Audit log');
    expect(auditCheck).toBeDefined();
    expect(['ok', 'warn', 'fail']).toContain(auditCheck.status);
  });

  it('API key check uses correct env var', async () => {
    const checks = await runDiagnostics();
    const keyCheck = checks.find(c => c.name === 'API key');
    expect(keyCheck).toBeDefined();
    // Message should mention the key env var
    expect(keyCheck.message).toMatch(/API_KEY/);
  });

  it('profile check indicates status', async () => {
    const checks = await runDiagnostics();
    const profileCheck = checks.find(c => c.name === 'Profile configured');
    expect(profileCheck).toBeDefined();
    expect(['ok', 'fail']).toContain(profileCheck.status);
  });

  it('.env permissions check returns valid status', async () => {
    const checks = await runDiagnostics();
    const envCheck = checks.find(c => c.name === '.env permissions');
    expect(envCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(envCheck.status);
  });

  it('Authensor connectivity check runs', async () => {
    const checks = await runDiagnostics();
    const connectCheck = checks.find(c => c.name === 'Authensor connectivity');
    expect(connectCheck).toBeDefined();
    // Can be ok or fail depending on network/config
    expect(['ok', 'fail']).toContain(connectCheck.status);
  });

  it('policy file check runs', async () => {
    const checks = await runDiagnostics();
    const policyCheck = checks.find(c => c.name === 'Policy file');
    expect(policyCheck).toBeDefined();
    expect(['ok', 'warn']).toContain(policyCheck.status);
  });

  it('every check has a hint field', async () => {
    const checks = await runDiagnostics();
    for (const check of checks) {
      expect(check).toHaveProperty('hint');
    }
  });

  it('ok checks have null hints', async () => {
    const checks = await runDiagnostics();
    const okChecks = checks.filter(c => c.status === 'ok');
    for (const check of okChecks) {
      expect(check.hint).toBeNull();
    }
  });

  it('non-ok checks have string hints', async () => {
    const checks = await runDiagnostics();
    const problemChecks = checks.filter(c => c.status !== 'ok');
    for (const check of problemChecks) {
      expect(typeof check.hint).toBe('string');
      expect(check.hint.length).toBeGreaterThan(0);
    }
  });
});
