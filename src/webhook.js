// Webhook notifications — fire-and-forget POST to configured URL.
// Supports Slack, Discord, and generic JSON formats.
// 2 retries with 2s delay on 5xx/network errors.

import { loadSettings } from './settings.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/**
 * Send a webhook notification.
 * @param {string} event One of: approval_required, approval_resolved, task_completed, task_failed
 * @param {object} payload Event-specific data
 * @param {{ url?: string, events?: string[] }} [overrides] Override settings (for testing)
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendWebhook(event, payload, overrides) {
  let url, events;

  if (overrides) {
    url = overrides.url;
    events = overrides.events;
  } else {
    try {
      const settings = loadSettings();
      const wh = settings.notifyChannels?.webhook;
      url = wh?.url;
      events = wh?.events;
    } catch {
      return false;
    }
  }

  if (!url) return false;

  // Check if this event type is enabled
  if (events && events.length > 0 && !events.includes(event)) return false;

  const body = formatPayload(url, event, payload);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) return true;

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return false;
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return false;
    }
  }

  return false;
}

/**
 * Format the payload based on the webhook URL.
 */
function formatPayload(url, event, data) {
  const message = formatMessage(event, data);

  if (url.includes('hooks.slack.com')) {
    return { text: message };
  }

  if (url.includes('discord.com/api/webhooks')) {
    return { content: message };
  }

  return { event, timestamp: new Date().toISOString(), data };
}

function formatMessage(event, data) {
  switch (event) {
    case 'approval_required':
      return `[SafeClaw] Approval required: ${data.actionType || 'unknown'} on ${data.resource || 'unknown'} (receipt: ${data.receiptId || 'n/a'})`;
    case 'approval_resolved':
      return `[SafeClaw] Approval ${data.approved ? 'approved' : 'rejected'}: ${data.receiptId || 'n/a'}`;
    case 'task_completed':
      return `[SafeClaw] Task completed: ${(data.task || '').slice(0, 100)}`;
    case 'task_failed':
      return `[SafeClaw] Task failed: ${data.error || 'unknown error'}`;
    default:
      return `[SafeClaw] ${event}: ${JSON.stringify(data).slice(0, 200)}`;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
