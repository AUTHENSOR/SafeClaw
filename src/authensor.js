// Authensor control plane API client.
// Only action metadata (type + resource) leaves the machine. Never keys.

const DEFAULT_CONTROL_PLANE = 'https://authensor-control-plane.onrender.com';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** Transient network error codes worth retrying. */
const RETRYABLE_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT']);

function isRetryable(err, statusCode) {
  if (err?.name === 'AbortError') return false;
  if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) return true;
  if (err && !statusCode) {
    // Network-level error (no HTTP status)
    return RETRYABLE_ERRORS.has(err.cause?.code) || RETRYABLE_ERRORS.has(err.code) || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/.test(err.message);
  }
  return false;
}

function getBackoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = parseInt(retryAfterHeader, 10);
    if (!isNaN(secs)) return secs * 1000;
  }
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export { isRetryable, getBackoffMs, sleep, DEFAULT_MAX_RETRIES, INITIAL_BACKOFF_MS };

export class AuthensorClient {
  /**
   * @param {{ controlPlaneUrl?: string, authToken?: string }} opts
   */
  constructor({ controlPlaneUrl, authToken } = {}) {
    this.baseUrl = (controlPlaneUrl || DEFAULT_CONTROL_PLANE).replace(/\/$/, '');
    this.authToken = authToken || '';
  }

  /**
   * Internal fetch wrapper with timeout and auth.
   */
  async _fetch(path, { method = 'GET', body, signal, timeoutMs, maxRetries } = {}) {
    const url = this.baseUrl + path;
    const reqHeaders = { 'Content-Type': 'application/json' };
    if (this.authToken) reqHeaders['Authorization'] = `Bearer ${this.authToken}`;

    const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
    const retries = maxRetries ?? DEFAULT_MAX_RETRIES;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let fetchSignal;
      if (signal) {
        fetchSignal = AbortSignal.any([signal, controller.signal]);
      } else {
        fetchSignal = controller.signal;
      }

      try {
        const res = await fetch(url, {
          method,
          headers: reqHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: fetchSignal,
        });

        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok) {
          // Retry on 429 / 5xx
          if (attempt < retries && isRetryable(null, res.status)) {
            clearTimeout(timeoutId);
            const backoff = getBackoffMs(attempt, res.headers.get('retry-after'));
            await sleep(backoff);
            continue;
          }
          const err = data.error;
          const msg = (typeof err === 'object' && err !== null)
            ? (err.message || err.code || JSON.stringify(err))
            : (err || data.message || `HTTP ${res.status}`);
          throw new Error(msg);
        }
        return data;
      } catch (err) {
        // Network errors -retry if transient
        if (attempt < retries && isRetryable(err, null)) {
          clearTimeout(timeoutId);
          await sleep(getBackoffMs(attempt, null));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  // --- Core endpoints ---

  /** Health check. */
  async health(signal) {
    return this._fetch('/health', { signal });
  }

  /**
   * Submit an action envelope for policy evaluation.
   * POST /evaluate
   *
   * @param {{ action: { type: string, resource: string }, principal: { type: string, id: string }, timestamp?: string }} envelope
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ outcome: string, receiptId?: string, reason?: string }>}
   */
  async evaluate(envelope, signal) {
    return this._fetch('/evaluate', {
      method: 'POST',
      body: envelope,
      signal,
    });
  }

  /**
   * Get a single receipt by ID (for polling approval status).
   * GET /receipts/:id
   */
  async getReceipt(receiptId, signal) {
    return this._fetch(`/receipts/${encodeURIComponent(receiptId)}`, { signal });
  }

  /**
   * List pending approvals.
   * GET /receipts?status=pending&decisionOutcome=require_approval
   */
  async listPendingApprovals({ limit = 50 } = {}, signal) {
    return this._fetch(
      `/receipts?status=pending&decisionOutcome=require_approval&limit=${limit}`,
      { signal }
    );
  }

  /**
   * List recent receipts.
   * GET /receipts?limit=N
   */
  async listReceipts({ limit = 20 } = {}, signal) {
    return this._fetch(`/receipts?limit=${limit}`, { signal });
  }

  /**
   * Resolve an approval (approve or reject).
   * PATCH /receipts/:id
   */
  async resolveApproval(receiptId, action, signal) {
    return this._fetch(`/receipts/${encodeURIComponent(receiptId)}`, {
      method: 'PATCH',
      body: { status: action }, // 'approved' or 'rejected'
      signal,
    });
  }

  // --- Policy endpoints ---

  /** Get active policy. GET /policies/active */
  async getActivePolicy(signal) {
    return this._fetch('/policies/active', { signal });
  }

  /** List all policies. GET /policies */
  async listPolicies(signal) {
    return this._fetch('/policies', { signal });
  }

  /** Create a policy. POST /policies */
  async createPolicy(policy, signal) {
    return this._fetch('/policies', {
      method: 'POST',
      body: policy,
      signal,
    });
  }

  /** Set active policy. POST /policies/active */
  async setActivePolicy(policyId, version, signal) {
    return this._fetch('/policies/active', {
      method: 'POST',
      body: { policy_id: policyId, version },
      signal,
    });
  }

  // --- Demo provisioning ---

  /**
   * Request a demo API key from the Authensor control plane.
   * POST /provision/demo
   *
   * Returns { token, expiresAt } on success.
   * Returns null if the endpoint is not available (404).
   */
  async provisionDemo(installId, signal) {
    try {
      return await this._fetch('/provision/demo', {
        method: 'POST',
        body: { installId },
        signal,
      });
    } catch (err) {
      // 404 = endpoint not deployed yet, return null for graceful fallback
      if (err.message && err.message.includes('404')) return null;
      throw err;
    }
  }
}
