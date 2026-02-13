import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  parseCronField, parseCron, nextCronRun, isQuietHours,
  addSchedule, removeSchedule, updateSchedule, getSchedules,
  loadSchedules, saveSchedules,
} from '../src/scheduler.js';

// Use a temp dir for test schedule files
const tmpDir = path.join(os.tmpdir(), 'safeclaw-sched-test-' + Date.now());
const tmpFile = path.join(tmpDir, 'schedules.json');

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// --- parseCronField ---

describe('parseCronField', () => {
  it('star matches all values', () => {
    const result = parseCronField('*', 0, 59);
    expect(result.size).toBe(60);
    expect(result.has(0)).toBe(true);
    expect(result.has(59)).toBe(true);
  });

  it('literal number matches single value', () => {
    const result = parseCronField('5', 0, 59);
    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
  });

  it('step expression matches correct values', () => {
    const result = parseCronField('*/15', 0, 59);
    expect([...result].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it('range matches inclusive bounds', () => {
    const result = parseCronField('1-5', 0, 6);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('list matches multiple values', () => {
    const result = parseCronField('1,3,5', 0, 6);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });

  it('range with step works', () => {
    const result = parseCronField('0-10/3', 0, 59);
    expect([...result].sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);
  });
});

// --- parseCron ---

describe('parseCron', () => {
  it('parses a valid 5-field cron', () => {
    const cron = parseCron('0 9 * * 1-5');
    expect(cron.minute.has(0)).toBe(true);
    expect(cron.minute.size).toBe(1);
    expect(cron.hour.has(9)).toBe(true);
    expect(cron.dom.size).toBe(31); // * = 1-31
    expect(cron.month.size).toBe(12); // * = 1-12
    expect([...cron.dow].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws on invalid field count', () => {
    expect(() => parseCron('* *')).toThrow('5 fields');
    expect(() => parseCron('* * * * * *')).toThrow('5 fields');
  });

  it('parses every-6-hours correctly', () => {
    const cron = parseCron('0 */6 * * *');
    expect(cron.minute.has(0)).toBe(true);
    expect([...cron.hour].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
  });
});

// --- nextCronRun ---

describe('nextCronRun', () => {
  it('computes next minute for every-minute cron', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    const next = nextCronRun('* * * * *', now);
    expect(next).not.toBeNull();
    expect(next.getTime()).toBe(new Date('2026-02-10T12:01:00Z').getTime());
  });

  it('computes next run for specific hour', () => {
    const now = new Date('2026-02-10T08:00:00Z');
    const next = nextCronRun('0 9 * * *', now);
    expect(next).not.toBeNull();
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
  });

  it('next run is always after the given time', () => {
    const now = new Date('2026-02-10T10:00:00Z');
    const next = nextCronRun('0 9 * * *', now);
    expect(next).not.toBeNull();
    // Next run must be after now
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // And it should be at minute 0, hour 9 (local)
    expect(next.getMinutes()).toBe(0);
    expect(next.getHours()).toBe(9);
  });

  it('returns null for impossible cron (Feb 31)', () => {
    // Month 2, dom 31 -never happens
    const next = nextCronRun('0 0 31 2 *', new Date('2026-01-01'));
    expect(next).toBeNull();
  });
});

// --- isQuietHours ---

describe('isQuietHours', () => {
  it('returns false when no quiet hours set', () => {
    expect(isQuietHours({}, new Date())).toBe(false);
    expect(isQuietHours({ quietHoursStart: null }, new Date())).toBe(false);
  });

  it('returns true during quiet hours (non-wrapping)', () => {
    // Quiet 9-17: check at 12
    const schedule = { quietHoursStart: 9, quietHoursEnd: 17 };
    const noon = new Date('2026-02-10T12:00:00');
    expect(isQuietHours(schedule, noon)).toBe(true);
  });

  it('returns false outside quiet hours (non-wrapping)', () => {
    const schedule = { quietHoursStart: 9, quietHoursEnd: 17 };
    const morning = new Date('2026-02-10T07:00:00');
    expect(isQuietHours(schedule, morning)).toBe(false);
  });

  it('handles midnight-wrapping quiet hours', () => {
    // Quiet 23-7: check at 1am (should be quiet)
    const schedule = { quietHoursStart: 23, quietHoursEnd: 7 };
    const lateNight = new Date('2026-02-10T01:00:00');
    expect(isQuietHours(schedule, lateNight)).toBe(true);
  });

  it('returns false outside midnight-wrapping quiet hours', () => {
    const schedule = { quietHoursStart: 23, quietHoursEnd: 7 };
    const afternoon = new Date('2026-02-10T14:00:00');
    expect(isQuietHours(schedule, afternoon)).toBe(false);
  });
});

// --- CRUD ---

describe('Schedule CRUD', () => {
  it('addSchedule creates and persists a schedule', () => {
    const entry = addSchedule({ task: 'test task', cron: '0 9 * * *' }, tmpFile);
    expect(entry.id).toMatch(/^sched_/);
    expect(entry.task).toBe('test task');
    expect(entry.cron).toBe('0 9 * * *');
    expect(entry.enabled).toBe(true);
    expect(entry.nextRunAt).not.toBeNull();

    const loaded = loadSchedules(tmpFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].task).toBe('test task');
  });

  it('removeSchedule deletes by id', () => {
    const entry = addSchedule({ task: 'to remove', cron: '* * * * *' }, tmpFile);
    expect(removeSchedule(entry.id, tmpFile)).toBe(true);
    expect(loadSchedules(tmpFile)).toHaveLength(0);
  });

  it('removeSchedule returns false for unknown id', () => {
    addSchedule({ task: 'keep', cron: '* * * * *' }, tmpFile);
    expect(removeSchedule('nonexistent', tmpFile)).toBe(false);
    expect(loadSchedules(tmpFile)).toHaveLength(1);
  });

  it('updateSchedule patches fields', () => {
    const entry = addSchedule({ task: 'original', cron: '0 9 * * *' }, tmpFile);
    const updated = updateSchedule(entry.id, { enabled: false }, tmpFile);
    expect(updated.enabled).toBe(false);
    expect(updated.task).toBe('original');
  });

  it('updateSchedule returns null for unknown id', () => {
    expect(updateSchedule('nonexistent', { enabled: false }, tmpFile)).toBeNull();
  });

  it('getSchedules returns all with computed nextRunAt', () => {
    addSchedule({ task: 'a', cron: '0 9 * * *' }, tmpFile);
    addSchedule({ task: 'b', cron: '0 18 * * *' }, tmpFile);
    const schedules = getSchedules(tmpFile);
    expect(schedules).toHaveLength(2);
    for (const s of schedules) {
      expect(s.nextRunAt).not.toBeNull();
    }
  });

  it('loadSchedules returns empty for nonexistent file', () => {
    expect(loadSchedules('/tmp/nonexistent-schedules.json')).toEqual([]);
  });
});
