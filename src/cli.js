#!/usr/bin/env node
import { loadConfig, saveConfig, ensureProfile, getProfile, setActiveProfile } from './config.js';
import { ensurePolicyFile, loadPolicy, policyHelp, simulatePolicy } from './policy.js';
import { AuthensorClient } from './authensor.js';
import { runAgent } from './agent.js';
import { detectRuntime, buildImage, runContainer } from './container.js';
import { isNotifyConfigured } from './notify.js';
import { readEntries } from './audit.js';
import { listSessions, loadSession } from './session.js';
import { createWorkspaceConfig, detectWorkspace } from './workspace.js';
import { checkBudget } from './budget.js';

function argValue(args, key) {
  const idx = args.indexOf(key);
  if (idx === -1 || idx + 1 >= args.length) return '';
  return args[idx + 1];
}

function redactConfig(profile) {
  const safe = JSON.parse(JSON.stringify(profile));
  if (safe.authToken) safe.authToken = '***REDACTED***';
  return safe;
}

function usage() {
  console.log(`SafeClaw - Safe local AI agent with Authensor action gating

Your API keys never leave your machine. Only action descriptions
(e.g. "filesystem.write /tmp/file.txt") are sent to Authensor for policy checks.

Commands:
  (no args) / dashboard   Open the browser dashboard (setup wizard + task runner)
  init [--workspace]      Create/overwrite a profile (--workspace creates .safeclaw.json)
  profile list|use <name> Manage profiles
  config show             Show current config
  policy show|apply|help  Manage policy
  run "task"              Run a task locally
  approvals               List pending approvals
  approvals approve <id>  Approve a request
  approvals reject <id>   Reject a request
  receipts                List recent receipts
  audit [verify]          Show local audit log (verify: check hash chain integrity)
  history                 Show past task sessions
  health                  Check Authensor control plane connectivity
  doctor                  Run 10 diagnostic checks on your setup

Flags:
  --verbose, -v           Show detailed output
  --provider <name>       AI provider: claude (default) or openai
  --model <model>         Model override (e.g. gpt-4o, gpt-4o-mini)
  --container             Run the agent inside a Docker/Podman container
  --workspace <path>      Workspace directory for container mode (default: cwd)
  --rebuild               Rebuild the container image before running
  --dry-run               Show task config + policy simulation without running
  --no-open               Start dashboard without opening browser
  --version               Show version

SMS Notifications (optional):
  Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
  and SAFECLAW_NOTIFY_PHONE to get texted when approval is needed.

Examples:
  safeclaw                               # Opens browser dashboard
  export ANTHROPIC_API_KEY=sk-ant-...
  safeclaw init --auth-token <token>
  safeclaw policy apply
  safeclaw run "Summarize this document"

  # OpenAI provider:
  safeclaw init --provider openai --auth-token <token>
  export OPENAI_API_KEY=sk-...
  safeclaw run "Summarize this document"

  safeclaw run --container "Analyze files in workspace"
  safeclaw approvals
`);
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');

  // --- dashboard (no args, or explicit 'dashboard'/'ui') ---
  const cmd = args[0] || '';
  if (!cmd || cmd === 'dashboard' || cmd === 'ui') {
    const noOpen = args.includes('--no-open');
    const { startServer } = await import('./server.js');
    await startServer({ open: !noOpen });
    return; // server keeps process alive
  }

  const cfg = loadConfig();

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  if (cmd === '--version') {
    console.log('safeclaw 1.0.0-beta');
    return;
  }

  if (cmd === 'doctor') {
    const { runDiagnostics } = await import('./doctor.js');
    const checks = await runDiagnostics();
    console.log('SafeClaw Diagnostics\n');
    let hasFailure = false;
    for (const check of checks) {
      const icon = check.status === 'ok' ? '[PASS]' : check.status === 'warn' ? '[WARN]' : '[FAIL]';
      console.log(`  ${icon} ${check.name}: ${check.message}`);
      if (check.status === 'fail') hasFailure = true;
    }
    console.log('');
    if (hasFailure) process.exitCode = 1;
    return;
  }

  // --- init ---
  if (cmd === 'init') {
    const profileName = argValue(args, '--profile') || cfg.activeProfile || 'default';
    const controlPlane = argValue(args, '--control-plane') || '';
    let authToken = argValue(args, '--auth-token') || '';
    const providerName = argValue(args, '--provider') || '';
    const wantDemo = args.includes('--demo');

    // Resolve provider-specific defaults
    const isOpenAI = providerName === 'openai';
    const apiKeyEnv = argValue(args, '--api-key-env') || (isOpenAI ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
    const defaultModel = isOpenAI ? 'gpt-4o' : '';

    // Auto-provision demo token if requested
    if (wantDemo && !authToken) {
      const { AuthensorClient } = await import('./authensor.js');
      const client = new AuthensorClient({});
      try {
        console.log('Requesting demo token...');
        const result = await client.provisionDemo(`safeclaw_${Date.now()}`);
        if (result && result.token) {
          authToken = result.token;
          console.log('Demo token received.');
        } else {
          console.log('Auto-provisioning not available yet.');
          console.log('Request a token at: https://forms.gle/QdfeWAr2G4pc8GxQA');
        }
      } catch (err) {
        console.log(`Auto-provisioning failed: ${err.message}`);
        console.log('Request a token at: https://forms.gle/QdfeWAr2G4pc8GxQA');
      }
    }

    const profile = ensureProfile(cfg, profileName);
    if (controlPlane) profile.controlPlane = controlPlane;
    if (authToken) profile.authToken = authToken;
    profile.provider = {
      name: isOpenAI ? 'openai' : 'claude',
      apiKeyEnv,
      model: argValue(args, '--model') || defaultModel,
    };

    // Ensure default policy file exists
    ensurePolicyFile(profile.policy.path);

    setActiveProfile(cfg, profileName);
    saveConfig(cfg);

    const keyHint = isOpenAI ? 'sk-...' : 'sk-ant-...';
    console.log(`Profile '${profileName}' saved.`);
    console.log(`  Provider:      ${profile.provider.name}`);
    console.log(`  Control plane: ${profile.controlPlane}`);
    console.log(`  Install ID:    ${profile.installId}`);
    console.log(`  API key env:   ${apiKeyEnv}`);
    if (profile.provider.model) console.log(`  Model:         ${profile.provider.model}`);

    // Create workspace config if requested
    if (args.includes('--workspace')) {
      const wsPath = createWorkspaceConfig(process.cwd());
      console.log(`  Workspace:     ${wsPath}`);
    }

    // Post-init smoke test
    try {
      const { runDiagnostics } = await import('./doctor.js');
      const checks = await runDiagnostics();
      let pass = 0, warn = 0, fail = 0;
      for (const c of checks) {
        if (c.status === 'ok') pass++;
        else if (c.status === 'warn') warn++;
        else fail++;
      }
      console.log(`\n  Health: ${pass} passed, ${warn} warnings, ${fail} failed`);
      if (fail > 0) console.log('  Run "safeclaw doctor" for details.');
    } catch { /* doctor not critical */ }

    if (!authToken) {
      console.log(`\nNext steps:`);
      console.log(`  export ${apiKeyEnv}=${keyHint}`);
      console.log(`  safeclaw init --auth-token <your-token>`);
    } else {
      console.log(`\nNext steps:`);
      console.log(`  export ${apiKeyEnv}=${keyHint}`);
      console.log(`  safeclaw policy apply`);
      console.log(`  safeclaw run "your task"`);
    }
    return;
  }

  // --- profile ---
  if (cmd === 'profile') {
    const sub = args[1];
    if (sub === 'list') {
      const names = Object.keys(cfg.profiles || {});
      if (!names.length) {
        console.log('No profiles. Run: safeclaw init');
        return;
      }
      names.forEach((n) => {
        const mark = n === cfg.activeProfile ? '*' : ' ';
        console.log(`${mark} ${n}`);
      });
      return;
    }
    if (sub === 'use') {
      const name = args[2];
      if (!name) throw new Error('Usage: safeclaw profile use <name>');
      if (!cfg.profiles || !cfg.profiles[name]) throw new Error(`Profile '${name}' not found.`);
      setActiveProfile(cfg, name);
      saveConfig(cfg);
      console.log(`Active profile: ${name}`);
      return;
    }
    throw new Error('Usage: safeclaw profile list|use <name>');
  }

  // --- config ---
  if (cmd === 'config') {
    const sub = args[1];
    if (sub === 'show') {
      const p = getProfile(cfg);
      if (!p) throw new Error('No profile configured. Run: safeclaw init');
      console.log(JSON.stringify({ name: p.name, profile: redactConfig(p.profile) }, null, 2));
      return;
    }
    throw new Error('Usage: safeclaw config show');
  }

  // --- Commands below require an active profile ---
  // In container mode, config comes from env vars (no config file on disk).
  let profile;
  const selected = getProfile(cfg);
  if (selected) {
    profile = selected.profile;
  } else if (process.env.SAFECLAW_CONTROL_PLANE && process.env.SAFECLAW_AUTH_TOKEN) {
    // Container env var fallback
    profile = {
      controlPlane: process.env.SAFECLAW_CONTROL_PLANE,
      authToken: process.env.SAFECLAW_AUTH_TOKEN,
      installId: process.env.SAFECLAW_INSTALL_ID || 'container',
      provider: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      policy: { path: '', id: '' },
    };
  } else {
    throw new Error('No profile configured. Run: safeclaw init');
  }

  // --- health ---
  if (cmd === 'health') {
    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });
    try {
      const res = await client.health();
      console.log('Control plane OK:', JSON.stringify(res));
    } catch (err) {
      console.error(`Control plane unreachable: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  // --- policy ---
  if (cmd === 'policy') {
    const sub = args[1];
    if (sub === 'show') {
      const policy = loadPolicy(profile.policy.path);
      console.log(JSON.stringify(policy, null, 2));
      return;
    }
    if (sub === 'help') {
      console.log(policyHelp());
      return;
    }
    if (sub === 'apply') {
      const policy = loadPolicy(profile.policy.path);
      const client = new AuthensorClient({
        controlPlaneUrl: profile.controlPlane,
        authToken: profile.authToken,
      });
      try {
        const res = await client.createPolicy(policy);
        const policyId = res.policyId || res.id || policy.id;
        const version = res.version || policy.version;
        await client.setActivePolicy(policyId, version);
        profile.policy.id = policyId;
        saveConfig(cfg);
        console.log(`Policy applied: ${policyId} (${version})`);
      } catch (err) {
        console.error(`Failed to apply policy: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }
    throw new Error('Usage: safeclaw policy show|apply|help');
  }

  // --- run ---
  if (cmd === 'run') {
    const useContainer = args.includes('--container');
    const rebuild = args.includes('--rebuild');
    const dryRun = args.includes('--dry-run');
    const workspace = argValue(args, '--workspace') || process.cwd();
    const taskArgs = args.slice(1).filter(a =>
      a !== '--verbose' && a !== '-v' &&
      a !== '--container' && a !== '--rebuild' &&
      a !== '--dry-run' &&
      a !== '--workspace' && a !== workspace
    );
    const task = taskArgs.join(' ').trim();
    if (!task) throw new Error('Usage: safeclaw run [--container] [--dry-run] "your task"');

    // Verify the API key is available — it never leaves the machine
    const keyEnv = profile.provider?.apiKeyEnv || 'ANTHROPIC_API_KEY';
    if (!process.env[keyEnv]) {
      const isOpenAI = profile.provider?.name === 'openai';
      const keyHint = isOpenAI ? 'sk-...' : 'sk-ant-...';
      const providerLabel = isOpenAI ? 'OpenAI' : 'Anthropic';
      throw new Error(
        `Missing ${providerLabel} API key. Set ${keyEnv} in your environment:\n` +
        `  export ${keyEnv}=${keyHint}`
      );
    }

    // Dry-run mode: preview config + policy simulation without starting agent
    if (dryRun) {
      console.log('SafeClaw Dry Run\n');
      console.log(`  Task:      ${task}`);
      console.log(`  Provider:  ${profile.provider?.name || 'claude'}`);
      console.log(`  Model:     ${profile.provider?.model || '(default)'}`);
      console.log(`  Container: ${useContainer ? 'yes' : 'no'}`);
      console.log(`  Profile:   ${cfg.activeProfile || 'default'}`);

      // Workspace scope
      try {
        const ws = detectWorkspace(workspace);
        if (ws) {
          console.log(`  Workspace: ${ws.root}`);
        } else {
          console.log(`  Workspace: ${workspace} (no project boundary found)`);
        }
      } catch {
        console.log(`  Workspace: ${workspace}`);
      }

      // Budget status
      try {
        const budget = checkBudget();
        if (budget.enabled) {
          console.log(`\n  Budget: $${budget.currentUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)} (${budget.period}) [${budget.exceeded ? 'EXCEEDED' : 'OK'}]`);
        } else {
          console.log(`\n  Budget: disabled`);
        }
      } catch { /* ignore */ }

      // Policy simulation for common action types
      if (profile.policy?.path) {
        try {
          const policy = loadPolicy(profile.policy.path);
          console.log(`\n  Policy Simulation:`);
          for (const actionType of ['filesystem.write', 'filesystem.read', 'network.http', 'bash.execute']) {
            const result = simulatePolicy(policy, actionType, '/example');
            const ruleName = result.matchedRule ? (result.matchedRule.description || result.matchedRule.id) : 'default';
            console.log(`    ${actionType} → ${result.effect} (${ruleName})`);
          }
        } catch (e) {
          console.log(`\n  Policy: could not load (${e.message})`);
        }
      }

      console.log('\n(Dry run complete — no agent started)');
      return;
    }

    if (verbose && isNotifyConfigured()) {
      process.stderr.write(`[SafeClaw] SMS notifications enabled\n`);
    }

    if (useContainer) {
      const runtime = detectRuntime();
      if (!runtime) {
        throw new Error(
          'No container runtime found. Install Docker or Podman:\n' +
          '  https://docs.docker.com/get-docker/\n' +
          '  https://podman.io/getting-started/installation'
        );
      }

      if (verbose) {
        process.stderr.write(`[SafeClaw] Container runtime: ${runtime}\n`);
        process.stderr.write(`[SafeClaw] Workspace: ${workspace}\n`);
      }

      // Build image if needed
      const projectRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
      buildImage({ runtime, projectRoot, rebuild });

      const code = await runContainer({ runtime, task, profile, workspacePath: workspace, verbose });
      process.exitCode = code;
    } else {
      await runAgent({ task, profile, verbose });
    }
    return;
  }

  // --- approvals ---
  if (cmd === 'approvals') {
    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });

    const sub = args[1];
    if (!sub) {
      try {
        const res = await client.listPendingApprovals();
        const list = res.receipts || res.items || [];
        if (!list.length) {
          console.log('No pending approvals.');
          return;
        }
        list.forEach(a => {
          const actionType = a.actionType || a.envelope?.action?.type || 'unknown';
          const resource = a.resource || a.envelope?.action?.resource || '';
          console.log(`  ${a.id}  ${actionType}  ${resource}  [${a.status}]`);
        });
      } catch (err) {
        console.error(`Failed to list approvals: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }
    if (sub === 'approve' || sub === 'reject') {
      const id = args[2];
      if (!id) throw new Error(`Usage: safeclaw approvals ${sub} <id>`);
      const status = sub === 'approve' ? 'approved' : 'rejected';
      try {
        await client.resolveApproval(id, status);
        console.log(`${sub === 'approve' ? 'Approved' : 'Rejected'}: ${id}`);
      } catch (err) {
        console.error(`Failed to ${sub}: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }
    throw new Error('Usage: safeclaw approvals [approve|reject] <id>');
  }

  // --- receipts ---
  if (cmd === 'receipts') {
    const client = new AuthensorClient({
      controlPlaneUrl: profile.controlPlane,
      authToken: profile.authToken,
    });
    try {
      const res = await client.listReceipts();
      const list = res.receipts || res.items || [];
      if (!list.length) {
        console.log('No receipts.');
        return;
      }
      list.forEach(r => {
        const actionType = r.actionType || r.envelope?.action?.type || 'unknown';
        const resource = r.resource || r.envelope?.action?.resource || '';
        const status = r.status || r.decisionOutcome || 'unknown';
        console.log(`  ${r.id}  ${actionType}  ${resource}  [${status}]`);
      });
    } catch (err) {
      console.error(`Failed to list receipts: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'audit') {
    const sub = args[1];
    if (sub === 'verify') {
      const { verifyAuditIntegrity } = await import('./audit.js');
      const result = verifyAuditIntegrity();
      console.log(`Audit log integrity check:`);
      console.log(`  Total entries:   ${result.totalEntries}`);
      console.log(`  Chained entries: ${result.chainedEntries}`);
      if (result.valid) {
        console.log(`  Status:          PASS`);
      } else {
        console.log(`  Status:          FAIL`);
        result.errors.forEach(e => console.log(`  Error: ${e}`));
        process.exitCode = 1;
      }
      return;
    }

    const limit = parseInt(argValue(args, '--limit') || '50', 10);
    const filterType = argValue(args, '--filter') || '';
    const entries = readEntries({ limit, filter: { actionType: filterType || undefined } });
    if (!entries.length) {
      console.log('No audit entries.');
      return;
    }
    entries.forEach(e => {
      const ts = (e.timestamp || '').slice(0, 19).replace('T', ' ');
      const resource = (e.resource || '').slice(0, 60);
      console.log(`  ${ts}  ${e.actionType}  ${resource}  [${e.outcome}]  ${e.source || ''}`);
    });
    return;
  }

  if (cmd === 'history') {
    const limit = parseInt(argValue(args, '--limit') || '10', 10);
    const sessionId = args[1] && !args[1].startsWith('--') ? args[1] : null;

    if (sessionId) {
      const session = loadSession(sessionId);
      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(session, null, 2));
      return;
    }

    const sessions = listSessions({ limit });
    if (!sessions.length) {
      console.log('No task history.');
      return;
    }
    sessions.forEach(s => {
      const ts = (s.startedAt || '').slice(0, 19).replace('T', ' ');
      const taskPreview = (s.task || '').slice(0, 50);
      console.log(`  ${s.id}  ${ts}  [${s.status}]  ${taskPreview}`);
    });
    return;
  }

  // Unknown command
  usage();
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
