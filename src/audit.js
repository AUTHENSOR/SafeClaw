// Append-only local audit ledger with SHA-256 hash chain.
// Every gateway decision is logged to ~/.safeclaw/audit.jsonl.
// Works offline — no dependency on Authensor control plane.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { configPaths } from './config.js';

const DEFAULT_AUDIT_FILE = path.join(configPaths().CONFIG_DIR, 'audit.jsonl');

// In-memory cache of the last line's hash for fast chaining
let lastHash = null;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Read the hash of the last line in the audit file (cold start).
 */
function getLastHash(auditPath) {
  if (lastHash !== null) return lastHash;
  const filePath = auditPath || DEFAULT_AUDIT_FILE;
  if (!fs.existsSync(filePath)) {
    lastHash = 'GENESIS';
    return lastHash;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    lastHash = 'GENESIS';
    return lastHash;
  }
  lastHash = sha256(lines[lines.length - 1]);
  return lastHash;
}

/**
 * Append a single audit entry as a JSON line with prevHash for chain integrity.
 * @param {{ timestamp: string, toolName: string, actionType: string, resource: string, outcome: string, receiptId?: string, taskId?: string, profile?: string, source: string }} entry
 * @param {string} [auditPath] Override path (for testing)
 */
export function appendEntry(entry, auditPath) {
  const filePath = auditPath || DEFAULT_AUDIT_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const prevHash = getLastHash(auditPath);
  const enriched = { ...entry, prevHash };
  const line = JSON.stringify(enriched);

  fs.appendFileSync(filePath, line + '\n', { mode: 0o600 });
  lastHash = sha256(line);
}

/**
 * Read audit entries, newest first.
 * @param {{ limit?: number, filter?: { actionType?: string, outcome?: string } }} [opts]
 * @param {string} [auditPath] Override path (for testing)
 * @returns {Array}
 */
export function readEntries({ limit = 100, filter = {} } = {}, auditPath) {
  const filePath = auditPath || DEFAULT_AUDIT_FILE;
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip corrupt lines silently
    }
  }

  // Reverse for newest-first
  entries.reverse();

  // Apply filters
  let filtered = entries;
  if (filter.actionType) {
    filtered = filtered.filter(e => e.actionType && e.actionType.startsWith(filter.actionType));
  }
  if (filter.outcome) {
    filtered = filtered.filter(e => e.outcome === filter.outcome);
  }

  return filtered.slice(0, limit);
}

/**
 * Rotate the audit log: rename current to .jsonl.1, start fresh.
 * @param {string} [auditPath] Override path (for testing)
 */
export function rotateLog(auditPath) {
  const filePath = auditPath || DEFAULT_AUDIT_FILE;
  if (!fs.existsSync(filePath)) return;
  const backup = filePath + '.1';
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  fs.renameSync(filePath, backup);
  fs.writeFileSync(filePath, '', { mode: 0o600 });
  lastHash = 'GENESIS';
}

/**
 * Verify the integrity of the audit hash chain.
 * Pre-chain entries (without prevHash) are skipped gracefully.
 * @param {string} [auditPath] Override path (for testing)
 * @returns {{ valid: boolean, totalEntries: number, chainedEntries: number, errors: string[] }}
 */
export function verifyAuditIntegrity(auditPath) {
  const filePath = auditPath || DEFAULT_AUDIT_FILE;
  if (!fs.existsSync(filePath)) {
    return { valid: true, totalEntries: 0, chainedEntries: 0, errors: [] };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const errors = [];
  let chainedEntries = 0;
  let prevLineHash = 'GENESIS';

  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      errors.push(`Line ${i + 1}: invalid JSON`);
      continue;
    }

    if (!entry.prevHash) {
      // Pre-chain entry — skip verification but update prevLineHash for next
      prevLineHash = sha256(lines[i]);
      continue;
    }

    chainedEntries++;

    if (entry.prevHash !== prevLineHash) {
      errors.push(`Line ${i + 1}: prevHash mismatch (expected ${prevLineHash.slice(0, 12)}..., got ${entry.prevHash.slice(0, 12)}...)`);
    }

    prevLineHash = sha256(lines[i]);
  }

  return {
    valid: errors.length === 0,
    totalEntries: lines.length,
    chainedEntries,
    errors,
  };
}

/**
 * Reset the last hash cache. For testing only.
 */
export function _resetLastHash() {
  lastHash = null;
}
