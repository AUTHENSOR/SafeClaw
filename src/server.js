// Dashboard HTTP server — localhost only, zero dependencies.
// Serves the dashboard SPA and provides API routes for setup, task running,
// approvals, and receipts. Same security model as Jupyter/VS Code.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execFile } from 'child_process';
import { EventEmitter } from 'events';
import { loadConfig, saveConfig, getProfile, ensureProfile, setActiveProfile, configPaths, loadDotEnv, writeEnvVar } from './config.js';
import { AuthensorClient } from './authensor.js';
import { loadPolicy, savePolicy, ensurePolicyFile, listPolicyVersions, rollbackPolicy, simulatePolicy } from './policy.js';
import { runAgent } from './agent.js';
import { readEntries, rotateLog, verifyAuditIntegrity } from './audit.js';
import { saveSession, loadSession, listSessions } from './session.js';
import { loadSettings, saveSettings, validateSettings } from './settings.js';
import { computeCostSummary, computeApprovalMetrics, computeToolUsage, exportAudit, computeMcpUsage, getKnownMcpServers } from './analytics.js';
import { enforceRateLimit } from './rate-limit.js';
import { sendWebhook } from './webhook.js';
import { checkBudget } from './budget.js';
import { getSchedules, addSchedule, removeSchedule, updateSchedule, isQuietHours, nextCronRun, parseCron } from './scheduler.js';
import { logger } from './logger.js';
import { redactSecrets } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Error classification ---

class HttpError extends Error {
  constructor(msg, status) { super(msg); this.statusCode = status; }
}
class ValidationError extends HttpError {
  constructor(msg) { super(msg, 400); }
}
class NotFoundError extends HttpError {
  constructor(msg) { super(msg, 404); }
}

export { ValidationError, NotFoundError };
const DASHBOARD_DIR = path.join(__dirname, '..', 'ui', 'dashboard');
const DEFAULT_PORT = 7700;
const MAX_PORT_TRIES = 10;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Global event bus for SSE broadcasting
export const eventBus = new EventEmitter();

// Active task state (single task at a time) + task queue
let activeTask = null;
const taskQueue = [];

// --- JSON body parser ---

function parseBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// --- Static file server ---

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = url.pathname;
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  // Path traversal prevention
  const resolved = path.resolve(DASHBOARD_DIR, '.' + filePath);
  if (!resolved.startsWith(path.resolve(DASHBOARD_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(resolved);
  const mime = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mime };
  // Prevent browser from caching sw.js so service worker updates propagate immediately
  if (filePath.endsWith('/sw.js')) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }
  res.writeHead(200, headers);
  fs.createReadStream(resolved).pipe(res);
}

// --- JSON response helpers ---

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function errorJson(res, msg, status = 400) {
  json(res, { error: msg }, status);
}

// --- Security headers ---

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';");
}

// --- Route handler ---

async function handleRequest(req, res) {
  setSecurityHeaders(res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    // CSRF protection for all write endpoints
    if (['POST', 'PUT', 'DELETE'].includes(method) && pathname.startsWith('/api/')) {
      if (req.headers['x-requested-with'] !== 'SafeClaw') {
        return errorJson(res, 'CSRF check failed', 403);
      }
    }

    // Rate limiting on write endpoints
    if (method === 'POST' && pathname === '/api/task') {
      if (enforceRateLimit(res, 'task', 10, 60000)) return;
    }
    if (method === 'POST' && pathname.startsWith('/api/approvals/')) {
      if (enforceRateLimit(res, 'approvals', 30, 60000)) return;
    }
    if ((method === 'POST' || method === 'PUT') && pathname.startsWith('/api/schedules')) {
      if (enforceRateLimit(res, 'schedules', 10, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/setup') {
      if (enforceRateLimit(res, 'setup', 5, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/policy/apply') {
      if (enforceRateLimit(res, 'policy-apply', 10, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/policy/rollback') {
      if (enforceRateLimit(res, 'policy-rollback', 10, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/policy/simulate') {
      if (enforceRateLimit(res, 'policy-simulate', 30, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/policy/rules') {
      if (enforceRateLimit(res, 'policy-rules', 10, 60000)) return;
    }
    if (method === 'PUT' && pathname === '/api/config') {
      if (enforceRateLimit(res, 'config-update', 10, 60000)) return;
    }
    if (method === 'PUT' && pathname === '/api/settings') {
      if (enforceRateLimit(res, 'settings-update', 10, 60000)) return;
    }
    if (method === 'PUT' && pathname === '/api/sms') {
      if (enforceRateLimit(res, 'sms-update', 10, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/import/config') {
      if (enforceRateLimit(res, 'import-config', 5, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/audit/rotate') {
      if (enforceRateLimit(res, 'audit-rotate', 2, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/provision-demo') {
      if (enforceRateLimit(res, 'provision-demo', 3, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/policy/load-template') {
      if (enforceRateLimit(res, 'policy-template', 10, 60000)) return;
    }
    if (method === 'POST' && pathname === '/api/profiles/switch') {
      if (enforceRateLimit(res, 'profile-switch', 10, 60000)) return;
    }
    if (method === 'DELETE' && pathname.startsWith('/api/policy/rules/')) {
      if (enforceRateLimit(res, 'policy-rules-delete', 20, 60000)) return;
    }
    if (method === 'PUT' && pathname.startsWith('/api/policy/rules/')) {
      if (enforceRateLimit(res, 'policy-rules-update', 10, 60000)) return;
    }
    if (method === 'POST' && pathname.match(/^\/api\/task\/[^/]+\/stop$/)) {
      if (enforceRateLimit(res, 'task-stop', 10, 60000)) return;
    }
    if (method === 'DELETE' && pathname.startsWith('/api/task/queue/')) {
      if (enforceRateLimit(res, 'queue-remove', 10, 60000)) return;
    }
    if (method === 'DELETE' && pathname.startsWith('/api/schedules/')) {
      if (enforceRateLimit(res, 'schedule-delete', 10, 60000)) return;
    }

    try {
      if (method === 'GET' && pathname === '/api/status') return handleStatus(req, res);
      if (method === 'GET' && pathname === '/api/health') return await handleHealth(req, res);
      if (method === 'POST' && pathname === '/api/setup') return await handleSetup(req, res);
      if (method === 'POST' && pathname === '/api/task') return await handleTaskStart(req, res);
      if (method === 'GET' && /^\/api\/task\/[^/]+\/stream$/.test(pathname)) return handleTaskStream(req, res, pathname.split('/')[3]);
      if (method === 'POST' && /^\/api\/task\/[^/]+\/stop$/.test(pathname)) return handleTaskStop(req, res, pathname.split('/')[3]);
      if (method === 'GET' && pathname === '/api/approvals') return await handleApprovalsList(req, res);
      if (method === 'POST' && /^\/api\/approvals\/[^/]+$/.test(pathname)) return await handleApprovalAction(req, res, pathname.split('/')[3]);
      if (method === 'GET' && pathname === '/api/receipts') return await handleReceipts(req, res);
      if (method === 'GET' && pathname === '/api/events') return handleGlobalSSE(req, res);
      if (method === 'GET' && pathname === '/api/policy') return handlePolicyGet(req, res);
      if (method === 'POST' && pathname === '/api/policy/apply') return await handlePolicyApply(req, res);
      if (method === 'POST' && pathname === '/api/provision-demo') return await handleProvisionDemo(req, res);

      // Doctor endpoint
      if (method === 'GET' && pathname === '/api/doctor') return await handleDoctor(req, res);

      // Audit endpoints
      if (method === 'GET' && pathname === '/api/audit') return handleAuditList(req, res, url);
      if (method === 'GET' && pathname === '/api/audit/verify') return handleAuditVerify(req, res);
      if (method === 'POST' && pathname === '/api/audit/rotate') return handleAuditRotate(req, res);

      // Session/history endpoints
      if (method === 'GET' && pathname === '/api/sessions') return handleSessionsList(req, res, url);
      if (method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(pathname)) return handleSessionGet(req, res, pathname.split('/')[3]);

      // Policy editor endpoints
      if (method === 'GET' && pathname === '/api/policy/rules') return handlePolicyRulesGet(req, res);
      if (method === 'POST' && pathname === '/api/policy/rules') return await handlePolicyRuleAdd(req, res);
      if (method === 'PUT' && /^\/api\/policy\/rules\/[^/]+$/.test(pathname)) return await handlePolicyRuleUpdate(req, res, pathname.split('/')[4]);
      if (method === 'DELETE' && /^\/api\/policy\/rules\/[^/]+$/.test(pathname)) return await handlePolicyRuleDelete(req, res, pathname.split('/')[4]);
      if (method === 'GET' && pathname === '/api/policy/templates') return handlePolicyTemplates(req, res);
      if (method === 'POST' && pathname === '/api/policy/load-template') return await handlePolicyLoadTemplate(req, res);
      if (method === 'GET' && pathname === '/api/policy/versions') return handlePolicyVersions(req, res);
      if (method === 'POST' && pathname === '/api/policy/rollback') return await handlePolicyRollback(req, res);
      if (method === 'POST' && pathname === '/api/policy/simulate') return await handlePolicySimulate(req, res);

      // Profile endpoints
      if (method === 'GET' && pathname === '/api/profiles') return handleProfilesList(req, res);
      if (method === 'POST' && pathname === '/api/profiles/switch') return await handleProfileSwitch(req, res);

      // Configuration endpoints
      if (method === 'GET' && pathname === '/api/config') return handleConfigGet(req, res);
      if (method === 'PUT' && pathname === '/api/config') return await handleConfigUpdate(req, res);

      // SMS configuration endpoints
      if (method === 'GET' && pathname === '/api/sms') return handleSmsGet(req, res);
      if (method === 'PUT' && pathname === '/api/sms') return await handleSmsUpdate(req, res);

      // Settings endpoints
      if (method === 'GET' && pathname === '/api/settings') return handleSettingsGet(req, res);
      if (method === 'PUT' && pathname === '/api/settings') return await handleSettingsUpdate(req, res);

      // Analytics endpoints
      if (method === 'GET' && pathname === '/api/analytics/cost') return handleAnalyticsCost(req, res, url);
      if (method === 'GET' && pathname === '/api/analytics/approvals') return handleAnalyticsApprovals(req, res);
      if (method === 'GET' && pathname === '/api/analytics/tools') return handleAnalyticsTools(req, res);
      if (method === 'GET' && pathname === '/api/export/audit') return handleExportAudit(req, res, url);

      // Budget endpoint
      if (method === 'GET' && pathname === '/api/budget') return handleBudgetStatus(req, res);

      // MCP endpoints
      if (method === 'GET' && pathname === '/api/analytics/mcp') return handleAnalyticsMcp(req, res);
      if (method === 'GET' && pathname === '/api/mcp/servers') return handleMcpServers(req, res);

      // Config backup/restore endpoints
      if (method === 'GET' && pathname === '/api/export/config') return handleExportConfig(req, res);
      if (method === 'POST' && pathname === '/api/import/config') return await handleImportConfig(req, res);

      // Task queue endpoints
      if (method === 'GET' && pathname === '/api/task/queue') return handleTaskQueue(req, res);
      if (method === 'DELETE' && /^\/api\/task\/queue\/[^/]+$/.test(pathname)) return handleTaskQueueRemove(req, res, pathname.split('/')[4]);

      // Schedule endpoints
      if (method === 'GET' && pathname === '/api/schedules') return handleSchedulesList(req, res);
      if (method === 'POST' && pathname === '/api/schedules') return await handleScheduleCreate(req, res);
      if (method === 'PUT' && /^\/api\/schedules\/[^/]+$/.test(pathname)) return await handleScheduleUpdate(req, res, pathname.split('/')[3]);
      if (method === 'DELETE' && /^\/api\/schedules\/[^/]+$/.test(pathname)) return handleScheduleDelete(req, res, pathname.split('/')[3]);

      return errorJson(res, 'Not found', 404);
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) logger.error('Internal error', { error: err.message, path: pathname });
      return errorJson(res, err.message || 'Internal error', status);
    }
  }

  serveStatic(req, res);
}

// --- Helpers ---

function getProfileOrNull() {
  const cfg = loadConfig();
  const result = getProfile(cfg);
  return result ? result.profile : null;
}

// --- API handlers ---

function handleStatus(req, res) {
  const cfg = loadConfig();
  const result = getProfile(cfg);
  const profile = result ? result.profile : null;
  const keyEnv = profile?.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';

  json(res, {
    setupComplete: !!(profile && profile.authToken && process.env[keyEnv]),
    activeProfile: cfg.activeProfile || null,
    provider: profile?.provider?.name || 'claude',
    hasApiKey: !!process.env[keyEnv],
    hasAuthToken: !!(profile && profile.authToken),
    hasPolicyId: !!(profile && profile.policy?.id),
    agentStatus: activeTask ? 'running' : 'idle',
    activeTaskId: activeTask?.id || null,
    queueLength: taskQueue.length,
  });
}

async function handleHealth(req, res) {
  const result = {
    ok: true,
    version: '1.0.0-beta',
    uptime: Math.floor(process.uptime()),
    schedulerRunning: !!schedulerInterval,
    authensorReachable: false,
    pendingApprovals: 0,
    auditIntegrity: 'unknown',
  };

  // Authensor reachability
  const profile = getProfileOrNull();
  if (profile && profile.authToken) {
    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });
    try {
      await client.health();
      result.authensorReachable = true;
    } catch {
      result.ok = false;
    }
    // Pending approvals count
    try {
      const approvals = await client.listPendingApprovals();
      result.pendingApprovals = (approvals.items || approvals || []).length;
    } catch {}
  } else {
    result.ok = false;
  }

  // Audit integrity
  try {
    const integrity = verifyAuditIntegrity();
    result.auditIntegrity = integrity.valid ? 'ok' : 'degraded';
  } catch {
    result.auditIntegrity = 'error';
  }

  json(res, result);
}

async function handleSetup(req, res) {
  try {
    const body = await parseBody(req);
    const { apiKey, anthropicApiKey, authensorToken, applyPolicy, provider } = body;

    // apiKey is the new field name; anthropicApiKey is backward-compatible
    const key = apiKey || anthropicApiKey;
    if (!key || !authensorToken) {
      return errorJson(res, 'Both apiKey and authensorToken are required');
    }

    // Resolve provider-specific settings
    const isOpenAI = provider === 'openai';
    const keyEnvName = isOpenAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
    const defaultModel = isOpenAI ? 'gpt-4o' : '';

    // Write API key to .env (never stored in config.json)
    writeEnvVar(keyEnvName, key);

    // Create/update profile
    const cfg = loadConfig();
    const profileName = cfg.activeProfile || 'default';
    const profile = ensureProfile(cfg, profileName);
    profile.authToken = authensorToken;
    profile.provider = {
      name: isOpenAI ? 'openai' : 'claude',
      apiKeyEnv: keyEnvName,
      model: defaultModel,
    };
    setActiveProfile(cfg, profileName);
    saveConfig(cfg);

    // Ensure default policy file exists
    ensurePolicyFile(profile.policy.path);

    // Optionally apply policy to control plane
    if (applyPolicy !== false) {
      try {
        const policy = loadPolicy(profile.policy.path);
        const client = new AuthensorClient({
          controlPlaneUrl: profile.controlPlane,
          authToken: profile.authToken,
        });
        const policyRes = await client.createPolicy(policy);
        const policyId = policyRes.policyId || policyRes.id || policy.id;
        const version = policyRes.version || policy.version;
        await client.setActivePolicy(policyId, version);
        profile.policy.id = policyId;
        saveConfig(cfg);
      } catch (policyErr) {
        return json(res, { ok: true, policyApplied: false, policyError: policyErr.message });
      }
    }

    json(res, { ok: true, policyApplied: applyPolicy !== false });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handleTaskStart(req, res) {
  try {
    const body = await parseBody(req);
    const { task, container, workspace, model } = body;
    if (!task) throw new ValidationError('task is required');

    const profile = getProfileOrNull();
    if (!profile) throw new ValidationError('No profile configured');

    const keyEnv = profile.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
    if (!process.env[keyEnv]) {
      return errorJson(res, `Missing API key. Complete setup first.`, 400);
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // If a task is already running, queue this one
    if (activeTask) {
      taskQueue.push({ id: taskId, task, container: !!container, workspace: workspace || '', model: model || '', addedAt: new Date().toISOString() });
      eventBus.emit('global', { type: 'queue:updated', data: { queueLength: taskQueue.length } });
      return json(res, { taskId, queued: true, position: taskQueue.length }, 202);
    }

    // Start immediately
    startTaskExecution(taskId, task, container, workspace, model, profile);
    json(res, { taskId });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function startTaskExecution(taskId, task, container, workspace, model, profile) {
  // Budget enforcement — check before starting task
  try {
    const budgetStatus = checkBudget();
    if (budgetStatus.exceeded) {
      if (budgetStatus.action === 'block') {
        // Emit done event so SSE clients know the task was blocked
        eventBus.emit(`task:${taskId}`, { type: 'agent:done', data: { error: `Budget limit exceeded. Task blocked.` } });
        processQueue();
        return;
      }
      sendWebhook('budget_warning', {
        currentUsd: budgetStatus.currentUsd,
        limitUsd: budgetStatus.limitUsd,
        percentUsed: budgetStatus.percentUsed,
      }).catch(() => {});
    }
  } catch {
    // Budget check failure must never block task start
  }

  // Apply per-task model override (does NOT persist to config)
  const taskProfile = JSON.parse(JSON.stringify(profile));
  if (model) {
    taskProfile.provider = { ...taskProfile.provider, model };
  }

  const cfg = loadConfig();
  const abortController = new AbortController();

  activeTask = { id: taskId, status: 'running', startedAt: new Date().toISOString(), abortController };

  // Session accumulator — records transcript for history
  const session = {
    id: taskId,
    task,
    provider: taskProfile.provider?.name || 'claude',
    model: taskProfile.provider?.model || '',
    profile: cfg.activeProfile || 'default',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    cost: null,
    error: null,
    messages: [],
    toolCalls: [],
  };

  const sessionListener = (event) => {
    if (event.type === 'agent:text' && session.messages.length < 200) {
      session.messages.push({ type: 'text', text: event.data?.text || '', timestamp: new Date().toISOString() });
    }
    if (event.type === 'agent:tool_call' && session.toolCalls.length < 200) {
      session.toolCalls.push({
        toolName: event.data?.toolName || event.data?.tool || '',
        inputSummary: event.data?.inputSummary || event.data?.input || '',
        timestamp: new Date().toISOString(),
      });
    }
    if (event.type === 'agent:done') {
      session.cost = event.data?.cost || null;
    }
  };
  eventBus.on(`task:${taskId}`, sessionListener);

  // Choose runner: container mode or direct agent
  let agentPromise;
  if (container) {
    agentPromise = import('./container.js').then(m =>
      m.runContainerAgent({ task, profile: taskProfile, verbose: false, emitter: eventBus, taskId, workspace: workspace || process.cwd() })
    );
  } else {
    agentPromise = runAgent({ task, profile: taskProfile, verbose: false, emitter: eventBus, taskId });
  }

  agentPromise
    .then(() => {
      session.finishedAt = new Date().toISOString();
      session.status = 'success';
      try { saveSession(session); } catch {}
      sendWebhook('task_completed', { task, taskId, cost: session.cost }).catch(() => {});
      try {
        const postBudget = checkBudget();
        if (postBudget.exceeded) {
          sendWebhook('budget_exceeded', { currentUsd: postBudget.currentUsd, limitUsd: postBudget.limitUsd }).catch(() => {});
        }
      } catch {}
      eventBus.removeListener(`task:${taskId}`, sessionListener);
      if (activeTask?.id === taskId) activeTask = null;
      processQueue();
    })
    .catch((err) => {
      session.finishedAt = new Date().toISOString();
      session.status = 'error';
      session.error = err?.message || 'Unknown error';
      try { saveSession(session); } catch {}
      sendWebhook('task_failed', { task, taskId, error: session.error }).catch(() => {});
      eventBus.removeListener(`task:${taskId}`, sessionListener);
      if (activeTask?.id === taskId) activeTask = null;
      processQueue();
    });
}

function processQueue() {
  if (activeTask) return;
  if (taskQueue.length === 0) return;

  const next = taskQueue.shift();
  eventBus.emit('global', { type: 'queue:updated', data: { queueLength: taskQueue.length } });

  const profile = getProfileOrNull();
  if (!profile) return;

  startTaskExecution(next.id, next.task, next.container, next.workspace, next.model, profile);
}

function handleTaskStream(req, res, taskId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write(': connected\n\n');

  // Track SSE connection for graceful shutdown
  if (sseConnections) sseConnections.add(res);

  const listener = (event) => {
    // Redact secrets from agent text before sending to browser
    const data = event.data ? { ...event.data } : {};
    if (data.text) data.text = redactSecrets(data.text);
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (event.type === 'agent:done') {
      res.end();
    }
  };

  eventBus.on(`task:${taskId}`, listener);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    eventBus.removeListener(`task:${taskId}`, listener);
    clearInterval(heartbeat);
    if (sseConnections) sseConnections.delete(res);
  });
}

function handleTaskStop(req, res, taskId) {
  if (!activeTask || activeTask.id !== taskId) {
    throw new NotFoundError('Task not found or not running');
  }
  activeTask.abortController.abort();
  activeTask = null;
  json(res, { ok: true });
}

async function handleApprovalsList(req, res) {
  const profile = getProfileOrNull();
  if (!profile) return json(res, { items: [] });

  const client = new AuthensorClient({
    controlPlaneUrl: profile.controlPlane,
    authToken: profile.authToken,
  });

  try {
    const result = await client.listPendingApprovals();
    json(res, result);
  } catch (err) {
    errorJson(res, err.message, 502);
  }
}

async function handleApprovalAction(req, res, id) {
  try {
    const body = await parseBody(req);
    const { action } = body;
    if (!action || !['approve', 'reject'].includes(action)) {
      throw new ValidationError('action must be "approve" or "reject"');
    }

    const profile = getProfileOrNull();
    if (!profile) throw new ValidationError('No profile configured');

    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });

    const status = action === 'approve' ? 'approved' : 'rejected';
    await client.resolveApproval(id, status);
    json(res, { ok: true, id, status });
  } catch (err) {
    errorJson(res, err.message, 502);
  }
}

async function handleReceipts(req, res) {
  const profile = getProfileOrNull();
  if (!profile) return json(res, { items: [] });

  const client = new AuthensorClient({
    controlPlaneUrl: profile.controlPlane,
    authToken: profile.authToken,
  });

  try {
    const result = await client.listReceipts();
    json(res, result);
  } catch (err) {
    errorJson(res, err.message, 502);
  }
}

function handleGlobalSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(': connected\n\n');

  // Track SSE connection for graceful shutdown
  if (sseConnections) sseConnections.add(res);

  const listener = (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data || {})}\n\n`);
  };

  eventBus.on('global', listener);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    eventBus.removeListener('global', listener);
    clearInterval(heartbeat);
    if (sseConnections) sseConnections.delete(res);
  });
}

function handlePolicyGet(req, res) {
  const profile = getProfileOrNull();
  if (!profile || !profile.policy?.path) {
    return json(res, { error: 'No policy file configured' }, 400);
  }
  try {
    const policy = loadPolicy(profile.policy.path);
    json(res, policy);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyApply(req, res) {
  const profile = getProfileOrNull();
  if (!profile) return errorJson(res, 'No profile configured', 400);

  try {
    const cfg = loadConfig();
    const policy = loadPolicy(profile.policy.path);
    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });
    const policyRes = await client.createPolicy(policy);
    const policyId = policyRes.policyId || policyRes.id || policy.id;
    const version = policyRes.version || policy.version;
    await client.setActivePolicy(policyId, version);
    profile.policy.id = policyId;
    saveConfig(cfg);
    json(res, { ok: true, policyId, version });
  } catch (err) {
    errorJson(res, err.message, 502);
  }
}

async function handleProvisionDemo(req, res) {
  try {
    const body = await parseBody(req);
    const installId = body.installId || `safeclaw_${Date.now()}`;

    const client = new AuthensorClient({
      controlPlaneUrl: 'https://authensor-control-plane.onrender.com',
    });

    const result = await client.provisionDemo(installId);
    if (!result) {
      // Endpoint not yet available — return fallback info
      return json(res, {
        available: false,
        formUrl: 'https://forms.gle/QdfeWAr2G4pc8GxQA',
      });
    }

    json(res, { available: true, token: result.token, expiresAt: result.expiresAt });
  } catch (err) {
    errorJson(res, err.message, 502);
  }
}

// --- Doctor handler ---

async function handleDoctor(req, res) {
  try {
    const { runDiagnostics } = await import('./doctor.js');
    const checks = await runDiagnostics();
    json(res, { checks });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Audit handlers ---

function handleAuditVerify(req, res) {
  try {
    const result = verifyAuditIntegrity();
    json(res, result);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleAuditList(req, res, url) {
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const actionType = url.searchParams.get('actionType') || undefined;
  const outcome = url.searchParams.get('outcome') || undefined;
  const entries = readEntries({ limit, filter: { actionType, outcome } });
  json(res, { entries });
}

function handleAuditRotate(req, res) {
  rotateLog();
  json(res, { ok: true });
}

// --- Session handlers ---

function handleSessionsList(req, res, url) {
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const sessions = listSessions({ limit });
  json(res, { sessions });
}

function handleSessionGet(req, res, sessionId) {
  const session = loadSession(sessionId);
  if (!session) throw new NotFoundError('Session not found');
  json(res, session);
}

// --- Policy editor handlers ---

function handlePolicyRulesGet(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const policy = loadPolicy(profile.policy.path);
    json(res, {
      rules: policy.rules || [],
      defaultEffect: policy.defaultEffect,
      id: policy.id,
      version: policy.version,
      name: policy.name,
    });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyRuleAdd(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) throw new ValidationError('No policy configured');
  try {
    const body = await parseBody(req);
    const { effect, description, condition } = body;
    if (!effect || !condition) throw new ValidationError('effect and condition are required');

    const policy = loadPolicy(profile.policy.path);
    if (!policy.rules) policy.rules = [];
    const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newRule = { id: ruleId, effect, description: description || '', condition };
    policy.rules.push(newRule);
    savePolicy(profile.policy.path, policy);
    json(res, { ok: true, rule: newRule });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyRuleUpdate(req, res, ruleId) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const body = await parseBody(req);
    const policy = loadPolicy(profile.policy.path);
    const idx = (policy.rules || []).findIndex(r => r.id === ruleId);
    if (idx === -1) throw new NotFoundError('Rule not found');

    if (body.effect) policy.rules[idx].effect = body.effect;
    if (body.description !== undefined) policy.rules[idx].description = body.description;
    if (body.condition) policy.rules[idx].condition = body.condition;

    savePolicy(profile.policy.path, policy);
    json(res, { ok: true, rule: policy.rules[idx] });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyRuleDelete(req, res, ruleId) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const policy = loadPolicy(profile.policy.path);
    const idx = (policy.rules || []).findIndex(r => r.id === ruleId);
    if (idx === -1) throw new NotFoundError('Rule not found');

    policy.rules.splice(idx, 1);
    savePolicy(profile.policy.path, policy);
    json(res, { ok: true });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handlePolicyTemplates(req, res) {
  const templatesDir = path.join(__dirname, '..', 'policies');
  try {
    const files = fs.readdirSync(templatesDir)
      .filter(f => f.endsWith('.json') && f !== 'policy.schema.json');
    const templates = files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf-8'));
      return { filename: f, id: content.id, name: content.name || content.id, ruleCount: (content.rules || []).length };
    });
    json(res, { templates });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyLoadTemplate(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const body = await parseBody(req);
    if (!body.template) throw new ValidationError('template filename is required');
    const templatesDir = path.join(__dirname, '..', 'policies');
    const templatePath = path.join(templatesDir, body.template);
    // Path traversal prevention — resolved path must stay within templates directory
    if (!path.resolve(templatePath).startsWith(path.resolve(templatesDir) + path.sep) &&
        path.resolve(templatePath) !== path.resolve(templatesDir)) {
      return errorJson(res, 'Forbidden', 403);
    }
    if (!fs.existsSync(templatePath)) throw new NotFoundError('Template not found');
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
    savePolicy(profile.policy.path, template);
    json(res, { ok: true, policy: template });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Policy versioning + simulation handlers ---

function handlePolicyVersions(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const versions = listPolicyVersions(profile.policy.path);
    json(res, { versions });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicyRollback(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const body = await parseBody(req);
    if (!body.version) throw new ValidationError('version is required');
    const result = rollbackPolicy(profile.policy.path, body.version);
    if (!result) throw new NotFoundError('Version not found');
    json(res, { ok: true, policy: result });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handlePolicySimulate(req, res) {
  const profile = getProfileOrNull();
  if (!profile?.policy?.path) return errorJson(res, 'No policy configured', 400);
  try {
    const body = await parseBody(req);
    if (!body.actionType) throw new ValidationError('actionType is required');
    const policy = loadPolicy(profile.policy.path);
    const result = simulatePolicy(policy, body.actionType, body.resource || '');
    json(res, result);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Profile handlers ---

function handleProfilesList(req, res) {
  const cfg = loadConfig();
  json(res, {
    profiles: Object.keys(cfg.profiles || {}),
    active: cfg.activeProfile || 'default',
  });
}

async function handleProfileSwitch(req, res) {
  try {
    const body = await parseBody(req);
    const { name } = body;
    if (!name) throw new ValidationError('name is required');

    const cfg = loadConfig();
    if (!cfg.profiles || !cfg.profiles[name]) {
      throw new NotFoundError('Profile not found');
    }
    setActiveProfile(cfg, name);
    saveConfig(cfg);
    loadDotEnv(); // reload env for new profile
    json(res, { ok: true, active: name });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Config handlers ---

function handleConfigGet(req, res) {
  const cfg = loadConfig();
  const result = getProfile(cfg);
  const profile = result ? result.profile : null;
  const keyEnv = profile?.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
  json(res, {
    provider: profile?.provider?.name || 'claude',
    apiKeyEnv: keyEnv,
    hasApiKey: !!process.env[keyEnv],
    hasAuthToken: !!(profile && profile.authToken),
    controlPlane: profile?.controlPlane || '',
  });
}

async function handleConfigUpdate(req, res) {
  try {
    const body = await parseBody(req);
    const { provider, apiKey, authToken } = body;

    if (provider && !['claude', 'openai'].includes(provider)) {
      throw new ValidationError('provider must be "claude" or "openai"');
    }

    const cfg = loadConfig();
    const profileName = cfg.activeProfile || 'default';
    const profile = ensureProfile(cfg, profileName);

    if (provider) {
      const isOpenAI = provider === 'openai';
      profile.provider = {
        name: provider,
        apiKeyEnv: isOpenAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY',
        model: isOpenAI ? 'gpt-4o' : '',
      };
    }

    if (apiKey) {
      const keyEnv = profile.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
      writeEnvVar(keyEnv, apiKey);
    }

    if (authToken) {
      profile.authToken = authToken;
    }

    saveConfig(cfg);
    json(res, { ok: true });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- SMS config handlers ---

function handleSmsGet(req, res) {
  const hasSid = !!process.env.TWILIO_ACCOUNT_SID;
  const hasToken = !!process.env.TWILIO_AUTH_TOKEN;
  const hasFrom = !!process.env.TWILIO_FROM_NUMBER;
  const hasPhone = !!process.env.SAFECLAW_NOTIFY_PHONE;
  const phone = process.env.SAFECLAW_NOTIFY_PHONE || '';
  json(res, {
    configured: hasSid && hasToken && hasFrom && hasPhone,
    hasSid,
    hasToken,
    hasFrom,
    hasPhone,
    maskedPhone: phone.length > 4 ? '***' + phone.slice(-4) : '',
  });
}

async function handleSmsUpdate(req, res) {
  try {
    const body = await parseBody(req);
    const { sid, token, fromNumber, notifyPhone } = body;

    if (sid) writeEnvVar('TWILIO_ACCOUNT_SID', sid);
    if (token) writeEnvVar('TWILIO_AUTH_TOKEN', token);
    if (fromNumber) writeEnvVar('TWILIO_FROM_NUMBER', fromNumber);
    if (notifyPhone) writeEnvVar('SAFECLAW_NOTIFY_PHONE', notifyPhone);

    json(res, { ok: true });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Settings handlers ---

function handleSettingsGet(req, res) {
  json(res, loadSettings());
}

async function handleSettingsUpdate(req, res) {
  const body = await parseBody(req);
  const validation = validateSettings(body);
  if (!validation.valid) {
    return errorJson(res, validation.errors.join('; '));
  }
  saveSettings(body);
  json(res, { ok: true });
}

// --- Budget handler ---

function handleBudgetStatus(req, res) {
  try {
    const status = checkBudget();
    json(res, status);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- MCP handlers ---

function handleAnalyticsMcp(req, res) {
  try {
    const data = computeMcpUsage();
    json(res, data);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleMcpServers(req, res) {
  try {
    const servers = getKnownMcpServers();
    json(res, { servers });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Analytics handlers ---

function handleAnalyticsCost(req, res, url) {
  const period = url.searchParams.get('period') || 'day';
  try {
    const data = computeCostSummary(period);
    json(res, data);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleAnalyticsApprovals(req, res) {
  try {
    const data = computeApprovalMetrics();
    json(res, data);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleAnalyticsTools(req, res) {
  try {
    const data = computeToolUsage();
    json(res, data);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleExportAudit(req, res, url) {
  const format = url.searchParams.get('format') || 'json';
  try {
    const data = exportAudit(format);
    if (format === 'csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="safeclaw-audit.csv"',
      });
      res.end(data);
    } else {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="safeclaw-audit.json"',
      });
      res.end(data);
    }
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Task queue handlers ---

function handleTaskQueue(req, res) {
  json(res, { queue: taskQueue.map(t => ({ id: t.id, task: t.task, addedAt: t.addedAt })) });
}

function handleTaskQueueRemove(req, res, queueTaskId) {
  const idx = taskQueue.findIndex(t => t.id === queueTaskId);
  if (idx === -1) throw new NotFoundError('Task not found in queue');
  taskQueue.splice(idx, 1);
  eventBus.emit('global', { type: 'queue:updated', data: { queueLength: taskQueue.length } });
  json(res, { ok: true });
}

// --- Config export/import handlers ---

function handleExportConfig(req, res) {
  try {
    const cfg = loadConfig();
    const settings = loadSettings();
    const profile = getProfileOrNull();
    let policy = null;
    if (profile?.policy?.path) {
      try { policy = loadPolicy(profile.policy.path); } catch {}
    }

    // List which env vars are set (but never expose values)
    const envVarsSet = [];
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'SAFECLAW_NOTIFY_PHONE']) {
      if (process.env[key]) envVarsSet.push(key);
    }

    // Deep-clone config and redact secrets before export
    const safeCfg = JSON.parse(JSON.stringify(cfg));
    for (const name of Object.keys(safeCfg.profiles || {})) {
      if (safeCfg.profiles[name].authToken) safeCfg.profiles[name].authToken = '***REDACTED***';
    }

    const backup = {
      version: '1.0.0-beta',
      exportedAt: new Date().toISOString(),
      config: safeCfg,
      settings,
      policy,
      envVarsSet,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="safeclaw-backup.json"',
    });
    res.end(JSON.stringify(backup, null, 2));
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handleImportConfig(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.version) throw new ValidationError('Invalid backup: missing version');
    if (!body.config && !body.settings && !body.policy) {
      throw new ValidationError('Backup must contain at least one of: config, settings, policy');
    }

    const imported = [];

    if (body.config) {
      // Validate critical fields to prevent control plane hijacking
      if (body.config.controlPlane && typeof body.config.controlPlane === 'string') {
        if (!/^https?:\/\//i.test(body.config.controlPlane)) {
          throw new ValidationError('Invalid controlPlane URL');
        }
      }
      if (body.config.profiles) {
        for (const [name, profile] of Object.entries(body.config.profiles)) {
          if (profile.controlPlane && !/^https?:\/\//i.test(profile.controlPlane)) {
            throw new ValidationError(`Invalid controlPlane URL in profile "${name}"`);
          }
        }
      }
      saveConfig(body.config);
      loadDotEnv();
      imported.push('config');
    }

    if (body.settings) {
      const validation = validateSettings(body.settings);
      if (!validation.valid) {
        return errorJson(res, 'Invalid settings: ' + validation.errors.join('; '));
      }
      saveSettings(body.settings);
      imported.push('settings');
    }

    if (body.policy) {
      const profile = getProfileOrNull();
      if (profile?.policy?.path) {
        savePolicy(profile.policy.path, body.policy);
        imported.push('policy');
      }
    }

    json(res, { ok: true, imported });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Schedule handlers ---

function handleSchedulesList(req, res) {
  try {
    json(res, { schedules: getSchedules() });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handleScheduleCreate(req, res) {
  try {
    const body = await parseBody(req);
    if (!body.task || !body.cron) throw new ValidationError('task and cron are required');
    // Validate cron syntax
    try { parseCron(body.cron); } catch (e) { return errorJson(res, 'Invalid cron: ' + e.message); }

    const entry = addSchedule({
      task: body.task,
      cron: body.cron,
      container: body.container,
      model: body.model,
      quietHoursStart: body.quietHoursStart,
      quietHoursEnd: body.quietHoursEnd,
    });
    json(res, { ok: true, schedule: entry }, 201);
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

async function handleScheduleUpdate(req, res, scheduleId) {
  try {
    const body = await parseBody(req);
    if (body.cron) {
      try { parseCron(body.cron); } catch (e) { return errorJson(res, 'Invalid cron: ' + e.message); }
    }
    const updated = updateSchedule(scheduleId, body);
    if (!updated) throw new NotFoundError('Schedule not found');
    json(res, { ok: true, schedule: updated });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

function handleScheduleDelete(req, res, scheduleId) {
  try {
    const removed = removeSchedule(scheduleId);
    if (!removed) throw new NotFoundError('Schedule not found');
    json(res, { ok: true });
  } catch (err) {
    errorJson(res, err.message, err.statusCode || 500);
  }
}

// --- Scheduler tick ---

let schedulerInterval = null;

function checkSchedules() {
  try {
    const schedules = getSchedules();
    const now = new Date();

    for (const s of schedules) {
      if (!s.enabled || !s.nextRunAt) continue;
      if (isQuietHours(s, now)) continue;
      if (now < new Date(s.nextRunAt)) continue;

      // Time to run this schedule
      const profile = getProfileOrNull();
      if (!profile) continue;

      const taskId = `sched_${s.id}_${Date.now()}`;

      if (activeTask) {
        // Queue it
        taskQueue.push({ id: taskId, task: s.task, container: !!s.container, workspace: '', model: s.model || '', addedAt: now.toISOString() });
        eventBus.emit('global', { type: 'queue:updated', data: { queueLength: taskQueue.length } });
      } else {
        startTaskExecution(taskId, s.task, s.container, '', s.model, profile);
      }

      // Update schedule
      const next = nextCronRun(s.cron, now);
      updateSchedule(s.id, {
        lastRunAt: now.toISOString(),
        lastRunStatus: 'triggered',
        nextRunAt: next ? next.toISOString() : null,
      });

      eventBus.emit('global', { type: 'schedule:triggered', data: { scheduleId: s.id, task: s.task, taskId } });
    }
  } catch {
    // Scheduler tick must never crash the server
  }
}

export function startSchedulerTick() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(checkSchedules, 60000);
}

export function stopSchedulerTick() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// --- Browser opener ---

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') execFile('open', [url], () => {});
  else if (platform === 'win32') exec(`start "" "${url}"`, () => {}); // Windows start requires shell
  else execFile('xdg-open', [url], () => {});
}

// SSE connection tracking for graceful shutdown
let sseConnections = null;

// --- Server start ---

function tryListen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

export async function startServer({ open = true } = {}) {
  // Load .env before anything else
  loadDotEnv();

  // Initialize SSE connection tracking
  sseConnections = new Set();

  const host = '127.0.0.1';
  const server = http.createServer(handleRequest);

  let port = DEFAULT_PORT;
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    try {
      await tryListen(server, port + i, host);
      port = port + i;
      break;
    } catch (err) {
      if (err.code === 'EADDRINUSE' && i < MAX_PORT_TRIES - 1) continue;
      throw err;
    }
  }

  const url = `http://${host}:${port}`;
  logger.info('SafeClaw dashboard running', { url, port });
  console.log(`SafeClaw dashboard running at ${url}`);
  console.log('Press Ctrl+C to stop\n');

  if (open) openBrowser(url);

  // Start scheduler tick (checks every 60s for due schedules)
  startSchedulerTick();

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down gracefully...');
    stopSchedulerTick();
    for (const conn of sseConnections) {
      try { conn.end(); } catch {}
    }
    sseConnections.clear();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Expose cleanup for tests — removes signal listeners when server is closed externally
  server.on('close', () => {
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  });

  return { server, port, url, sseConnections };
}

// Auto-start when run directly (e.g. double-click launcher)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/server.js') || process.argv[1].endsWith('\\server.js')
);
if (isDirectRun) {
  startServer().catch(err => {
    console.error('Failed to start:', err.message || err);
    process.exit(1);
  });
}
