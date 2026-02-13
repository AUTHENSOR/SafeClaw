// PreToolUse hook that gates tool execution through the Authensor control plane.
// Only action descriptions leave the machine -never API keys or secrets.
// If the control plane is unreachable, fails closed (deny all).

import { classify, isSafeRead } from './classifier.js';
import { AuthensorClient } from './authensor.js';
import { isNotifyConfigured, sendApprovalSMS } from './notify.js';
import { appendEntry } from './audit.js';
import { cacheDecision, getCachedDecision } from './cache.js';
import { loadSettings } from './settings.js';
import { sendWebhook } from './webhook.js';

const POLL_INTERVAL_MS = 3000;

/**
 * Create the Authensor gateway hook for the Claude Agent SDK.
 *
 * @param {{ controlPlaneUrl: string, authToken: string, approvalTimeoutSeconds?: number, installId: string }} opts
 * @returns {Function} A PreToolUse hook callback
 */
export function createGatewayHook({ controlPlaneUrl, authToken, approvalTimeoutSeconds = 300, installId, emitter = null, taskId = null, profileName = null, workspaceConfig = null }) {
  const client = new AuthensorClient({ controlPlaneUrl, authToken });

  function emit(type, data) {
    if (emitter && taskId) {
      emitter.emit(`task:${taskId}`, { type, data });
    }
  }

  function audit(result, { toolName, actionType, resource, receiptId = null, source, riskSignals = [] }) {
    try {
      appendEntry({
        timestamp: new Date().toISOString(),
        toolName,
        actionType,
        resource,
        outcome: result.hookSpecificOutput.permissionDecision,
        receiptId,
        taskId: taskId || null,
        profile: profileName || 'unknown',
        source,
        riskSignals,
      });
    } catch {
      // Audit write failure must never block the gateway
    }
    return result;
  }

  /**
   * PreToolUse hook callback.
   * Intercepts every tool call, classifies it, and checks with Authensor.
   */
  async function gatewayHook(input, toolUseId, context) {
    const signal = context?.signal;
    const toolName = input.tool_name;
    const toolInput = input.tool_input;

    const { actionType, resource, riskSignals } = classify(toolName, toolInput);

    // Workspace path enforcement (before any other check)
    if (workspaceConfig && resource && isFilePathAction(actionType)) {
      const { isPathAllowed } = await import('./workspace.js');
      if (!isPathAllowed(resource, workspaceConfig)) {
        return audit(deny(`Path outside workspace: ${resource}`), {
          toolName, actionType, resource, riskSignals, source: 'workspace_deny',
        });
      }
    }

    // Local pre-filter: safe reads skip the control plane entirely (no network call)
    if (isSafeRead(actionType)) {
      return audit(allow(`Local pre-filter: ${actionType} is safe`), {
        toolName, actionType, resource, riskSignals, source: 'local_prefilter',
      });
    }

    // Build the Authensor action envelope -only metadata, never keys
    const envelope = {
      action: {
        type: actionType,
        resource,
      },
      principal: {
        type: 'agent',
        id: installId || 'anonymous',
      },
      timestamp: new Date().toISOString(),
    };

    let decision;
    try {
      decision = await client.evaluate(envelope, signal);
    } catch (err) {
      // Check offline cache before denying
      try {
        const settings = loadSettings();
        if (settings.offlineCacheEnabled) {
          const cached = getCachedDecision(actionType, resource);
          if (cached) {
            process.stderr.write(
              `[SafeClaw] Control plane unreachable. Using cached allow for: ${actionType} on ${resource}\n`
            );
            return audit(allow(`Offline cache hit: ${actionType} on ${resource}`), {
              toolName, actionType, resource, riskSignals, source: 'offline_cache',
            });
          }
        }
      } catch {
        // Settings/cache read failure -continue to deny
      }

      // Fail closed: control plane unreachable → deny everything
      process.stderr.write(
        `[SafeClaw] Control plane unreachable: ${err.message}. Denying action.\n`
      );
      return audit(deny(`Authensor control plane unreachable (fail-closed): ${err.message}`), {
        toolName, actionType, resource, riskSignals, source: 'fail_closed',
      });
    }

    const outcome = decision.outcome || decision.decisionOutcome || 'deny';
    const receiptId = decision.receiptId || decision.id;

    if (outcome === 'allow' || outcome === 'allowed') {
      // Cache the allow decision for offline resilience
      try {
        const settings = loadSettings();
        if (settings.offlineCacheEnabled) {
          cacheDecision(actionType, resource, 'allow', settings.offlineCacheTtlSeconds);
        }
      } catch {
        // Cache write failure must never block the gateway
      }
      return audit(allow(`Allowed by policy (receipt: ${receiptId})`), {
        toolName, actionType, resource, receiptId, riskSignals, source: 'authensor',
      });
    }

    if (outcome === 'deny' || outcome === 'denied') {
      process.stderr.write(
        `[SafeClaw] Denied: ${actionType} on ${resource}\n`
      );
      return audit(deny(`Denied by policy: ${actionType} on ${resource} (receipt: ${receiptId})`), {
        toolName, actionType, resource, receiptId, riskSignals, source: 'authensor',
      });
    }

    if (outcome === 'require_approval') {
      process.stderr.write(
        `[SafeClaw] Approval required: ${actionType} on ${resource}\n` +
        `  Receipt: ${receiptId}\n` +
        `  Approve via: safeclaw approvals approve ${receiptId}\n` +
        `  Or approve via the thin UI\n` +
        `  Waiting up to ${approvalTimeoutSeconds}s...\n`
      );

      // Send SMS notification if Twilio is configured (non-blocking)
      if (isNotifyConfigured()) {
        sendApprovalSMS({ actionType, resource, receiptId, installId, riskSignals }).catch(() => {});
      }

      // Emit SSE event for dashboard
      emit('agent:approval_required', { receiptId, actionType, resource, riskSignals });

      // Webhook notification (fire-and-forget)
      sendWebhook('approval_required', { actionType, resource, receiptId, riskSignals }).catch(() => {});

      const approvalResult = await pollForApproval(client, receiptId, approvalTimeoutSeconds, signal, actionType, resource);
      const wasApproved = approvalResult?.hookSpecificOutput?.permissionDecision === 'allow';
      emit('agent:approval_resolved', { receiptId, approved: wasApproved });
      sendWebhook('approval_resolved', { receiptId, approved: wasApproved }).catch(() => {});
      return audit(approvalResult, {
        toolName, actionType, resource, receiptId, riskSignals, source: 'authensor',
      });
    }

    // Unknown outcome → fail closed
    return audit(deny(`Unknown decision outcome: ${outcome}`), {
      toolName, actionType, resource, receiptId, riskSignals, source: 'authensor',
    });
  }

  return gatewayHook;
}

/**
 * Poll the control plane for an approval decision.
 */
async function pollForApproval(client, receiptId, timeoutSeconds, signal, actionType, resource) {
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return deny('Hook aborted');
    }

    await sleep(POLL_INTERVAL_MS);

    try {
      const receipt = await client.getReceipt(receiptId, signal);
      const status = receipt.status;

      if (status === 'approved' || status === 'allowed') {
        process.stderr.write(`[SafeClaw] Approved: ${actionType} on ${resource}\n`);
        return allow(`Approved (receipt: ${receiptId})`);
      }

      if (status === 'rejected' || status === 'denied') {
        process.stderr.write(`[SafeClaw] Rejected: ${actionType} on ${resource}\n`);
        return deny(`Rejected by approver (receipt: ${receiptId})`);
      }

      if (status === 'expired') {
        return deny(`Approval expired (receipt: ${receiptId})`);
      }

      // Still pending -continue polling
    } catch (err) {
      // Transient failure during poll: log and retry
      process.stderr.write(`[SafeClaw] Poll error: ${err.message}. Retrying...\n`);
    }
  }

  // Timed out
  process.stderr.write(`[SafeClaw] Approval timed out after ${timeoutSeconds}s\n`);
  return deny(`Approval timed out after ${timeoutSeconds}s (receipt: ${receiptId})`);
}

// --- Hook response helpers ---

function allow(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  };
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Action types where the resource is a file path (for workspace enforcement). */
const FILE_PATH_ACTIONS = new Set([
  'filesystem.write', 'safe.read.file', 'safe.read.directory',
  'safe.read.search', 'safe.read.todo',
]);

function isFilePathAction(actionType) {
  return FILE_PATH_ACTIONS.has(actionType) || actionType.startsWith('safe.read.');
}
