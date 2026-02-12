// Task session persistence.
// Completed tasks are saved to ~/.safeclaw/sessions/{id}.json.
// Sessions include the prompt, provider, status, cost, and a capped transcript.

import fs from 'fs';
import path from 'path';
import { configPaths } from './config.js';

const MAX_MESSAGES = 200;
const DEFAULT_SESSION_DIR = path.join(configPaths().CONFIG_DIR, 'sessions');

/**
 * Save a completed session to disk.
 * @param {object} session
 * @param {string} [sessionsDir] Override directory (for testing)
 */
export function saveSession(session, sessionsDir) {
  const dir = sessionsDir || DEFAULT_SESSION_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Cap messages to prevent unbounded growth
  if (session.messages && session.messages.length > MAX_MESSAGES) {
    session.messages = session.messages.slice(0, MAX_MESSAGES);
  }
  if (session.toolCalls && session.toolCalls.length > MAX_MESSAGES) {
    session.toolCalls = session.toolCalls.slice(0, MAX_MESSAGES);
  }

  const filePath = path.join(dir, `${session.id}.json`);
  // Atomic write: write to temp, then rename
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

/**
 * Load a single session by ID.
 * @param {string} sessionId
 * @param {string} [sessionsDir] Override directory (for testing)
 * @returns {object|null}
 */
export function loadSession(sessionId, sessionsDir) {
  // Validate session ID to prevent path traversal
  if (!sessionId || !/^[\w.-]+$/.test(sessionId)) return null;
  const dir = sessionsDir || DEFAULT_SESSION_DIR;
  const filePath = path.join(dir, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * List session summaries, newest first.
 * Returns lightweight objects (no messages or toolCalls).
 * @param {{ limit?: number }} [opts]
 * @param {string} [sessionsDir] Override directory (for testing)
 * @returns {Array}
 */
export function listSessions({ limit = 20 } = {}, sessionsDir) {
  const dir = sessionsDir || DEFAULT_SESSION_DIR;
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      return { file: f, filePath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  return files.map(({ filePath }) => {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Return summary only (no messages/toolCalls)
      return {
        id: data.id,
        task: data.task,
        provider: data.provider,
        model: data.model,
        profile: data.profile,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
        status: data.status,
        cost: data.cost,
        error: data.error,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}
