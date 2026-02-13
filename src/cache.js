// Offline decision cache -stores recent allow decisions in memory + disk.
// When Authensor control plane is unreachable and cache is enabled,
// cached allows let the agent continue. Denies are never cached (fail-safe).

import fs from 'fs';
import path from 'path';
import { configPaths } from './config.js';

const DEFAULT_CACHE_FILE = path.join(configPaths().CONFIG_DIR, 'decision-cache.json');

// In-memory cache: { [key]: { outcome, expiresAt } }
let memCache = null;

function cacheKey(actionType, resource) {
  return actionType + '::' + resource;
}

function loadFromDisk(cachePath) {
  const filePath = cachePath || DEFAULT_CACHE_FILE;
  if (memCache) return memCache;
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Prune expired entries on load
      const now = Date.now();
      memCache = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v.expiresAt > now) memCache[k] = v;
      }
      return memCache;
    }
  } catch {
    // Corrupt file -start fresh
  }
  memCache = {};
  return memCache;
}

function saveToDisk(cachePath) {
  const filePath = cachePath || DEFAULT_CACHE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(memCache || {}), { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/**
 * Cache a decision. Only "allow" outcomes are stored.
 * @param {string} actionType
 * @param {string} resource
 * @param {string} outcome
 * @param {number} [ttlSeconds=300]
 * @param {string} [cachePath]
 */
export function cacheDecision(actionType, resource, outcome, ttlSeconds = 300, cachePath) {
  if (outcome !== 'allow') return;
  const cache = loadFromDisk(cachePath);
  const key = cacheKey(actionType, resource);
  cache[key] = { outcome, expiresAt: Date.now() + ttlSeconds * 1000 };
  saveToDisk(cachePath);
}

/**
 * Get a cached decision, or null if not found / expired.
 * @param {string} actionType
 * @param {string} resource
 * @param {string} [cachePath]
 * @returns {{ outcome: string } | null}
 */
export function getCachedDecision(actionType, resource, cachePath) {
  const cache = loadFromDisk(cachePath);
  const key = cacheKey(actionType, resource);
  const entry = cache[key];
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    delete cache[key];
    return null;
  }
  return { outcome: entry.outcome };
}

/**
 * Clear all cached decisions (memory + disk).
 * @param {string} [cachePath]
 */
export function clearCache(cachePath) {
  memCache = {};
  const filePath = cachePath || DEFAULT_CACHE_FILE;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Reset in-memory cache (for testing -forces disk reload on next access).
 */
export function _resetMemCache() {
  memCache = null;
}
