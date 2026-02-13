// Scheduler module -cron-based recurring tasks stored in ~/.safeclaw/schedules.json.
// Zero external deps. Minimal cron parser supports: *, */N, literal numbers, ranges (1-5), lists (1,3,5).

import fs from 'fs';
import path from 'path';
import { configPaths } from './config.js';

const SCHEDULES_FILE = () => path.join(configPaths().CONFIG_DIR, 'schedules.json');

// --- Persistence ---

export function loadSchedules(filePath) {
  const p = filePath || SCHEDULES_FILE();
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).schedules || []; }
  catch { return []; }
}

export function saveSchedules(schedules, filePath) {
  const p = filePath || SCHEDULES_FILE();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ schedules }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

// --- Cron parsing ---

/**
 * Parse a single cron field into a set of matching values.
 * Supports: star, step (star-slash-N), literal N, ranges (N-M), lists (N,M,O).
 * @param {string} field - one cron field
 * @param {number} min - minimum value (0 for minute, 0 for hour, 1 for dom, 1 for month, 0 for dow)
 * @param {number} max - maximum value (59, 23, 31, 12, 6)
 * @returns {Set<number>}
 */
export function parseCronField(field, min, max) {
  const result = new Set();

  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '*') {
      for (let i = min; i <= max; i++) result.add(i);
    } else if (trimmed.includes('/')) {
      const [range, stepStr] = trimmed.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          [start, end] = range.split('-').map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) result.add(i);
    } else if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number);
      for (let i = a; i <= b; i++) result.add(i);
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n)) result.add(n);
    }
  }
  return result;
}

/**
 * Parse a 5-field cron expression.
 * @param {string} cronExpr - e.g. "0 star/6 * * *"
 * @returns {{ minute: Set, hour: Set, dom: Set, month: Set, dow: Set }}
 */
export function parseCron(cronExpr) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron expression must have exactly 5 fields');
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour:   parseCronField(parts[1], 0, 23),
    dom:    parseCronField(parts[2], 1, 31),
    month:  parseCronField(parts[3], 1, 12),
    dow:    parseCronField(parts[4], 0, 6),
  };
}

/**
 * Compute the next run time after `after` for the given cron expression.
 * Scans forward minute-by-minute up to 366 days.
 * @param {string} cronExpr
 * @param {Date} [after]
 * @returns {Date|null}
 */
export function nextCronRun(cronExpr, after) {
  const cron = parseCron(cronExpr);
  const start = after ? new Date(after) : new Date();
  // Advance to next minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const limit = new Date(start);
  limit.setDate(limit.getDate() + 366);

  const d = new Date(start);
  while (d < limit) {
    if (
      cron.month.has(d.getMonth() + 1) &&
      cron.dom.has(d.getDate()) &&
      cron.dow.has(d.getDay()) &&
      cron.hour.has(d.getHours()) &&
      cron.minute.has(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

/**
 * Check if current time falls in quiet hours window.
 * @param {{ quietHoursStart?: number, quietHoursEnd?: number }} schedule
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isQuietHours(schedule, now) {
  if (schedule.quietHoursStart == null || schedule.quietHoursEnd == null) return false;
  const hour = (now || new Date()).getHours();
  const start = schedule.quietHoursStart;
  const end = schedule.quietHoursEnd;
  if (start <= end) {
    // e.g. 9-17: quiet during 9..16
    return hour >= start && hour < end;
  }
  // Wraps midnight, e.g. 23-7: quiet during 23..6
  return hour >= start || hour < end;
}

// --- CRUD ---

export function addSchedule(opts, filePath) {
  const schedules = loadSchedules(filePath);
  const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const next = nextCronRun(opts.cron); // validates cron too
  const entry = {
    id,
    task: opts.task,
    cron: opts.cron,
    enabled: opts.enabled !== false,
    container: !!opts.container,
    model: opts.model || '',
    quietHoursStart: opts.quietHoursStart ?? null,
    quietHoursEnd: opts.quietHoursEnd ?? null,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: next ? next.toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  schedules.push(entry);
  saveSchedules(schedules, filePath);
  return entry;
}

export function removeSchedule(id, filePath) {
  const schedules = loadSchedules(filePath);
  const filtered = schedules.filter(s => s.id !== id);
  if (filtered.length === schedules.length) return false;
  saveSchedules(filtered, filePath);
  return true;
}

export function updateSchedule(id, patch, filePath) {
  const schedules = loadSchedules(filePath);
  const idx = schedules.findIndex(s => s.id === id);
  if (idx === -1) return null;
  Object.assign(schedules[idx], patch);
  // Recompute nextRunAt if cron changed
  if (patch.cron) {
    const next = nextCronRun(patch.cron);
    schedules[idx].nextRunAt = next ? next.toISOString() : null;
  }
  saveSchedules(schedules, filePath);
  return schedules[idx];
}

export function getSchedules(filePath) {
  const schedules = loadSchedules(filePath);
  // Recompute nextRunAt for each enabled schedule
  for (const s of schedules) {
    if (s.enabled && s.cron) {
      const after = s.lastRunAt ? new Date(s.lastRunAt) : new Date();
      const next = nextCronRun(s.cron, after);
      s.nextRunAt = next ? next.toISOString() : null;
    }
  }
  return schedules;
}
