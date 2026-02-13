import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const CONFIG_DIR = path.join(os.homedir(), '.safeclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const POLICY_DIR = path.join(CONFIG_DIR, 'policies');

export function configPaths() {
  return { CONFIG_DIR, CONFIG_FILE, POLICY_DIR };
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { activeProfile: 'default', profiles: {} };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function ensureProfile(cfg, name) {
  if (!cfg.profiles) cfg.profiles = {};
  if (!cfg.activeProfile) cfg.activeProfile = name;

  if (!cfg.profiles[name]) {
    cfg.profiles[name] = {
      installId: crypto.randomUUID(),
      controlPlane: 'https://authensor-api-production.up.railway.app',
      authToken: '',
      provider: { name: 'claude', apiKeyEnv: 'ANTHROPIC_API_KEY', model: '' },
      policy: { path: defaultPolicyPath(name), id: '' }
    };
  }
  return cfg.profiles[name];
}

export function getProfile(cfg, name) {
  const profileName = name || cfg.activeProfile || 'default';
  const profile = cfg.profiles && cfg.profiles[profileName];
  if (!profile) return null;
  return { name: profileName, profile };
}

export function setActiveProfile(cfg, name) {
  cfg.activeProfile = name;
}

export function defaultPolicyPath(profileName) {
  return path.join(POLICY_DIR, `${profileName}.json`);
}

export function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// --- .env file management ---

export function getEnvFilePath() {
  return path.join(CONFIG_DIR, '.env');
}

/**
 * Load ~/.safeclaw/.env into process.env (does not overwrite existing vars).
 */
export function loadDotEnv() {
  const envPath = getEnvFilePath();
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't overwrite existing env vars (explicit export wins)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

/**
 * Write a key=value pair to ~/.safeclaw/.env (chmod 600).
 */
export function writeEnvVar(key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error('Invalid env var key');
  }
  if (typeof value === 'string' && /[\r\n\0]/.test(value)) {
    throw new Error('Invalid env value: contains newline or null byte');
  }
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const envPath = getEnvFilePath();

  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  }

  let found = false;
  lines = lines.map(line => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);

  fs.writeFileSync(envPath, lines.join('\n'));
  fs.chmodSync(envPath, 0o600);

  // Also set in current process
  process.env[key] = value;
}
