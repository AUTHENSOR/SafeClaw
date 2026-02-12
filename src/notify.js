// SMS notifications via Twilio for risky actions.
// Sends a text message when an action requires approval.
// Configure via environment variables:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, SAFECLAW_NOTIFY_PHONE

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Check if SMS notifications are configured.
 */
export function isNotifyConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER &&
    process.env.SAFECLAW_NOTIFY_PHONE
  );
}

/**
 * Send an SMS notification for an action requiring approval.
 *
 * @param {{ actionType: string, resource: string, receiptId: string, installId?: string }} opts
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendApprovalSMS({ actionType, resource, receiptId, installId }) {
  if (!isNotifyConfigured()) return false;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.SAFECLAW_NOTIFY_PHONE;

  // Truncate resource to keep SMS under 160 chars
  const shortResource = resource.length > 60 ? resource.slice(0, 57) + '...' : resource;
  const body = `[SafeClaw] Approval needed:\n${actionType}\n${shortResource}\nReceipt: ${receiptId}`;

  const url = `${TWILIO_API}/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      process.stderr.write(`[SafeClaw] SMS failed (${res.status}): ${text.slice(0, 100)}\n`);
      return false;
    }

    process.stderr.write(`[SafeClaw] SMS sent to ${to}\n`);
    return true;
  } catch (err) {
    // SMS failure should never block the approval flow
    process.stderr.write(`[SafeClaw] SMS error: ${err.message}\n`);
    return false;
  }
}
