// Diagnostic checks for SafeClaw setup and health.
// `safeclaw doctor` runs all checks and reports status.

import fs from 'fs';
import { configPaths, loadConfig, getProfile, loadDotEnv, getEnvFilePath } from './config.js';
import { loadSettings, validateSettings } from './settings.js';
import { verifyAuditIntegrity } from './audit.js';
import { AuthensorClient } from './authensor.js';
import { detectRuntime } from './container.js';

/**
 * Run all diagnostic checks.
 * @returns {Promise<Array<{ name: string, status: 'ok'|'warn'|'fail', message: string, hint?: string }>>}
 */
export async function runDiagnostics() {
  const checks = [];

  // 1. Node version
  const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: 'Node.js version',
    status: nodeVersion >= 20 ? 'ok' : 'fail',
    message: nodeVersion >= 20 ? `v${process.versions.node}` : `v${process.versions.node} (requires >=20)`,
    hint: nodeVersion >= 20 ? null : 'Install Node.js 20 or later from nodejs.org',
  });

  // 2. Config directory
  const { CONFIG_DIR } = configPaths();
  checks.push({
    name: 'Config directory',
    status: fs.existsSync(CONFIG_DIR) ? 'ok' : 'fail',
    message: fs.existsSync(CONFIG_DIR) ? CONFIG_DIR : `${CONFIG_DIR} not found`,
    hint: fs.existsSync(CONFIG_DIR) ? null : 'Run: safeclaw init',
  });

  // 3. Profile configured
  const cfg = loadConfig();
  const profileResult = getProfile(cfg);
  const profile = profileResult?.profile;
  checks.push({
    name: 'Profile configured',
    status: profile ? 'ok' : 'fail',
    message: profile ? `Active: ${cfg.activeProfile || 'default'}` : 'No profile found. Run: safeclaw init',
    hint: profile ? null : 'Complete the setup wizard or run: safeclaw init',
  });

  // 4. API key set
  loadDotEnv();
  const keyEnv = profile?.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
  const hasKey = !!process.env[keyEnv];
  checks.push({
    name: 'API key',
    status: hasKey ? 'ok' : 'fail',
    message: hasKey ? `${keyEnv} is set` : `${keyEnv} not found in environment or .env`,
    hint: hasKey ? null : 'Add your API key in Settings > Configuration',
  });

  // 5. Settings valid
  try {
    const settings = loadSettings();
    const validation = validateSettings(settings);
    checks.push({
      name: 'Settings',
      status: validation.valid ? 'ok' : 'warn',
      message: validation.valid ? 'Valid' : validation.errors.join('; '),
      hint: validation.valid ? null : 'Fix settings in the Settings tab',
    });
  } catch (err) {
    checks.push({ name: 'Settings', status: 'warn', message: err.message, hint: 'Check ~/.safeclaw/settings.json' });
  }

  // 6. Policy file
  const policyPath = profile?.policy?.path;
  if (policyPath && fs.existsSync(policyPath)) {
    try {
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
      const ruleCount = (policy.rules || []).length;
      checks.push({
        name: 'Policy file',
        status: ruleCount > 0 ? 'ok' : 'warn',
        message: ruleCount > 0 ? `${ruleCount} rules in ${policyPath}` : `Policy exists but has no rules`,
        hint: ruleCount > 0 ? null : 'Add rules in the Policy tab or load a template',
      });
    } catch {
      checks.push({ name: 'Policy file', status: 'warn', message: 'Policy file exists but is invalid JSON', hint: 'Load a template from the Policy tab' });
    }
  } else {
    checks.push({
      name: 'Policy file',
      status: 'warn',
      message: policyPath ? `Not found: ${policyPath}` : 'No policy path configured',
      hint: 'Run: safeclaw policy apply',
    });
  }

  // 7. Audit log integrity
  try {
    const auditResult = verifyAuditIntegrity();
    checks.push({
      name: 'Audit log',
      status: auditResult.valid ? 'ok' : 'fail',
      message: auditResult.valid
        ? `${auditResult.totalEntries} entries, ${auditResult.chainedEntries} chained`
        : `Integrity check failed: ${auditResult.errors[0]}`,
      hint: auditResult.valid ? null : 'Audit log may have been tampered with — check the Audit Log tab',
    });
  } catch (err) {
    checks.push({ name: 'Audit log', status: 'warn', message: err.message, hint: 'Check that ~/.safeclaw/audit.jsonl exists' });
  }

  // 8. Authensor connectivity
  if (profile?.authToken) {
    try {
      const client = new AuthensorClient({
        controlPlaneUrl: profile.controlPlane,
        authToken: profile.authToken,
      });
      await client.health();
      checks.push({ name: 'Authensor connectivity', status: 'ok', message: `Connected to ${profile.controlPlane}`, hint: null });
    } catch (err) {
      checks.push({ name: 'Authensor connectivity', status: 'fail', message: err.message, hint: 'Check your network connection or Authensor token' });
    }
  } else {
    checks.push({ name: 'Authensor connectivity', status: 'fail', message: 'No auth token configured', hint: 'Add your Authensor token in Settings > Configuration' });
  }

  // 9. Container runtime (optional)
  try {
    const runtime = detectRuntime();
    checks.push({
      name: 'Container runtime',
      status: runtime ? 'ok' : 'warn',
      message: runtime ? runtime : 'Not found (optional: install Docker or Podman for sandboxed execution)',
      hint: runtime ? null : 'Install Docker or Podman for container mode (optional)',
    });
  } catch {
    checks.push({ name: 'Container runtime', status: 'warn', message: 'Not found (optional)', hint: 'Install Docker or Podman for container mode (optional)' });
  }

  // 10. .env permissions
  const envPath = getEnvFilePath();
  if (fs.existsSync(envPath)) {
    try {
      const stat = fs.statSync(envPath);
      const mode = (stat.mode & 0o777).toString(8);
      checks.push({
        name: '.env permissions',
        status: mode === '600' ? 'ok' : 'warn',
        message: mode === '600' ? 'chmod 600 (correct)' : `chmod ${mode} (should be 600)`,
        hint: mode === '600' ? null : 'Run: chmod 600 ~/.safeclaw/.env',
      });
    } catch {
      checks.push({ name: '.env permissions', status: 'warn', message: 'Could not read file permissions', hint: 'Check file permissions on ~/.safeclaw/.env' });
    }
  } else {
    checks.push({ name: '.env permissions', status: 'warn', message: '.env file not found', hint: 'Complete setup to create the .env file' });
  }

  return checks;
}
