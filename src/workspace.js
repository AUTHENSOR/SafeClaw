// Workspace scoping: detect project root and enforce path restrictions.
// In non-container mode, prevents the agent from touching files outside the project.

import fs from 'fs';
import path from 'path';
import os from 'os';

const MAX_WALK_UP = 10;

const DEFAULT_DENIED = ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gcloud'];
const DEFAULT_ALLOWED = ['./'];

/**
 * Walk up from startDir looking for a workspace marker.
 * Priority: .safeclaw.json > .git > package.json
 * @param {string} startDir
 * @returns {{ root: string, config: object } | null}
 */
export function detectWorkspace(startDir) {
  let current = path.resolve(startDir);

  for (let i = 0; i < MAX_WALK_UP; i++) {
    const scPath = path.join(current, '.safeclaw.json');
    if (fs.existsSync(scPath)) {
      return { root: current, config: loadWorkspaceConfig(current) };
    }

    const gitPath = path.join(current, '.git');
    if (fs.existsSync(gitPath)) {
      return { root: current, config: defaultConfig(current) };
    }

    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return { root: current, config: defaultConfig(current) };
    }

    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  return null;
}

/**
 * Parse .safeclaw.json from a project root.
 * @param {string} projectRoot
 * @returns {object}
 */
export function loadWorkspaceConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.safeclaw.json');
  if (!fs.existsSync(configPath)) return defaultConfig(projectRoot);

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      root: projectRoot,
      allowedPaths: (raw.allowedPaths || DEFAULT_ALLOWED).map(p => resolvePath(p, projectRoot)),
      deniedPaths: (raw.deniedPaths || DEFAULT_DENIED).map(p => resolvePath(p, projectRoot)),
      settings: raw.settings || {},
    };
  } catch {
    return defaultConfig(projectRoot);
  }
}

/**
 * Check whether a file path is allowed by the workspace config.
 * Denied paths always win over allowed paths.
 * @param {string} filePath
 * @param {object} wsConfig  — { root, allowedPaths, deniedPaths }
 * @returns {boolean}
 */
export function isPathAllowed(filePath, wsConfig) {
  if (!wsConfig || !wsConfig.root) return true;

  const resolved = path.resolve(filePath);

  // Check denied paths first — deny always wins
  for (const denied of wsConfig.deniedPaths) {
    if (resolved === denied || resolved.startsWith(denied + path.sep)) {
      return false;
    }
  }

  // Check allowed paths — must match at least one
  for (const allowed of wsConfig.allowedPaths) {
    if (resolved === allowed || resolved.startsWith(allowed + path.sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a default .safeclaw.json in the given directory.
 * @param {string} dir
 */
export function createWorkspaceConfig(dir) {
  const configPath = path.join(dir, '.safeclaw.json');
  const config = {
    allowedPaths: ['./'],
    deniedPaths: ['~/.ssh', '~/.aws', '~/.gnupg', '~/.config/gcloud'],
    settings: {},
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return configPath;
}

// --- Helpers ---

function defaultConfig(projectRoot) {
  return {
    root: projectRoot,
    allowedPaths: DEFAULT_ALLOWED.map(p => resolvePath(p, projectRoot)),
    deniedPaths: DEFAULT_DENIED.map(p => resolvePath(p, projectRoot)),
    settings: {},
  };
}

function resolvePath(p, projectRoot) {
  if (p.startsWith('~/')) {
    return path.resolve(os.homedir(), p.slice(2));
  }
  if (p.startsWith('./') || p.startsWith('../') || !path.isAbsolute(p)) {
    return path.resolve(projectRoot, p);
  }
  return path.resolve(p);
}
