// Container runner for sandboxed agent execution.
// Wraps the agent in a Docker/Podman container with:
//   - Read-only app mount
//   - Workspace volume for agent file operations
//   - API key passed via env var (never baked into image)
//   - Network access for Authensor control plane + Anthropic API

import { execFileSync, spawn } from 'child_process';

const IMAGE_NAME = 'safeclaw';
const CONTAINER_WORKSPACE = '/workspace';

/**
 * Detect which container runtime is available.
 * Prefers Docker, falls back to Podman.
 * @returns {'docker'|'podman'|null}
 */
export function detectRuntime() {
  for (const cmd of ['docker', 'podman']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      // not found
    }
  }
  return null;
}

/**
 * Build the SafeClaw container image if it doesn't exist or if --rebuild is set.
 * @param {{ runtime: string, projectRoot: string, rebuild?: boolean }} opts
 */
export function buildImage({ runtime, projectRoot, rebuild = false }) {
  if (!rebuild) {
    try {
      const out = execFileSync(runtime, ['images', '-q', IMAGE_NAME], {
        encoding: 'utf-8',
      }).trim();
      if (out) return; // image exists
    } catch {
      // fall through to build
    }
  }

  process.stderr.write(`[SafeClaw] Building container image...\n`);
  execFileSync(runtime, ['build', '-t', IMAGE_NAME, projectRoot], {
    stdio: 'inherit',
  });
  process.stderr.write(`[SafeClaw] Image built: ${IMAGE_NAME}\n`);
}

/**
 * Run the agent inside a container.
 *
 * @param {{ runtime: string, task: string, profile: object, workspacePath: string, verbose?: boolean, extraEnv?: Record<string, string> }} opts
 * @returns {Promise<number>} Exit code
 */
export function runContainer({ runtime, task, profile, workspacePath, verbose = false, extraEnv = {} }) {
  return new Promise((resolve, reject) => {
    const keyEnv = profile.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
    const apiKey = process.env[keyEnv];
    if (!apiKey) {
      reject(new Error(
        `Missing Anthropic API key. Set ${keyEnv} in your environment:\n` +
        `  export ${keyEnv}=sk-ant-...`
      ));
      return;
    }

    // Set config values in process env so they can be inherited (not visible in ps)
    if (profile.controlPlane) process.env.SAFECLAW_CONTROL_PLANE = profile.controlPlane;
    if (profile.authToken) process.env.SAFECLAW_AUTH_TOKEN = profile.authToken;
    if (profile.installId) process.env.SAFECLAW_INSTALL_ID = profile.installId;

    const args = [
      'run', '--rm',
      // Security: read-only root filesystem with writable tmp areas
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--tmpfs', '/home/safeclaw:rw,noexec,nosuid,size=64m', // SDK needs ~/.claude
      // Mount workspace (agent can read/write files here)
      '-v', `${workspacePath}:${CONTAINER_WORKSPACE}`,
      // Pass API key via env (never in image or CLI args visible to ps)
      '-e', `${keyEnv}`,
      // Pass SafeClaw config via env (inherit from process env, never in CLI args)
      '-e', 'SAFECLAW_CONTROL_PLANE',
      '-e', 'SAFECLAW_AUTH_TOKEN',
      '-e', 'SAFECLAW_INSTALL_ID',
    ];

    // Pass approval timeout if set (inherit from env, not visible in ps)
    if (process.env.SAFECLAW_APPROVAL_TIMEOUT_SECONDS) {
      args.push('-e', 'SAFECLAW_APPROVAL_TIMEOUT_SECONDS');
    }

    // Pass Twilio env vars for SMS notifications (if set)
    for (const twilioVar of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SAFECLAW_NOTIFY_PHONE']) {
      if (process.env[twilioVar]) {
        args.push('-e', twilioVar);
      }
    }

    // Pass any extra env vars
    for (const [k, v] of Object.entries(extraEnv)) {
      args.push('-e', `${k}=${v}`);
    }

    // Resource limits
    args.push(
      '--memory', '2g',
      '--cpus', '2',
      '--pids-limit', '256',
    );

    // Image and command
    args.push(IMAGE_NAME, 'run');
    if (verbose) args.push('--verbose');
    args.push(task);

    if (verbose) {
      process.stderr.write(`[SafeClaw] ${runtime} ${args.join(' ')}\n`);
    }

    const child = spawn(runtime, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    child.on('error', (err) => {
      reject(new Error(`Container failed to start: ${err.message}`));
    });

    child.on('close', (code) => {
      resolve(code || 0);
    });
  });
}
