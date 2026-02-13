// Analytics module -computes cost, approval, and tool usage metrics
// from existing audit.jsonl and session files. No new data storage needed.

import { readEntries } from './audit.js';
import { listSessions } from './session.js';

/**
 * Cost summary by provider and time period.
 * @param {'day'|'week'|'month'} period
 * @param {string} [sessionsDir] Override (for testing)
 * @returns {{ total: number, byProvider: object, byPeriod: Array }}
 */
export function computeCostSummary(period = 'day', sessionsDir) {
  const sessions = listSessions({ limit: 1000 }, sessionsDir);
  let total = 0;
  const byProvider = {};
  const periodMap = {};

  for (const s of sessions) {
    const cost = parseFloat(s.cost) || 0;
    total += cost;

    const provider = s.provider || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + cost;

    const label = periodLabel(s.startedAt, period);
    if (label) {
      periodMap[label] = (periodMap[label] || 0) + cost;
    }
  }

  const byPeriod = Object.entries(periodMap)
    .map(([label, cost]) => ({ label, cost }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return { total, byProvider, byPeriod };
}

/**
 * Approval metrics from audit entries.
 * @param {string} [auditPath] Override (for testing)
 * @returns {{ total: number, allowed: number, denied: number, requireApproval: number, approvalRate: number, topActions: Array }}
 */
export function computeApprovalMetrics(auditPath) {
  const entries = readEntries({ limit: 10000 }, auditPath);
  let allowed = 0, denied = 0, requireApproval = 0;
  const actionCounts = {};

  for (const e of entries) {
    if (e.outcome === 'allow') allowed++;
    else if (e.outcome === 'deny') denied++;
    else if (e.outcome === 'require_approval') requireApproval++;

    if (e.actionType) {
      actionCounts[e.actionType] = (actionCounts[e.actionType] || 0) + 1;
    }
  }

  const total = entries.length;
  const approvalRate = total > 0 ? allowed / total : 0;

  const topActions = Object.entries(actionCounts)
    .map(([actionType, count]) => ({ actionType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { total, allowed, denied, requireApproval, approvalRate, topActions };
}

/**
 * Tool usage frequency from audit entries.
 * @param {string} [auditPath] Override (for testing)
 * @returns {Array<{ toolName: string, count: number, allowRate: number }>}
 */
export function computeToolUsage(auditPath) {
  const entries = readEntries({ limit: 10000 }, auditPath);
  const tools = {};

  for (const e of entries) {
    const name = e.toolName || 'unknown';
    if (!tools[name]) tools[name] = { total: 0, allowed: 0 };
    tools[name].total++;
    if (e.outcome === 'allow') tools[name].allowed++;
  }

  return Object.entries(tools)
    .map(([toolName, { total, allowed }]) => ({
      toolName,
      count: total,
      allowRate: total > 0 ? allowed / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Export audit entries in CSV or JSON format.
 * @param {'csv'|'json'} format
 * @param {string} [auditPath] Override (for testing)
 * @returns {string}
 */
export function exportAudit(format = 'json', auditPath) {
  const entries = readEntries({ limit: 100000 }, auditPath);
  // readEntries returns newest-first; export chronologically (oldest-first)
  entries.reverse();

  if (format === 'json') return JSON.stringify(entries, null, 2);

  // CSV
  const fields = ['timestamp', 'toolName', 'actionType', 'resource', 'outcome', 'receiptId', 'taskId', 'profile', 'source'];
  const header = fields.join(',');
  const rows = entries.map(e =>
    fields.map(f => csvEscape(String(e[f] || ''))).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * MCP server usage breakdown from audit entries.
 * MCP action types follow the pattern mcp.{server}.{action}.
 * @param {string} [auditPath] Override (for testing)
 * @returns {Array<{ server: string, totalCalls: number, actions: Array<{ action: string, count: number }>, allowRate: number }>}
 */
export function computeMcpUsage(auditPath) {
  const entries = readEntries({ limit: 10000 }, auditPath);
  const servers = {};

  for (const e of entries) {
    if (!e.actionType || !e.actionType.startsWith('mcp.')) continue;

    // Parse mcp.{server}.{action}
    const parts = e.actionType.split('.');
    if (parts.length < 3) continue;
    const server = parts[1];
    const action = parts.slice(2).join('.');

    if (!servers[server]) servers[server] = { total: 0, allowed: 0, actions: {} };
    servers[server].total++;
    if (e.outcome === 'allow') servers[server].allowed++;
    servers[server].actions[action] = (servers[server].actions[action] || 0) + 1;
  }

  return Object.entries(servers)
    .map(([server, data]) => ({
      server,
      totalCalls: data.total,
      actions: Object.entries(data.actions)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count),
      allowRate: data.total > 0 ? data.allowed / data.total : 0,
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);
}

/**
 * Get unique MCP server names from audit log.
 * @param {string} [auditPath] Override (for testing)
 * @returns {string[]}
 */
export function getKnownMcpServers(auditPath) {
  const entries = readEntries({ limit: 10000 }, auditPath);
  const servers = new Set();

  for (const e of entries) {
    if (!e.actionType || !e.actionType.startsWith('mcp.')) continue;
    const parts = e.actionType.split('.');
    if (parts.length >= 3) servers.add(parts[1]);
  }

  return [...servers].sort();
}

// --- Helpers ---

function periodLabel(isoTimestamp, period) {
  if (!isoTimestamp) return null;
  const date = isoTimestamp.slice(0, 10); // YYYY-MM-DD
  if (period === 'day') return date;
  if (period === 'month') return date.slice(0, 7); // YYYY-MM
  if (period === 'week') {
    // ISO week: use the Monday of the week
    const d = new Date(isoTimestamp);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setUTCDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  return date;
}

function csvEscape(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
