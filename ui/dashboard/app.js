// SafeClaw Dashboard - Client JS

let currentWizardStep = 1;
let selectedProvider = 'claude';
let currentTaskId = null;
let taskSSE = null;
let pollTimer = null;
let currentProvider = 'claude';
let lastTaskPrompt = '';

// --- Theme ---

var currentTheme = 'auto';

function applyTheme(theme) {
  currentTheme = theme || 'auto';
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
  var toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  var isDark = currentTheme === 'dark' ||
    (currentTheme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  toggle.checked = isDark;
}

function toggleTheme() {
  var toggle = document.getElementById('theme-toggle');
  var next = toggle.checked ? 'dark' : 'light';
  applyTheme(next);
  // Persist via settings API
  fetchApi('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: next }) }).catch(function(){});
  // Update settings page select if visible
  var sel = document.getElementById('set-theme');
  if (sel) sel.value = next;
}

// --- Browser notifications ---

var notificationsEnabled = false;

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showApprovalNotification(data) {
  if (!notificationsEnabled) return;
  if (!document.hidden) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  var actionType = data.actionType || 'action';
  var resource = data.resource || '';
  var riskPrefix = (data.riskSignals && data.riskSignals.length) ? 'Risk: ' + data.riskSignals.join(', ') + '\n' : '';
  var n = new Notification('SafeClaw - Approval Needed', {
    body: riskPrefix + actionType + ' on ' + resource,
    tag: 'safeclaw-approval',
  });
  n.onclick = function() {
    window.focus();
    n.close();
  };
}

function toggleNotifications() {
  var cb = document.getElementById('set-notifications');
  if (cb && cb.checked) {
    requestNotificationPermission();
  }
}

// --- Init ---

async function init() {
  try {
    // Apply theme early to avoid flash
    try {
      var settings = await fetchApi('/api/settings');
      applyTheme(settings.theme);
    } catch (_) {}

    const status = await fetchApi('/api/status');
    updateStatusBar(status);

    if (status.setupComplete) {
      showDashboard();
      initWelcomeBanner();
      refreshApprovals();
      refreshReceipts();
      startPolling();
      loadProfiles();
      loadModelOptions();
    } else {
      showWizard();
    }

    // Reconnect to running task if one exists
    if (status.agentStatus === 'running' && status.activeTaskId) {
      currentTaskId = status.activeTaskId;
      showDashboard();
      hideWelcomeBanner();
      showRunningState();
      connectTaskSSE(currentTaskId);
    }
  } catch (err) {
    updateStatusBar({ error: err.message });
  }
}

// --- Fetch helper ---

async function fetchApi(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SafeClaw' },
    ...options,
  });
  const text = await res.text();
  var body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok && !body.error) {
    body.error = body.raw || ('HTTP ' + res.status);
  }
  return body;
}

// --- Status bar ---

function updateStatusBar(status) {
  const dot = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');

  if (status.error) {
    dot.className = 'status-dot error';
    text.textContent = 'Error';
    return;
  }

  if (status.setupComplete) {
    dot.className = 'status-dot ok';
    text.textContent = status.agentStatus === 'running' ? 'Agent running' : 'Ready';
  } else {
    dot.className = 'status-dot';
    text.textContent = 'Setup required';
  }
}

// --- Profile switcher ---

async function loadProfiles() {
  try {
    var result = await fetchApi('/api/profiles');
    var select = document.getElementById('profile-select');
    select.innerHTML = '';
    (result.profiles || []).forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === result.active) opt.selected = true;
      select.appendChild(opt);
    });
    currentProvider = result.provider || 'claude';
  } catch (err) {
    // silently fail
  }
}

async function switchProfile() {
  var select = document.getElementById('profile-select');
  var name = select.value;
  try {
    var result = await fetchApi('/api/profiles/switch', {
      method: 'POST',
      body: JSON.stringify({ name: name }),
    });
    if (result.ok) {
      // Reload status and visible tab data
      var status = await fetchApi('/api/status');
      updateStatusBar(status);
      loadProfiles();
      loadModelOptions();
      // Refresh current tab
      if (currentTab === 'analytics') refreshAnalytics();
      if (currentTab === 'audit') refreshAudit();
      if (currentTab === 'history') refreshHistory();
      if (currentTab === 'policy') refreshPolicy();
      if (currentTab === 'settings') refreshSettings();
      if (currentTab === 'clinic') refreshClinic();
    }
  } catch (err) {
    // silently fail
  }
}

// --- Model selector ---

function loadModelOptions() {
  var select = document.getElementById('task-model');
  select.innerHTML = '';
  var defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Default';
  select.appendChild(defaultOpt);

  var models;
  if (currentProvider === 'openai') {
    models = [
      { value: 'gpt-4o', label: 'GPT-4o (powerful)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (faster, cheaper)' }
    ];
  } else {
    models = [
      { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (balanced)' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap)' }
    ];
  }
  models.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  });
}

function toggleWorkspaceInput() {
  var cb = document.getElementById('task-container');
  var info = document.getElementById('container-info');
  if (info) info.classList.toggle('hidden', !cb.checked);
}

function dismissContainerInfo() {
  var info = document.getElementById('container-info');
  if (info) info.classList.add('hidden');
}

// --- Form validation helper ---

function showFieldError(fieldId, message) {
  var el = document.getElementById(fieldId);
  if (!el) return;
  el.classList.add('field-error');
  el.focus();
  // Remove existing error message if present
  var existing = el.parentElement.querySelector('.field-error-msg');
  if (existing) existing.remove();
  // Add error message
  var msg = document.createElement('span');
  msg.className = 'field-error-msg';
  msg.textContent = message;
  el.parentElement.appendChild(msg);
  // Clear on input
  el.addEventListener('input', function clearErr() {
    el.classList.remove('field-error');
    var m = el.parentElement.querySelector('.field-error-msg');
    if (m) m.remove();
    el.removeEventListener('input', clearErr);
  }, { once: true });
  el.addEventListener('change', function clearErr() {
    el.classList.remove('field-error');
    var m = el.parentElement.querySelector('.field-error-msg');
    if (m) m.remove();
    el.removeEventListener('change', clearErr);
  }, { once: true });
}

// --- View switching ---

function showWizard() {
  document.getElementById('wizard').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  showWizardStep(1);
}

function showDashboard() {
  document.getElementById('wizard').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
}

// --- Wizard ---

function showWizardStep(step) {
  currentWizardStep = step;
  document.querySelectorAll('.wizard-step').forEach(function (el) {
    el.classList.toggle('hidden', parseInt(el.dataset.step) !== step);
  });
}

function wizardNext() {
  if (currentWizardStep === 1) {
    showWizardStep(2);
  } else if (currentWizardStep === 2) {
    // Provider selected, move to API key step
    updateKeyStepForProvider();
    showWizardStep(3);
    document.getElementById('input-api-key').focus();
  } else if (currentWizardStep === 3) {
    var key = document.getElementById('input-api-key').value.trim();
    if (!key) {
      showFieldError('input-api-key', 'An API key is required to continue');
      return;
    }
    showWizardStep(4);
    document.getElementById('input-auth-token').focus();
  } else if (currentWizardStep === 4) {
    var token = document.getElementById('input-auth-token').value.trim();
    if (!token) {
      showFieldError('input-auth-token', 'An Authensor token is required to continue');
      return;
    }
    runSetup();
  }
}

function selectProvider(provider) {
  selectedProvider = provider;
  document.querySelectorAll('.provider-card').forEach(function (card) {
    card.classList.toggle('selected', card.dataset.provider === provider);
  });
}

function updateKeyStepForProvider() {
  var title = document.getElementById('key-step-title');
  var input = document.getElementById('input-api-key');
  var link = document.getElementById('key-link');
  var step2 = document.getElementById('key-help-step2');
  var signup = document.getElementById('key-help-signup');

  if (selectedProvider === 'openai') {
    title.textContent = 'Step 2 of 4: OpenAI API key';
    input.placeholder = 'sk-...';
    link.href = 'https://platform.openai.com/api-keys';
    link.textContent = 'platform.openai.com/api-keys';
    signup.textContent = '(create a free account if you don\'t have one)';
    step2.innerHTML = 'Click <strong>Create new secret key</strong>, give it any name, and copy it';
  } else {
    title.textContent = 'Step 2 of 4: Anthropic API key';
    input.placeholder = 'sk-ant-...';
    link.href = 'https://console.anthropic.com/settings/keys';
    link.textContent = 'console.anthropic.com/settings/keys';
    signup.textContent = '(create a free account if you don\'t have one)';
    step2.innerHTML = 'Click <strong>Create Key</strong>, give it any name, and copy it';
  }
}

function wizardBack() {
  if (currentWizardStep > 1) {
    showWizardStep(currentWizardStep - 1);
  }
}

async function runSetup() {
  showWizardStep(5);
  var statusEl = document.getElementById('setup-status');

  try {
    var apiKey = document.getElementById('input-api-key').value.trim();
    var authToken = document.getElementById('input-auth-token').value.trim();

    statusEl.textContent = 'Saving configuration...';

    var result = await fetchApi('/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: apiKey,
        authensorToken: authToken,
        provider: selectedProvider,
        applyPolicy: true,
      }),
    });

    if (result.error) {
      statusEl.textContent = 'Error: ' + result.error;
      statusEl.style.color = 'var(--danger)';
      return;
    }

    // Show success
    showWizardStep(6);
    var summary = document.getElementById('setup-summary');
    var providerLabel = selectedProvider === 'openai' ? 'OpenAI' : 'Claude (Anthropic)';
    var items = [
      'Provider: ' + providerLabel,
      'API key saved securely on your machine',
    ];
    if (result.policyApplied) {
      items.push('Default safety policy activated');
    } else if (result.policyError) {
      items.push('Policy note: ' + result.policyError);
    }
    summary.innerHTML = items
      .map(function (i) {
        return '<div>&#x2713; ' + escapeHtml(i) + '</div>';
      })
      .join('');
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

function wizardDone() {
  showDashboard();
  fetchApi('/api/status').then(function (s) {
    updateStatusBar(s);
  });
  refreshApprovals();
  refreshReceipts();
  startPolling();
  loadProfiles();
  loadModelOptions();
}

// --- Demo token provisioning ---

async function requestDemoToken() {
  var btn = document.getElementById('btn-demo-token');
  var status = document.getElementById('demo-token-status');
  btn.disabled = true;
  status.textContent = 'Requesting...';

  try {
    var result = await fetchApi('/api/provision-demo', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (result.available && result.token) {
      document.getElementById('input-auth-token').value = result.token;
      status.textContent = 'Token auto-filled!';
      status.style.color = 'var(--success)';
    } else {
      // Endpoint not available -open the form
      window.open(result.formUrl || 'https://forms.gle/QdfeWAr2G4pc8GxQA', '_blank');
      status.textContent = 'Form opened in new tab';
      var help = document.getElementById('demo-token-help');
      if (help) help.textContent = 'Fill out the form, check your email for the token, then paste it below.';
    }
  } catch (err) {
    status.textContent = 'Failed: ' + err.message;
    status.style.color = 'var(--danger)';
  }

  btn.disabled = false;
}

// --- Task runner ---

async function startTask() {
  var input = document.getElementById('task-input');
  var task = input.value.trim();
  if (!task) {
    input.focus();
    return;
  }

  var payload = { task: task };

  // Model override
  var modelSelect = document.getElementById('task-model');
  if (modelSelect && modelSelect.value) {
    payload.model = modelSelect.value;
  }

  // Container mode
  var containerCb = document.getElementById('task-container');
  if (containerCb && containerCb.checked) {
    payload.container = true;
    var wsInput = document.getElementById('task-workspace');
    if (wsInput && wsInput.value.trim()) {
      payload.workspace = wsInput.value.trim();
    }
  }

  try {
    var result = await fetchApi('/api/task', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (result.error) {
      if (result.queued) {
        // Task was queued -show notification
        showAlert('Task queued (position ' + result.position + '). It will start when the current task finishes.');
        refreshQueue();
        return;
      }
      showAlert(result.error);
      return;
    }

    if (result.queued) {
      showAlert('Task queued (position ' + result.position + '). It will start when the current task finishes.');
      refreshQueue();
      return;
    }

    lastTaskPrompt = task;
    currentTaskId = result.taskId;
    hideWelcomeBanner();
    showRunningState();
    clearOutput();
    connectTaskSSE(result.taskId);
  } catch (err) {
    showAlert('Failed to start task: ' + err.message);
  }
}

function showRunningState() {
  document.getElementById('btn-run').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  document.getElementById('task-output').classList.remove('hidden');
  document.getElementById('followup-area').classList.add('hidden');
  var badge = document.getElementById('task-status-badge');
  badge.textContent = 'Running';
  badge.className = 'badge badge-running';
}

function showIdleState(status) {
  document.getElementById('btn-run').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  var badge = document.getElementById('task-status-badge');
  badge.textContent = status || 'Done';
  badge.className = 'badge badge-' + (status === 'Error' || status === 'Stopped' ? 'error' : 'done');
  currentTaskId = null;
  // Show follow-up input on successful completion
  if (status === 'Done') {
    document.getElementById('followup-area').classList.remove('hidden');
  } else {
    document.getElementById('followup-area').classList.add('hidden');
  }
  refreshQueue();
}

async function sendFollowUp() {
  var input = document.getElementById('followup-input');
  var text = input.value.trim();
  if (!text) { input.focus(); return; }

  var combinedPrompt = 'Previous task: ' + lastTaskPrompt + '\n\nContinuation: ' + text;
  lastTaskPrompt = text;
  input.value = '';
  document.getElementById('followup-area').classList.add('hidden');

  // Show follow-up as a user bubble (don't clear output)
  appendBubble('user', escapeHtml(text));

  var payload = { task: combinedPrompt };
  var modelSelect = document.getElementById('task-model');
  if (modelSelect && modelSelect.value) payload.model = modelSelect.value;

  try {
    var result = await fetchApi('/api/task', { method: 'POST', body: JSON.stringify(payload) });
    if (result.error) {
      appendBubble('system', '<div style="color:var(--danger)">' + escapeHtml(result.error) + '</div>');
      return;
    }
    currentTaskId = result.taskId;
    showRunningState();
    // Connect SSE without clearing -suppress the user bubble since we already showed it
    var savedPrompt = lastTaskPrompt;
    lastTaskPrompt = '';
    connectTaskSSE(result.taskId);
    lastTaskPrompt = savedPrompt;
  } catch (err) {
    appendBubble('system', '<div style="color:var(--danger)">Failed: ' + escapeHtml(err.message) + '</div>');
  }
}

function clearOutput() {
  document.getElementById('output-content').innerHTML = '';
  finalizeAgentBubble();
}

function connectTaskSSE(taskId) {
  if (taskSSE) taskSSE.close();
  finalizeAgentBubble();

  // Show the user's task prompt as a chat bubble
  if (lastTaskPrompt) {
    appendBubble('user', escapeHtml(lastTaskPrompt));
  }

  taskSSE = new EventSource('/api/task/' + taskId + '/stream');

  taskSSE.addEventListener('agent:text', function (e) {
    try {
      var data = JSON.parse(e.data);
      agentTextBuffer += (data.text || '');
      updateAgentBubble();
    } catch (err) { console.error('SSE parse error:', err); }
  });

  taskSSE.addEventListener('agent:tool_call', function (e) {
    try {
      var data = JSON.parse(e.data);
      // Finalize current agent bubble before inserting tool call
      finalizeAgentBubble();
      appendBubble('tool',
        '<span class="tool-name">' + escapeHtml(data.toolName) + '</span> ' +
        escapeHtml(data.inputSummary || '')
      );
    } catch (err) { console.error('SSE parse error:', err); }
  });

  taskSSE.addEventListener('agent:approval_required', function (e) {
    try {
      var data = JSON.parse(e.data);
      finalizeAgentBubble();
      var el = document.getElementById('output-content');
      var div = document.createElement('div');
      div.className = 'approval-waiting';
      var riskHtml = '';
      if (data.riskSignals && data.riskSignals.length) {
        riskHtml = '<div class="risk-signals">' + data.riskSignals.map(function(s) {
          return '<span class="badge badge-risk">' + escapeHtml(s) + '</span>';
        }).join('') + '</div>';
      }
      div.innerHTML = 'Waiting for approval: ' + escapeHtml(data.actionType) + ' on ' + escapeHtml(data.resource) + riskHtml;
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
      refreshApprovals();
      showApprovalNotification(data);
    } catch (err) { console.error('SSE parse error:', err); }
  });

  taskSSE.addEventListener('agent:approval_resolved', function () {
    refreshApprovals();
  });

  taskSSE.addEventListener('agent:done', function (e) {
    try {
      var data = JSON.parse(e.data);
      finalizeAgentBubble();
      showIdleState(data.success ? 'Done' : 'Error');
      if (data.error) {
        appendBubble('system', '<div style="color:var(--danger)">Error: ' + escapeHtml(data.error) + '</div>');
      }
      if (data.cost) {
        appendBubble('system', '<div class="muted">Cost: $' + escapeHtml(String(data.cost)) + '</div>');
      }
      taskSSE.close();
      taskSSE = null;
      refreshApprovals();
      refreshReceipts();
    } catch (err) { console.error('SSE parse error:', err); }
  });

  taskSSE.onerror = function () {
    if (!currentTaskId) {
      taskSSE.close();
      taskSSE = null;
    }
  };
}

async function stopTask() {
  if (!currentTaskId) return;
  try {
    await fetchApi('/api/task/' + currentTaskId + '/stop', { method: 'POST' });
  } catch {
    // ignore
  }
  showIdleState('Stopped');
  if (taskSSE) {
    taskSSE.close();
    taskSSE = null;
  }
}

// --- Approvals ---

async function refreshApprovals() {
  try {
    var result = await fetchApi('/api/approvals');
    var list = result.receipts || result.items || [];
    renderApprovals(list);
  } catch {
    // silently fail
  }
}

function renderApprovals(list) {
  var root = document.getElementById('approval-list');
  var countBadge = document.getElementById('approval-count');

  if (!list.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon icon-empty"><use href="#sc-shield"/></svg></div><div>All clear. Risky actions will pause here for your approval before running.</div></div>';
    countBadge.classList.add('hidden');
    return;
  }

  countBadge.textContent = list.length;
  countBadge.classList.remove('hidden');

  root.innerHTML = '';
  list.forEach(function (a) {
    var actionType = a.actionType || (a.envelope && a.envelope.action && a.envelope.action.type) || 'unknown';
    var resource = a.resource || (a.envelope && a.envelope.action && a.envelope.action.resource) || '';
    var id = a.id || '';

    var riskSignals = a.riskSignals || [];
    var riskBadgesHtml = '';
    if (riskSignals.length) {
      riskBadgesHtml = '<div class="risk-signals">' + riskSignals.map(function(s) {
        return '<span class="badge badge-risk">' + escapeHtml(s) + '</span>';
      }).join('') + '</div>';
    }

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' +
      escapeHtml(actionType) +
      ' <span class="badge badge-pending">pending</span></div>' +
      '<div class="card-resource">' +
      escapeHtml(resource) +
      '</div>' +
      riskBadgesHtml +
      '<div class="card-id">' +
      escapeHtml(id) +
      '</div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-approve" data-id="' +
      escapeAttr(id) +
      '" data-action="approve">Approve</button>' +
      '<button class="btn btn-reject" data-id="' +
      escapeAttr(id) +
      '" data-action="reject">Reject</button>' +
      '</div>';

    card.querySelectorAll('.card-actions button').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        await fetchApi('/api/approvals/' + encodeURIComponent(btn.dataset.id), {
          method: 'POST',
          body: JSON.stringify({ action: btn.dataset.action }),
        });
        refreshApprovals();
      });
    });

    root.appendChild(card);
  });

  initSwipeApprovals();
}

// --- Receipts ---

async function refreshReceipts() {
  try {
    var result = await fetchApi('/api/receipts');
    var list = result.receipts || result.items || [];
    renderReceipts(list);
  } catch {
    // silently fail
  }
}

function renderReceipts(list) {
  var root = document.getElementById('receipt-list');

  if (!list.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon icon-empty"><use href="#sc-list"/></svg></div><div>No receipts yet. Every action your agent takes gets a receipt: allowed, denied, or awaiting approval.</div></div>';
    return;
  }

  root.innerHTML = '';
  list.slice(0, 20).forEach(function (r) {
    var actionType = r.actionType || (r.envelope && r.envelope.action && r.envelope.action.type) || 'unknown';
    var resource = r.resource || (r.envelope && r.envelope.action && r.envelope.action.resource) || '';
    var status = r.status || r.decisionOutcome || 'unknown';

    var card = document.createElement('div');
    card.className = 'card card-receipt-' + (status === 'allow' || status === 'allowed' || status === 'approved' ? 'allow' : status === 'deny' || status === 'denied' || status === 'rejected' ? 'deny' : 'pending');
    card.innerHTML =
      '<div class="card-title">' +
      escapeHtml(actionType) +
      ' <span class="badge badge-' +
      escapeAttr(status) +
      '">' +
      escapeHtml(status) +
      '</span></div>' +
      '<div class="card-resource">' +
      escapeHtml(resource) +
      '</div>' +
      '<div class="card-id">' +
      escapeHtml(r.id || '') +
      '</div>';
    root.appendChild(card);
  });
}

// --- Polling ---

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(function () {
    if (!document.hidden) {
      refreshApprovals();
    }
  }, 5000);
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    // Resync full state when tab becomes visible
    fetchApi('/api/status').then(function (status) {
      updateStatusBar(status);
      // If agent finished while tab was hidden, update UI
      if (currentTaskId && status.agentStatus === 'idle') {
        showIdleState('Done');
        if (taskSSE) {
          taskSSE.close();
          taskSSE = null;
        }
      }
    }).catch(function () {});
    refreshApprovals();
    refreshReceipts();
  }
});

// --- Helpers ---

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Markdown renderer (lightweight, zero-dep, XSS-safe) ---

function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first for XSS safety
  var escaped = escapeHtml(text);

  // Extract code fences before other processing
  var codeBlocks = [];
  escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre class="code-block"><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\x00CB' + idx + '\x00';
  });

  // Inline code (preserve from further processing)
  var inlineCodes = [];
  escaped = escaped.replace(/`([^`\n]+)`/g, function(_, code) {
    var idx = inlineCodes.length;
    inlineCodes.push('<code>' + code + '</code>');
    return '\x00IC' + idx + '\x00';
  });

  // Bold
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic (single * not preceded/followed by space to avoid false positives with lists)
  escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  // Headings (### → h5, ## → h4, # → h3 -downsized for output area)
  escaped = escaped.replace(/^### (.+)$/gm, '<h5>$1</h5>');
  escaped = escaped.replace(/^## (.+)$/gm, '<h4>$1</h4>');
  escaped = escaped.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  // Links (only allow http/https protocols -no relative or fragment URLs)
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, text, url) {
    if (/^https?:\/\//i.test(url)) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
    }
    return text;
  });
  // Unordered lists (consecutive lines starting with - )
  escaped = escaped.replace(/(^|\n)(- .+(?:\n- .+)*)/g, function(_, pre, block) {
    var items = block.split('\n').map(function(line) {
      return '<li>' + line.replace(/^- /, '') + '</li>';
    }).join('');
    return pre + '<ul>' + items + '</ul>';
  });

  // Paragraphs: double newlines → closing/opening p tags
  escaped = escaped.replace(/\n\n+/g, '</p><p>');
  // Single newlines → <br> (within paragraphs)
  escaped = escaped.replace(/\n/g, '<br>');

  // Restore code blocks and inline codes
  escaped = escaped.replace(/\x00CB(\d+)\x00/g, function(_, idx) { return codeBlocks[parseInt(idx)]; });
  escaped = escaped.replace(/\x00IC(\d+)\x00/g, function(_, idx) { return inlineCodes[parseInt(idx)]; });

  return '<p>' + escaped + '</p>';
}

// --- Chat bubble helpers ---

var agentTextBuffer = '';
var activeAgentBubble = null;

function appendBubble(type, html) {
  var el = document.getElementById('output-content');
  var bubble = document.createElement('div');
  if (type === 'user') {
    bubble.className = 'message-bubble user-bubble';
  } else if (type === 'agent') {
    bubble.className = 'message-bubble agent-bubble';
  } else if (type === 'tool') {
    bubble.className = 'tool-call-block';
  } else {
    bubble.className = 'message-bubble';
  }
  bubble.innerHTML = html;
  el.appendChild(bubble);
  el.scrollTop = el.scrollHeight;
  return bubble;
}

function updateAgentBubble() {
  if (!activeAgentBubble) {
    activeAgentBubble = appendBubble('agent', renderMarkdown(agentTextBuffer));
  } else {
    activeAgentBubble.innerHTML = renderMarkdown(agentTextBuffer);
    var el = document.getElementById('output-content');
    el.scrollTop = el.scrollHeight;
  }
}

function finalizeAgentBubble() {
  activeAgentBubble = null;
  agentTextBuffer = '';
}

function showAlert(msg) {
  // Simple inline alert -could be improved with a toast component
  var output = document.getElementById('task-output');
  output.classList.remove('hidden');
  var content = document.getElementById('output-content');
  content.innerHTML = '<div style="color:var(--danger)">' + escapeHtml(msg) + '</div>';
}

// --- Welcome banner & example chips ---

function fillExample(text) {
  var input = document.getElementById('task-input');
  if (input) {
    input.value = text;
    input.focus();
  }
}

function hideWelcomeBanner() {
  var banner = document.getElementById('welcome-banner');
  if (banner) banner.classList.add('hidden');
}

function dismissWelcome() {
  hideWelcomeBanner();
  try { localStorage.setItem('safeclaw-welcome-dismissed', '1'); } catch(e) {}
}

function showHelp() {
  var banner = document.getElementById('welcome-banner');
  if (banner) banner.classList.remove('hidden');
  if (currentTab !== 'task') switchTab('task');
}

function initWelcomeBanner() {
  try {
    if (localStorage.getItem('safeclaw-welcome-dismissed') === '1') {
      hideWelcomeBanner();
    }
  } catch(e) {}
}

// --- Tab navigation ---

var currentTab = 'task';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(function(panel) {
    panel.classList.toggle('hidden', panel.id !== 'tab-' + tab);
  });
  if (tab === 'analytics') refreshAnalytics();
  if (tab === 'audit') refreshAudit();
  if (tab === 'history') refreshHistory();
  if (tab === 'schedules') refreshSchedules();
  if (tab === 'policy') refreshPolicy();
  if (tab === 'settings') refreshSettings();
  if (tab === 'clinic') refreshClinic();
}

// --- Audit Log ---

async function refreshAudit() {
  var filterType = document.getElementById('audit-filter-type').value;
  var filterOutcome = document.getElementById('audit-filter-outcome').value;
  var params = '?limit=100';
  if (filterType) params += '&actionType=' + encodeURIComponent(filterType);
  if (filterOutcome) params += '&outcome=' + encodeURIComponent(filterOutcome);

  try {
    var result = await fetchApi('/api/audit' + params);
    renderAuditEntries(result.entries || []);
  } catch (err) {
    document.getElementById('audit-list').innerHTML = '<div class="empty-state">Failed to load audit log</div>';
  }
}

function renderAuditEntries(entries) {
  var root = document.getElementById('audit-list');
  if (!entries.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon icon-empty"><use href="#sc-scroll"/></svg></div><div>No audit entries yet. Every action your agent takes will be logged here.</div></div>';
    return;
  }
  var html = '<table class="audit-table"><thead><tr>' +
    '<th>Time</th><th>Tool</th><th>Action Type</th><th>Resource</th><th>Outcome</th><th>Source</th>' +
    '</tr></thead><tbody>';
  entries.forEach(function(e) {
    var ts = (e.timestamp || '').slice(11, 19);
    var date = (e.timestamp || '').slice(0, 10);
    html += '<tr>' +
      '<td title="' + escapeAttr(date) + '">' + escapeHtml(ts) + '</td>' +
      '<td>' + escapeHtml(e.toolName || '') + '</td>' +
      '<td>' + escapeHtml(e.actionType || '') + '</td>' +
      '<td class="audit-resource">' + escapeHtml((e.resource || '').slice(0, 80)) + '</td>' +
      '<td><span class="badge badge-' + escapeAttr(e.outcome || '') + '">' + escapeHtml(e.outcome || '') + '</span></td>' +
      '<td>' + escapeHtml(e.source || '') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  root.innerHTML = html;
}

// --- Audit Verify ---

async function verifyAuditChain() {
  var banner = document.getElementById('audit-verify-banner');
  banner.className = 'audit-verify-banner';
  banner.textContent = 'Verifying...';
  banner.classList.remove('hidden');

  try {
    var result = await fetchApi('/api/audit/verify');
    if (result.valid) {
      banner.className = 'audit-verify-banner audit-verify-ok';
      banner.textContent = 'Chain intact: ' + (result.totalEntries || 0) + ' entries, ' + (result.chainedEntries || 0) + ' chained';
    } else {
      banner.className = 'audit-verify-banner audit-verify-fail';
      banner.textContent = 'Integrity failure: ' + ((result.errors && result.errors[0]) || 'unknown error');
    }
  } catch (err) {
    banner.className = 'audit-verify-banner audit-verify-fail';
    banner.textContent = 'Verify failed: ' + err.message;
  }

  setTimeout(function() { banner.classList.add('hidden'); }, 10000);
}

// --- History ---

async function refreshHistory() {
  try {
    var result = await fetchApi('/api/sessions?limit=20');
    renderHistoryList(result.sessions || []);
  } catch (err) {
    document.getElementById('history-list').innerHTML = '<div class="empty-state">Failed to load history</div>';
  }
}

function renderHistoryList(sessions) {
  var root = document.getElementById('history-list');
  if (!sessions.length) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon icon-empty"><use href="#sc-folder"/></svg></div><div>No past tasks yet. Run your first task from the Tasks tab!</div></div>';
    return;
  }
  root.innerHTML = '';
  sessions.forEach(function(s) {
    var card = document.createElement('div');
    card.className = 'card history-card';
    var ts = (s.startedAt || '').slice(0, 16).replace('T', ' ');
    card.innerHTML =
      '<div class="card-title">' + escapeHtml((s.task || '').slice(0, 50)) +
      ' <span class="badge badge-' + escapeAttr(s.status || 'done') + '">' + escapeHtml(s.status || '') + '</span></div>' +
      '<div class="card-meta">' + escapeHtml(ts) + ' &middot; ' + escapeHtml(s.provider || '') + '</div>';
    card.addEventListener('click', function() { loadSessionDetail(s.id); });
    root.appendChild(card);
  });
}

async function loadSessionDetail(sessionId) {
  try {
    var result = await fetchApi('/api/sessions/' + encodeURIComponent(sessionId));
    if (result.error) throw new Error(result.error);
    renderSessionDetail(result);
  } catch (err) {
    document.getElementById('history-detail-content').innerHTML =
      '<div class="empty-state">Failed to load session</div>';
  }
}

function renderSessionDetail(session) {
  var root = document.getElementById('history-detail-content');
  var html = '<div class="session-meta">' +
    '<div><strong>Task:</strong> ' + escapeHtml(session.task || '') + '</div>' +
    '<div><strong>Provider:</strong> ' + escapeHtml(session.provider || '') +
    (session.model ? ' / ' + escapeHtml(session.model) : '') + '</div>' +
    '<div><strong>Started:</strong> ' + escapeHtml((session.startedAt || '').replace('T', ' ').slice(0, 19)) + '</div>' +
    '<div><strong>Finished:</strong> ' + escapeHtml((session.finishedAt || '').replace('T', ' ').slice(0, 19)) + '</div>' +
    '<div><strong>Status:</strong> <span class="badge badge-' + escapeAttr(session.status || '') + '">' +
    escapeHtml(session.status || '') + '</span></div>' +
    (session.cost ? '<div><strong>Cost:</strong> $' + escapeHtml(String(session.cost)) + '</div>' : '') +
    (session.error ? '<div style="color:var(--danger)"><strong>Error:</strong> ' + escapeHtml(session.error) + '</div>' : '') +
    '</div>';

  // Merge messages and tool calls chronologically
  var timeline = [];
  (session.messages || []).forEach(function(m) {
    timeline.push({ kind: 'message', text: m.text || '', timestamp: m.timestamp || '' });
  });
  (session.toolCalls || []).forEach(function(tc) {
    timeline.push({ kind: 'tool', toolName: tc.toolName || '', inputSummary: tc.inputSummary || '', timestamp: tc.timestamp || '' });
  });
  timeline.sort(function(a, b) { return (a.timestamp || '').localeCompare(b.timestamp || ''); });

  if (timeline.length || session.task) {
    html += '<div class="session-transcript"><h3>Conversation</h3>';
    // Show the original task as a user bubble
    if (session.task) {
      html += '<div class="message-bubble user-bubble">' + escapeHtml(session.task) + '</div>';
    }
    var startTime = session.startedAt ? new Date(session.startedAt).getTime() : 0;
    timeline.forEach(function(item) {
      var relTime = '';
      if (startTime && item.timestamp) {
        var elapsed = Math.round((new Date(item.timestamp).getTime() - startTime) / 1000);
        if (elapsed >= 0) {
          var mins = Math.floor(elapsed / 60);
          var secs = elapsed % 60;
          relTime = '+' + mins + ':' + (secs < 10 ? '0' : '') + secs;
        }
      }
      if (item.kind === 'message') {
        html += '<div class="message-bubble agent-bubble">' + renderMarkdown(item.text) +
          (relTime ? '<div class="session-timestamp">' + escapeHtml(relTime) + '</div>' : '') + '</div>';
      } else {
        html += '<div class="tool-call-block"><span class="tool-name">' +
          escapeHtml(item.toolName) + '</span> ' + escapeHtml(item.inputSummary) +
          (relTime ? ' <span class="session-timestamp">' + escapeHtml(relTime) + '</span>' : '') + '</div>';
      }
    });
    html += '</div>';
  }

  root.innerHTML = html;
}

// --- Policy Editor ---

async function refreshPolicy() {
  try {
    var result = await fetchApi('/api/policy/rules');
    if (result.error) {
      document.getElementById('policy-rules-list').innerHTML =
        '<div class="empty-state">' + escapeHtml(result.error) + '</div>';
      return;
    }
    document.getElementById('policy-name').textContent = result.name || result.id || '';
    var defBadge = document.getElementById('policy-default-effect');
    defBadge.textContent = result.defaultEffect || 'deny';
    defBadge.className = 'badge badge-' + (result.defaultEffect || 'deny');
    renderPolicyRules(result.rules || []);
    loadPolicyTemplates();
    loadMcpServers();
    refreshPolicyVersions();
  } catch (err) {
    document.getElementById('policy-rules-list').innerHTML =
      '<div class="empty-state">Failed to load policy</div>';
  }
}

function renderPolicyRules(rules) {
  var root = document.getElementById('policy-rules-list');
  if (!rules.length) {
    root.innerHTML = '<div class="empty-state">No custom rules. Using the default deny-by-default policy. Add rules below or load a template.</div>';
    return;
  }
  root.innerHTML = '';
  rules.forEach(function(rule) {
    var card = document.createElement('div');
    card.className = 'card rule-card';
    var condText = formatCondition(rule.condition);
    card.innerHTML =
      '<div class="card-title">' +
      '<span class="badge badge-' + escapeAttr(rule.effect) + '">' + escapeHtml(rule.effect) + '</span> ' +
      escapeHtml(rule.description || rule.id) +
      '</div>' +
      '<div class="card-meta">' + escapeHtml(condText) + '</div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-danger btn-small" onclick="deletePolicyRule(\'' + escapeAttr(rule.id) + '\')">Delete</button>' +
      '</div>';
    root.appendChild(card);
  });
}

var actionTypeLabels = {
  'filesystem.write': 'File writes',
  'filesystem.read': 'File reads',
  'filesystem': 'File operations',
  'code.exec': 'Code execution',
  'network.http': 'Network requests',
  'network': 'Network activity',
  'bash.execute': 'Shell commands',
  'mcp.': 'Plugin actions',
  'safe.read': 'Safe reads',
};

function humanizeActionType(value) {
  if (actionTypeLabels[value]) return actionTypeLabels[value];
  // Check prefix matches
  for (var key in actionTypeLabels) {
    if (value.startsWith(key)) return actionTypeLabels[key] + ' (' + value + ')';
  }
  return value;
}

var operatorLabels = {
  'startsWith': 'starting with',
  'eq': 'exactly matching',
  'contains': 'containing',
  'matches': 'matching pattern',
};

function formatCondition(condition) {
  if (!condition) return '';
  var parts = [];
  var predicates = condition.any || condition.all || [];
  var join = condition.any ? ' or ' : ' and ';
  predicates.forEach(function(p) {
    var field = p.field === 'action.type' ? 'Action type' : p.field;
    var op = operatorLabels[p.operator] || p.operator;
    var val = humanizeActionType(p.value);
    parts.push(field + ' ' + op + ' "' + val + '"');
  });
  return parts.join(join) || JSON.stringify(condition);
}

function fillActionPreset() {
  var preset = document.getElementById('rule-action-preset');
  var customFields = document.getElementById('rule-custom-fields');
  var patternInput = document.getElementById('rule-action-pattern');
  var opSelect = document.getElementById('rule-operator');

  if (preset.value === 'custom') {
    customFields.classList.remove('hidden');
    patternInput.value = '';
    patternInput.focus();
  } else if (preset.value) {
    customFields.classList.add('hidden');
    patternInput.value = preset.value;
    opSelect.value = 'startsWith';
  } else {
    customFields.classList.add('hidden');
    patternInput.value = '';
  }
}

function fillSimPreset() {
  var preset = document.getElementById('sim-action-preset');
  var customInput = document.getElementById('sim-action-type');
  if (preset.value === 'custom') {
    customInput.classList.remove('hidden');
    customInput.value = '';
    customInput.focus();
  } else if (preset.value) {
    customInput.classList.add('hidden');
    customInput.value = preset.value;
  } else {
    customInput.classList.add('hidden');
    customInput.value = '';
  }
}

async function addPolicyRule() {
  var description = document.getElementById('rule-description').value.trim();
  var effect = document.getElementById('rule-effect').value;
  var preset = document.getElementById('rule-action-preset').value;
  var pattern = (preset && preset !== 'custom')
    ? preset
    : document.getElementById('rule-action-pattern').value.trim();
  var operator = (preset && preset !== 'custom') ? 'startsWith' : document.getElementById('rule-operator').value;

  if (!pattern) {
    showFieldError('rule-action-preset', 'Choose an action type');
    return;
  }

  var condition = {
    any: [{ field: 'action.type', operator: operator, value: pattern }]
  };

  await fetchApi('/api/policy/rules', {
    method: 'POST',
    body: JSON.stringify({ effect: effect, description: description, condition: condition }),
  });

  document.getElementById('rule-description').value = '';
  document.getElementById('rule-action-pattern').value = '';
  document.getElementById('rule-action-preset').value = '';
  document.getElementById('rule-custom-fields').classList.add('hidden');
  refreshPolicy();
}

async function deletePolicyRule(ruleId) {
  await fetchApi('/api/policy/rules/' + encodeURIComponent(ruleId), { method: 'DELETE' });
  refreshPolicy();
}

async function loadPolicyTemplates() {
  try {
    var result = await fetchApi('/api/policy/templates');
    var select = document.getElementById('policy-template-select');
    select.innerHTML = '<option value="">Load template...</option>';
    (result.templates || []).forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.filename;
      opt.textContent = (t.name || t.id) + ' (' + t.ruleCount + ' rules)';
      select.appendChild(opt);
    });
    select.onchange = function() {
      if (select.value) loadPolicyTemplate(select.value);
    };
  } catch (err) {
    // Ignore template load failures
  }
}

async function loadPolicyTemplate(filename) {
  await fetchApi('/api/policy/load-template', {
    method: 'POST',
    body: JSON.stringify({ template: filename }),
  });
  refreshPolicy();
}

async function applyPolicyToControlPlane() {
  try {
    var result = await fetchApi('/api/policy/apply', { method: 'POST' });
    if (result.error) {
      showAlert('Failed to save: ' + result.error);
    } else {
      showAlert('Policy saved and activated!');
    }
  } catch (err) {
    showAlert('Failed to apply policy');
  }
}

// --- Policy simulate + versions ---

async function simulatePolicy() {
  var preset = document.getElementById('sim-action-preset').value;
  var actionType = (preset && preset !== 'custom')
    ? preset
    : document.getElementById('sim-action-type').value.trim();
  var resource = document.getElementById('sim-resource').value.trim();
  if (!actionType) { showFieldError('sim-action-preset', 'Pick an action to test'); return; }

  var resultEl = document.getElementById('sim-result');
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = 'Simulating...';

  try {
    var data = await fetchApi('/api/policy/simulate', {
      method: 'POST',
      body: JSON.stringify({ actionType: actionType, resource: resource }),
    });
    var badge = '<span class="badge badge-' + escapeAttr(data.effect || 'deny') + '">' + escapeHtml(data.effect || 'deny') + '</span>';
    var rule = data.matchedRule ? escapeHtml(data.matchedRule.description || data.matchedRule.id) : 'No rule matched';
    resultEl.innerHTML = badge + ' ' + escapeHtml(data.reason || '') + '<br><small>' + rule + '</small>';
  } catch (err) {
    resultEl.innerHTML = '<span style="color:var(--danger)">Error: ' + escapeHtml(err.message) + '</span>';
  }
}

async function refreshPolicyVersions() {
  var root = document.getElementById('policy-version-list');
  try {
    var data = await fetchApi('/api/policy/versions');
    var versions = data.versions || [];
    if (!versions.length) {
      root.innerHTML = '<div class="empty-state">No previous versions. Versions are created automatically when you save policy changes.</div>';
      return;
    }
    var html = '<table class="audit-table"><thead><tr><th>Version</th><th>Saved</th><th>Rules</th><th></th></tr></thead><tbody>';
    versions.forEach(function(v) {
      var ts = (v.savedAt || '').slice(0, 16).replace('T', ' ');
      html += '<tr><td>v' + v.version + '</td><td>' + escapeHtml(ts) + '</td><td>' + v.ruleCount + '</td>' +
        '<td><button class="btn btn-secondary btn-small" onclick="rollbackPolicyVersion(' + v.version + ')">Rollback</button></td></tr>';
    });
    html += '</tbody></table>';
    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = '<div class="empty-state">Failed to load versions</div>';
  }
}

async function rollbackPolicyVersion(version) {
  try {
    var result = await fetchApi('/api/policy/rollback', {
      method: 'POST',
      body: JSON.stringify({ version: version }),
    });
    if (result.error) {
      showAlert('Rollback failed: ' + result.error);
      return;
    }
    refreshPolicy();
  } catch (err) {
    showAlert('Rollback failed');
  }
}

// --- Analytics ---

function refreshAnalytics() {
  refreshBudgetBar();
  refreshAnalyticsCost();
  refreshAnalyticsApprovals();
  refreshAnalyticsTools();
  refreshAnalyticsMcp();
}

async function refreshBudgetBar() {
  var root = document.getElementById('analytics-budget');
  try {
    var data = await fetchApi('/api/budget');
    if (!data.enabled) {
      root.innerHTML = '';
      return;
    }
    var pct = Math.min(data.percentUsed || 0, 100).toFixed(0);
    var fillClass = 'bar-fill';
    if (pct >= 90) fillClass += ' bar-fill-danger';
    else if (pct >= 70) fillClass += ' bar-fill-warning';
    root.innerHTML =
      '<div class="budget-header">Budget: $' + escapeHtml((data.currentUsd || 0).toFixed(2)) +
      ' / $' + escapeHtml((data.limitUsd || 0).toFixed(2)) +
      ' (' + escapeHtml(pct) + '%)' +
      (data.exceeded ? ' <span class="badge badge-deny">EXCEEDED</span>' : '') +
      '</div>' +
      '<div class="bar-track"><div class="' + fillClass + '" style="width: ' + pct + '%"></div></div>';
  } catch (err) {
    root.innerHTML = '';
  }
}

async function refreshAnalyticsCost() {
  var period = document.getElementById('analytics-period').value;
  try {
    var data = await fetchApi('/api/analytics/cost?period=' + encodeURIComponent(period));
    renderCostCards(data);
    renderCostBars(data.byPeriod || []);
  } catch (err) {
    document.getElementById('analytics-cost-cards').innerHTML = '<div class="empty-state">Failed to load cost data</div>';
  }
}

function renderCostCards(data) {
  var root = document.getElementById('analytics-cost-cards');
  if (!data.total && !((data.byProvider && data.byProvider.claude) || (data.byProvider && data.byProvider.openai))) {
    root.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg class="icon icon-empty"><use href="#sc-chart"/></svg></div><div>No data yet. Analytics will populate as you run tasks.</div></div>';
    return;
  }
  var total = (data.total || 0).toFixed(4);
  var claude = ((data.byProvider && data.byProvider.claude) || 0).toFixed(4);
  var openai = ((data.byProvider && data.byProvider.openai) || 0).toFixed(4);
  root.innerHTML =
    '<div class="stat-card"><div class="stat-value">$' + escapeHtml(total) + '</div><div class="stat-label">Total Cost</div></div>' +
    '<div class="stat-card"><div class="stat-value">$' + escapeHtml(claude) + '</div><div class="stat-label">Claude</div></div>' +
    '<div class="stat-card"><div class="stat-value">$' + escapeHtml(openai) + '</div><div class="stat-label">OpenAI</div></div>';
}

function renderCostBars(periods) {
  var root = document.getElementById('analytics-cost-bars');
  if (!periods.length) {
    root.innerHTML = '<div class="empty-state">No cost data for this period</div>';
    return;
  }
  var max = Math.max.apply(null, periods.map(function(p) { return p.cost || 0; }));
  if (max === 0) max = 1;
  var html = '';
  periods.forEach(function(p) {
    var pct = Math.round(((p.cost || 0) / max) * 100);
    html += '<div class="bar-row">' +
      '<span class="bar-label">' + escapeHtml(p.label || '') + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width: ' + pct + '%"></div></div>' +
      '<span class="bar-value">$' + escapeHtml((p.cost || 0).toFixed(4)) + '</span>' +
      '</div>';
  });
  root.innerHTML = html;
}

async function refreshAnalyticsApprovals() {
  try {
    var data = await fetchApi('/api/analytics/approvals');
    renderApprovalMetrics(data);
  } catch (err) {
    document.getElementById('analytics-approvals').innerHTML = '<div class="empty-state">Failed to load approval metrics</div>';
  }
}

function renderApprovalMetrics(data) {
  var root = document.getElementById('analytics-approvals');
  if (!data.total) {
    root.innerHTML = '<div class="empty-state">No audit entries yet</div>';
    return;
  }
  var html = '<table class="audit-table"><thead><tr>' +
    '<th>Metric</th><th>Value</th></tr></thead><tbody>';
  html += '<tr><td>Total evaluated</td><td>' + escapeHtml(String(data.total)) + '</td></tr>';
  html += '<tr><td>Allowed</td><td>' + escapeHtml(String(data.allowed)) + '</td></tr>';
  html += '<tr><td>Denied</td><td>' + escapeHtml(String(data.denied)) + '</td></tr>';
  html += '<tr><td>Required approval</td><td>' + escapeHtml(String(data.requireApproval)) + '</td></tr>';
  html += '<tr><td>Approval rate</td><td>' + escapeHtml(((data.approvalRate || 0) * 100).toFixed(1) + '%') + '</td></tr>';
  html += '</tbody></table>';

  if (data.topActions && data.topActions.length) {
    html += '<h4 style="margin: 12px 0 6px;">Top Action Types</h4>';
    html += '<table class="audit-table"><thead><tr><th>Action Type</th><th>Count</th></tr></thead><tbody>';
    data.topActions.forEach(function(a) {
      html += '<tr><td>' + escapeHtml(a.actionType || '') + '</td><td>' + escapeHtml(String(a.count || 0)) + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  root.innerHTML = html;
}

async function refreshAnalyticsTools() {
  try {
    var data = await fetchApi('/api/analytics/tools');
    renderToolUsage(data);
  } catch (err) {
    document.getElementById('analytics-tools').innerHTML = '<div class="empty-state">Failed to load tool usage</div>';
  }
}

function renderToolUsage(tools) {
  var root = document.getElementById('analytics-tools');
  if (!tools || !tools.length) {
    root.innerHTML = '<div class="empty-state">No tool usage data yet</div>';
    return;
  }
  var html = '<table class="audit-table"><thead><tr>' +
    '<th>Tool</th><th>Count</th><th>Allow Rate</th></tr></thead><tbody>';
  tools.forEach(function(t) {
    html += '<tr><td>' + escapeHtml(t.toolName || '') + '</td>' +
      '<td>' + escapeHtml(String(t.count || 0)) + '</td>' +
      '<td>' + escapeHtml(((t.allowRate || 0) * 100).toFixed(0) + '%') + '</td></tr>';
  });
  html += '</tbody></table>';
  root.innerHTML = html;
}

function exportAuditLog(format) {
  window.open('/api/export/audit?format=' + encodeURIComponent(format), '_blank');
}

async function refreshAnalyticsMcp() {
  var root = document.getElementById('analytics-mcp');
  try {
    var data = await fetchApi('/api/analytics/mcp');
    if (!data || !data.length) {
      root.innerHTML = '<div class="empty-state">No MCP server activity recorded yet.</div>';
      return;
    }
    var html = '<table class="audit-table"><thead><tr>' +
      '<th>Server</th><th>Total Calls</th><th>Allow Rate</th><th>Top Actions</th></tr></thead><tbody>';
    data.forEach(function(s) {
      var topActions = (s.actions || []).slice(0, 3).map(function(a) {
        return escapeHtml(a.action) + ' (' + a.count + ')';
      }).join(', ');
      html += '<tr><td>' + escapeHtml(s.server) + '</td>' +
        '<td>' + escapeHtml(String(s.totalCalls || 0)) + '</td>' +
        '<td>' + escapeHtml(((s.allowRate || 0) * 100).toFixed(0) + '%') + '</td>' +
        '<td>' + (topActions || '-') + '</td></tr>';
    });
    html += '</tbody></table>';
    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = '<div class="empty-state">Failed to load MCP data</div>';
  }
}

async function loadMcpServers() {
  try {
    var result = await fetchApi('/api/mcp/servers');
    var select = document.getElementById('rule-mcp-server');
    // Keep the first option (None)
    while (select.options.length > 1) select.remove(1);
    (result.servers || []).forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s;
      opt.textContent = 'mcp.' + s + '.*';
      select.appendChild(opt);
    });
  } catch (err) {
    // Ignore
  }
}

function fillMcpPattern() {
  var select = document.getElementById('rule-mcp-server');
  var patternInput = document.getElementById('rule-action-pattern');
  if (select.value) {
    patternInput.value = 'mcp.' + select.value;
    var opSelect = document.getElementById('rule-operator');
    opSelect.value = 'startsWith';
  }
}

// --- Settings ---

async function refreshSettings() {
  refreshConfigStatus();
  refreshSmsStatus();
  try {
    var settings = await fetchApi('/api/settings');
    document.getElementById('set-timeout').value = Math.round((settings.approvalTimeoutSeconds || 300) / 60);
    document.getElementById('set-retention').value = settings.auditRetentionDays || 90;
    document.getElementById('set-cost-tracking').checked = settings.costTrackingEnabled !== false;
    document.getElementById('set-offline-cache').checked = !!settings.offlineCacheEnabled;
    document.getElementById('set-cache-ttl').value = Math.round((settings.offlineCacheTtlSeconds || 3600) / 60);
    document.getElementById('set-theme').value = settings.theme || 'auto';
    applyTheme(settings.theme || 'auto');
    var notifCb = document.getElementById('set-notifications');
    if (notifCb) notifCb.checked = !!settings.browserNotifications;
    notificationsEnabled = !!settings.browserNotifications;
    document.getElementById('set-webhook-url').value = (settings.notifyChannels && settings.notifyChannels.webhook && settings.notifyChannels.webhook.url) || '';
    var events = (settings.notifyChannels && settings.notifyChannels.webhook && settings.notifyChannels.webhook.events) || [];
    document.querySelectorAll('.webhook-event').forEach(function(cb) {
      cb.checked = events.indexOf(cb.value) !== -1;
    });
    var budget = settings.costBudget || {};
    document.getElementById('set-budget-enabled').checked = !!budget.enabled;
    document.getElementById('set-budget-limit').value = budget.limitUsd || 10;
    document.getElementById('set-budget-period').value = budget.period || 'daily';
    document.getElementById('set-budget-action').value = budget.action || 'warn';
  } catch (err) {
    // silently fail on load
  }
}

async function saveSettingsForm() {
  var events = [];
  document.querySelectorAll('.webhook-event:checked').forEach(function(cb) { events.push(cb.value); });
  var settings = {
    approvalTimeoutSeconds: parseInt(document.getElementById('set-timeout').value, 10) * 60,
    auditRetentionDays: parseInt(document.getElementById('set-retention').value, 10),
    costTrackingEnabled: document.getElementById('set-cost-tracking').checked,
    offlineCacheEnabled: document.getElementById('set-offline-cache').checked,
    offlineCacheTtlSeconds: parseInt(document.getElementById('set-cache-ttl').value, 10) * 60,
    theme: document.getElementById('set-theme').value,
    browserNotifications: !!(document.getElementById('set-notifications') && document.getElementById('set-notifications').checked),
    notifyChannels: {
      sms: true,
      webhook: {
        url: document.getElementById('set-webhook-url').value.trim(),
        events: events,
      },
    },
    costBudget: {
      enabled: document.getElementById('set-budget-enabled').checked,
      limitUsd: parseFloat(document.getElementById('set-budget-limit').value) || 10,
      period: document.getElementById('set-budget-period').value,
      action: document.getElementById('set-budget-action').value,
    },
  };
  var status = document.getElementById('settings-save-status');
  try {
    var result = await fetchApi('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
    if (result.error) { status.textContent = 'Error: ' + result.error; status.style.color = 'var(--danger)'; }
    else { status.textContent = 'Saved'; status.style.color = 'var(--success)'; applyTheme(settings.theme); }
  } catch (err) { status.textContent = 'Error'; status.style.color = 'var(--danger)'; }
  setTimeout(function() { status.textContent = ''; }, 3000);
}

// --- Configuration panel ---

async function refreshConfigStatus() {
  try {
    var data = await fetchApi('/api/config');
    var providerSelect = document.getElementById('set-provider');
    if (data.provider) providerSelect.value = data.provider;
    currentProvider = data.provider || 'claude';

    var keyStatus = document.getElementById('config-key-status');
    keyStatus.textContent = data.hasApiKey ? '(set)' : '(not set)';
    keyStatus.style.color = data.hasApiKey ? 'var(--success)' : 'var(--danger)';

    var tokenStatus = document.getElementById('config-token-status');
    tokenStatus.textContent = data.hasAuthToken ? '(set)' : '(not set)';
    tokenStatus.style.color = data.hasAuthToken ? 'var(--success)' : 'var(--danger)';

    // Update placeholder based on provider
    var keyInput = document.getElementById('set-api-key');
    keyInput.placeholder = data.provider === 'openai' ? 'sk-...' : 'sk-ant-...';
  } catch (err) {
    // silently fail
  }
}

function onProviderChange() {
  var providerSelect = document.getElementById('set-provider');
  var keyInput = document.getElementById('set-api-key');
  keyInput.placeholder = providerSelect.value === 'openai' ? 'sk-...' : 'sk-ant-...';
  currentProvider = providerSelect.value;
  loadModelOptions();
}

async function saveConfigForm() {
  var provider = document.getElementById('set-provider').value;
  var apiKey = document.getElementById('set-api-key').value.trim();
  var authToken = document.getElementById('set-auth-token').value.trim();
  var status = document.getElementById('config-save-status');

  var payload = { provider: provider };
  if (apiKey) payload.apiKey = apiKey;
  if (authToken) payload.authToken = authToken;

  try {
    var result = await fetchApi('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
    if (result.error) {
      status.textContent = 'Error: ' + result.error;
      status.style.color = 'var(--danger)';
    } else {
      status.textContent = 'Saved';
      status.style.color = 'var(--success)';
      document.getElementById('set-api-key').value = '';
      document.getElementById('set-auth-token').value = '';
      refreshConfigStatus();
      loadProfiles();
      loadModelOptions();
    }
  } catch (err) {
    status.textContent = 'Error';
    status.style.color = 'var(--danger)';
  }
  setTimeout(function() { status.textContent = ''; }, 3000);
}

// --- SMS configuration ---

async function refreshSmsStatus() {
  try {
    var data = await fetchApi('/api/sms');
    var line = document.getElementById('sms-status-line');
    if (data.hasSid && data.hasToken && data.hasFrom && data.hasPhone) {
      line.textContent = 'SMS configured (notify: ...' + (data.maskedPhone || '') + ')';
      line.style.color = 'var(--success)';
    } else {
      line.textContent = 'SMS not configured';
      line.style.color = 'var(--text-muted)';
    }
  } catch (err) {
    // silently fail
  }
}

async function saveSmsForm() {
  var sid = document.getElementById('set-twilio-sid').value.trim();
  var token = document.getElementById('set-twilio-token').value.trim();
  var from = document.getElementById('set-twilio-from').value.trim();
  var phone = document.getElementById('set-notify-phone').value.trim();
  var status = document.getElementById('sms-save-status');

  var payload = {};
  if (sid) payload.sid = sid;
  if (token) payload.token = token;
  if (from) payload.fromNumber = from;
  if (phone) payload.notifyPhone = phone;

  try {
    var result = await fetchApi('/api/sms', { method: 'PUT', body: JSON.stringify(payload) });
    if (result.error) {
      status.textContent = 'Error: ' + result.error;
      status.style.color = 'var(--danger)';
    } else {
      status.textContent = 'Saved';
      status.style.color = 'var(--success)';
      document.getElementById('set-twilio-sid').value = '';
      document.getElementById('set-twilio-token').value = '';
      document.getElementById('set-twilio-from').value = '';
      document.getElementById('set-notify-phone').value = '';
      refreshSmsStatus();
    }
  } catch (err) {
    status.textContent = 'Error';
    status.style.color = 'var(--danger)';
  }
  setTimeout(function() { status.textContent = ''; }, 3000);
}

// --- Claw Clinic ---

async function refreshClinic() {
  var results = document.getElementById('clinic-results');
  var summary = document.getElementById('clinic-summary');
  results.innerHTML = '<div class="empty-state">Running diagnostics...</div>';
  summary.classList.add('hidden');

  try {
    var data = await fetchApi('/api/doctor');
    var checks = data.checks || [];

    if (!checks.length) {
      results.innerHTML = '<div class="empty-state">No diagnostic checks returned</div>';
      return;
    }

    var ok = 0, warn = 0, fail = 0;
    checks.forEach(function(c) {
      if (c.status === 'ok') ok++;
      else if (c.status === 'warn') warn++;
      else fail++;
    });

    summary.classList.remove('hidden');
    summary.innerHTML =
      '<span class="clinic-stat clinic-stat-ok">' + ok + ' passed</span>' +
      (warn ? ' <span class="clinic-stat clinic-stat-warn">' + warn + ' warnings</span>' : '') +
      (fail ? ' <span class="clinic-stat clinic-stat-fail">' + fail + ' failures</span>' : '');

    var html = '';
    checks.forEach(function(c) {
      var iconRef = c.status === 'ok' ? '#sc-check' : (c.status === 'warn' ? '#sc-alert' : '#sc-x');
      html += '<div class="clinic-check clinic-status-' + escapeAttr(c.status) + '">' +
        '<span class="clinic-icon"><svg class="icon" style="width:18px;height:18px"><use href="' + iconRef + '"/></svg></span>' +
        '<div class="clinic-detail">' +
        '<div class="clinic-name">' + escapeHtml(c.name) + '</div>' +
        '<div class="clinic-message">' + escapeHtml(c.message) + '</div>' +
        (c.hint ? '<div class="clinic-hint">' + escapeHtml(c.hint) + '</div>' : '') +
        '</div></div>';
    });
    results.innerHTML = html;
  } catch (err) {
    results.innerHTML = '<div class="empty-state">Failed to run diagnostics: ' + escapeHtml(err.message) + '</div>';
  }
}

// --- Config backup/restore ---

function exportConfig() {
  window.open('/api/export/config', '_blank');
}

function importConfig() {
  var fileInput = document.getElementById('import-config-file');
  var status = document.getElementById('backup-status');
  if (!fileInput.files || !fileInput.files[0]) return;

  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var backup = JSON.parse(e.target.result);
      var result = await fetchApi('/api/import/config', { method: 'POST', body: JSON.stringify(backup) });
      if (result.error) {
        status.textContent = 'Error: ' + result.error;
        status.style.color = 'var(--danger)';
      } else {
        status.textContent = 'Imported: ' + (result.imported || []).join(', ');
        status.style.color = 'var(--success)';
        refreshSettings();
        refreshConfigStatus();
        loadProfiles();
      }
    } catch (err) {
      status.textContent = 'Invalid backup file';
      status.style.color = 'var(--danger)';
    }
    fileInput.value = '';
    setTimeout(function() { status.textContent = ''; }, 5000);
  };
  reader.readAsText(fileInput.files[0]);
}

// --- Task queue ---

async function refreshQueue() {
  try {
    var data = await fetchApi('/api/task/queue');
    var queue = data.queue || [];
    var container = document.getElementById('task-queue');
    var countEl = document.getElementById('queue-count');
    var list = document.getElementById('queue-list');

    if (!queue.length) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    countEl.textContent = queue.length;
    var html = '';
    queue.forEach(function(item) {
      html += '<div class="queue-item">' +
        '<span class="queue-item-task">' + escapeHtml(item.task) + '</span>' +
        '<button class="btn btn-danger btn-sm" onclick="removeFromQueue(\'' + escapeAttr(item.id) + '\')">Remove</button>' +
        '</div>';
    });
    list.innerHTML = html;
  } catch (err) {
    // silently fail
  }
}

async function removeFromQueue(taskId) {
  try {
    await fetchApi('/api/task/queue/' + taskId, { method: 'DELETE' });
    refreshQueue();
  } catch (err) {
    // silently fail
  }
}

// --- Swipe approvals ---

function initSwipeApprovals() {
  var items = document.querySelectorAll('#approval-list .card');
  items.forEach(function(card) {
    var startX = 0;
    var deltaX = 0;
    var swiping = false;

    card.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
      deltaX = 0;
      swiping = true;
      card.style.transition = 'none';
    }, { passive: true });

    card.addEventListener('touchmove', function(e) {
      if (!swiping) return;
      deltaX = e.touches[0].clientX - startX;
      card.style.transform = 'translateX(' + deltaX + 'px)';
      card.style.opacity = Math.max(0.4, 1 - Math.abs(deltaX) / 300);
    }, { passive: true });

    card.addEventListener('touchend', function() {
      if (!swiping) return;
      swiping = false;
      card.style.transition = 'transform 0.2s, opacity 0.2s';

      if (deltaX > 80) {
        // Swipe right → approve
        card.style.transform = 'translateX(100%)';
        card.style.opacity = '0';
        var approveBtn = card.querySelector('[data-action="approve"]');
        if (approveBtn) setTimeout(function() { approveBtn.click(); }, 200);
      } else if (deltaX < -80) {
        // Swipe left → reject
        card.style.transform = 'translateX(-100%)';
        card.style.opacity = '0';
        var rejectBtn = card.querySelector('[data-action="reject"]');
        if (rejectBtn) setTimeout(function() { rejectBtn.click(); }, 200);
      } else {
        // Snap back
        card.style.transform = '';
        card.style.opacity = '';
      }
    });
  });
}

// --- Schedules ---

function cronToHuman(cron) {
  if (!cron) return cron;
  var presets = {
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Every hour',
    '0 */3 * * *': 'Every 3 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 */12 * * *': 'Every 12 hours',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 0 * * *': 'Daily at midnight',
    '0 9 * * 1-5': 'Weekdays at 9:00 AM',
    '0 0 * * 0': 'Weekly (Sundays at midnight)',
  };
  if (presets[cron]) return presets[cron];
  // Try to describe simple patterns
  var parts = cron.split(/\s+/);
  if (parts.length === 5) {
    var min = parts[0], hour = parts[1], dom = parts[2], mon = parts[3], dow = parts[4];
    if (min.match(/^\d+$/) && hour.match(/^\d+$/) && dom === '*' && mon === '*' && dow === '*') {
      var h = parseInt(hour, 10);
      var ampm = h >= 12 ? 'PM' : 'AM';
      var h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
      return 'Daily at ' + h12 + ':' + (min.length === 1 ? '0' : '') + min + ' ' + ampm;
    }
  }
  return 'Custom: ' + cron;
}

function toggleScheduleForm() {
  var form = document.getElementById('schedule-form');
  form.classList.toggle('hidden');
}

function updateCronFromFrequency() {
  var freq = document.getElementById('sched-frequency');
  var customDiv = document.getElementById('sched-custom-cron');
  var cronInput = document.getElementById('sched-cron');
  if (freq.value === 'custom') {
    customDiv.classList.remove('hidden');
    cronInput.value = '';
    cronInput.focus();
  } else {
    customDiv.classList.add('hidden');
    cronInput.value = freq.value;
  }
}

async function refreshSchedules() {
  try {
    var data = await fetchApi('/api/schedules');
    renderSchedules(data.schedules || []);
  } catch (err) {
    document.getElementById('schedule-list').innerHTML =
      '<div class="empty-state">Failed to load schedules</div>';
  }
}

function renderSchedules(schedules) {
  var root = document.getElementById('schedule-list');
  if (!schedules.length) {
    root.innerHTML = '<div class="empty-state">No scheduled tasks yet. Click "Add Schedule" to automate recurring tasks.</div>';
    return;
  }
  root.innerHTML = '';
  schedules.forEach(function(s) {
    var card = document.createElement('div');
    card.className = 'schedule-item' + (s.enabled ? '' : ' schedule-disabled');
    var nextRun = s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : 'N/A';
    var lastRun = s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Never';
    var quietInfo = '';
    if (s.quietHoursStart != null && s.quietHoursEnd != null) {
      quietInfo = ' &middot; Quiet ' + s.quietHoursStart + ':00-' + s.quietHoursEnd + ':00';
    }
    card.innerHTML =
      '<div class="schedule-info">' +
        '<div class="schedule-task">' + escapeHtml(s.task) + '</div>' +
        '<div class="schedule-meta">' +
          '<span class="schedule-cron">' + escapeHtml(cronToHuman(s.cron)) + '</span>' +
          ' &middot; Next: ' + escapeHtml(nextRun) +
          ' &middot; Last: ' + escapeHtml(lastRun) +
          (s.lastRunStatus ? ' (' + escapeHtml(s.lastRunStatus) + ')' : '') +
          quietInfo +
          (s.container ? ' &middot; Sandboxed' : '') +
        '</div>' +
      '</div>' +
      '<div class="schedule-actions">' +
        '<label class="toggle-label"><input type="checkbox" ' + (s.enabled ? 'checked' : '') +
          ' onchange="toggleSchedule(\'' + escapeAttr(s.id) + '\', this.checked)" /> Enabled</label>' +
        '<button class="btn btn-danger btn-small" onclick="deleteSchedule(\'' + escapeAttr(s.id) + '\')">Delete</button>' +
      '</div>';
    root.appendChild(card);
  });
}

async function addSchedule() {
  var task = document.getElementById('sched-task').value.trim();
  var freq = document.getElementById('sched-frequency');
  var cron = freq.value === 'custom'
    ? document.getElementById('sched-cron').value.trim()
    : freq.value;
  if (!task) { showFieldError('sched-task', 'Please describe the task'); return; }
  if (!cron) { showFieldError('sched-frequency', 'Please choose a schedule'); return; }

  var payload = { task: task, cron: cron };
  var qStart = document.getElementById('sched-quiet-start').value;
  var qEnd = document.getElementById('sched-quiet-end').value;
  if (qStart !== '' && qEnd !== '') {
    payload.quietHoursStart = parseInt(qStart, 10);
    payload.quietHoursEnd = parseInt(qEnd, 10);
  }
  if (document.getElementById('sched-container').checked) {
    payload.container = true;
  }

  try {
    var result = await fetchApi('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (result.error) {
      showAlert(result.error);
      return;
    }
    document.getElementById('sched-task').value = '';
    document.getElementById('sched-cron').value = '';
    document.getElementById('sched-quiet-start').value = '';
    document.getElementById('sched-quiet-end').value = '';
    document.getElementById('sched-container').checked = false;
    document.getElementById('schedule-form').classList.add('hidden');
    refreshSchedules();
  } catch (err) {
    showAlert('Failed to create schedule: ' + err.message);
  }
}

async function toggleSchedule(id, enabled) {
  try {
    await fetchApi('/api/schedules/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify({ enabled: enabled }),
    });
    refreshSchedules();
  } catch (err) {
    refreshSchedules();
  }
}

async function deleteSchedule(id) {
  try {
    await fetchApi('/api/schedules/' + encodeURIComponent(id), { method: 'DELETE' });
    refreshSchedules();
  } catch (err) {
    refreshSchedules();
  }
}

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function() {});
}

// --- Boot ---

init();
