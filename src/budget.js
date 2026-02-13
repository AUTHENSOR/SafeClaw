// Budget enforcement -track spend and enforce limits.
// Reads session history to compute current spend, compares against settings.
// Zero new npm dependencies.

import { listSessions } from './session.js';
import { loadSettings } from './settings.js';

// Hardcoded OpenAI pricing (USD per 1M tokens)
const OPENAI_PRICING = {
  'gpt-4o':      { input: 2.50,  output: 10.00 },
  'gpt-4o-mini': { input: 0.15,  output: 0.60 },
};
const DEFAULT_PRICING = OPENAI_PRICING['gpt-4o'];

/**
 * Estimate cost for an OpenAI API call based on token usage.
 * @param {{ prompt_tokens?: number, completion_tokens?: number }} usage
 * @param {string} model
 * @returns {number} Cost in USD
 */
export function estimateOpenAICost(usage, model) {
  if (!usage) return 0;
  const pricing = OPENAI_PRICING[model] || DEFAULT_PRICING;
  const inputCost = ((usage.prompt_tokens || 0) / 1_000_000) * pricing.input;
  const outputCost = ((usage.completion_tokens || 0) / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Compute total spend for the current budget period.
 * @param {string} [sessionsDir] Override sessions directory (for testing)
 * @returns {{ totalUsd: number, periodStart: string, periodEnd: string }}
 */
export function getCurrentSpend(sessionsDir) {
  const settings = loadSettings();
  const budget = settings.costBudget || {};
  const period = budget.period || 'daily';

  const now = new Date();
  const { start, end } = getPeriodBounds(now, period);

  const sessions = listSessions({ limit: 1000 }, sessionsDir);
  let totalUsd = 0;

  for (const s of sessions) {
    if (!s.startedAt || !s.cost) continue;
    const sessionDate = new Date(s.startedAt);
    if (sessionDate >= start && sessionDate < end) {
      totalUsd += typeof s.cost === 'number' ? s.cost : (parseFloat(s.cost) || 0);
    }
  }

  return {
    totalUsd,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

/**
 * Check whether the budget limit has been exceeded.
 * @param {string} [sessionsDir] Override sessions directory (for testing)
 * @param {object} [settingsOverride] Override settings (for testing)
 * @returns {{ exceeded: boolean, action: string, currentUsd: number, limitUsd: number, percentUsed: number, enabled: boolean }}
 */
export function checkBudget(sessionsDir, settingsOverride) {
  const settings = settingsOverride || loadSettings();
  const budget = settings.costBudget || {};

  if (!budget.enabled) {
    return { exceeded: false, action: 'none', currentUsd: 0, limitUsd: 0, percentUsed: 0, enabled: false };
  }

  const { totalUsd } = getCurrentSpend(sessionsDir);
  const limitUsd = budget.limitUsd || 10.00;
  const action = budget.action || 'warn';
  const percentUsed = limitUsd > 0 ? Math.min((totalUsd / limitUsd) * 100, 100) : 0;

  return {
    exceeded: totalUsd >= limitUsd,
    action,
    currentUsd: totalUsd,
    limitUsd,
    percentUsed,
    period: budget.period || 'daily',
    enabled: true,
  };
}

/**
 * Get period start/end bounds for budget calculation.
 */
function getPeriodBounds(now, period) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);

  if (period === 'weekly') {
    // Monday start
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (period === 'monthly') {
    start.setDate(1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 1);
  } else {
    // daily (default)
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}
