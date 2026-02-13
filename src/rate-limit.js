// In-memory sliding window rate limiter.
// No disk persistence needed -state resets on server restart.

/** Map<key, number[]> -stores timestamps of requests within each window */
const windows = new Map();

/**
 * Check if a request is within the rate limit.
 * @param {string} key Identifier (e.g. "POST:/api/task", IP, etc.)
 * @param {number} maxRequests Max allowed requests per window
 * @param {number} windowMs Window size in milliseconds
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let timestamps = windows.get(key);
  if (!timestamps) {
    timestamps = [];
    windows.set(key, timestamps);
  }

  // Prune entries outside the current window
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= maxRequests) {
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
  }

  timestamps.push(now);
  return { allowed: true, remaining: maxRequests - timestamps.length, retryAfterMs: 0 };
}

/**
 * Convenience wrapper: sends 429 response if rate exceeded.
 * @param {import('http').ServerResponse} res
 * @param {string} key
 * @param {number} maxRequests
 * @param {number} windowMs
 * @returns {boolean} true if rate limit was exceeded (response already sent)
 */
export function enforceRateLimit(res, key, maxRequests, windowMs) {
  const result = checkRateLimit(key, maxRequests, windowMs);
  if (!result.allowed) {
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfterSeconds }));
    return true;
  }
  return false;
}

/**
 * Clear all rate limit state (for testing).
 */
export function resetRateLimits() {
  windows.clear();
}
