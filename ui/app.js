const params = new URLSearchParams(window.location.search);
const server = params.get('controlPlane') || params.get('server') || window.location.origin;
const installId = params.get('installId') || '';

async function fetchJson(path) {
  const url = server.replace(/\/$/, '') + path;
  const res = await fetch(url);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function patchJson(path, body) {
  const url = server.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function renderApprovals(list) {
  const root = document.getElementById('approvals');
  root.innerHTML = '';
  if (!list || !list.length) {
    root.textContent = 'No pending approvals.';
    return;
  }
  list.forEach(a => {
    const el = document.createElement('div');
    el.className = 'card';

    const titleDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = a.actionType || a.envelope?.action?.type || 'unknown';
    titleDiv.appendChild(strong);
    titleDiv.append(' ');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = a.status || 'pending';
    titleDiv.appendChild(badge);
    el.appendChild(titleDiv);

    const resourceDiv = document.createElement('div');
    resourceDiv.className = 'small';
    resourceDiv.textContent = a.resource || a.envelope?.action?.resource || '';
    el.appendChild(resourceDiv);

    const idDiv = document.createElement('div');
    idDiv.className = 'small';
    idDiv.textContent = a.id || '';
    el.appendChild(idDiv);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', async () => {
      approveBtn.disabled = true;
      await patchJson(
        `/receipts/${encodeURIComponent(a.id)}`,
        { status: 'approved' }
      );
      await refresh();
    });
    actionsDiv.appendChild(approveBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'reject';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', async () => {
      rejectBtn.disabled = true;
      await patchJson(
        `/receipts/${encodeURIComponent(a.id)}`,
        { status: 'rejected' }
      );
      await refresh();
    });
    actionsDiv.appendChild(rejectBtn);

    el.appendChild(actionsDiv);
    root.appendChild(el);
  });
}

function renderReceipts(list) {
  const root = document.getElementById('receipts');
  root.innerHTML = '';
  if (!list || !list.length) {
    root.textContent = 'No receipts yet.';
    return;
  }
  list.forEach(r => {
    const el = document.createElement('div');
    el.className = 'card';

    const titleDiv = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = r.actionType || r.envelope?.action?.type || 'unknown';
    titleDiv.appendChild(strong);
    titleDiv.append(' ');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = r.status || r.decisionOutcome || 'unknown';
    titleDiv.appendChild(badge);
    el.appendChild(titleDiv);

    const resourceDiv = document.createElement('div');
    resourceDiv.className = 'small';
    resourceDiv.textContent = r.resource || r.envelope?.action?.resource || '';
    el.appendChild(resourceDiv);

    const idDiv = document.createElement('div');
    idDiv.className = 'small';
    idDiv.textContent = r.id || '';
    el.appendChild(idDiv);

    root.appendChild(el);
  });
}

async function refresh() {
  const approvals = await fetchJson(
    `/receipts?status=pending&decisionOutcome=require_approval${installId ? `&installId=${installId}` : ''}`
  );
  renderApprovals(approvals.receipts || approvals.items || []);

  const receipts = await fetchJson(
    `/receipts?limit=20${installId ? `&installId=${installId}` : ''}`
  );
  renderReceipts(receipts.receipts || receipts.items || []);
}

// Auto-refresh: poll every 5 seconds for new approvals/receipts
const POLL_INTERVAL = 5000;
let pollTimer = null;
let pollActive = true;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (pollActive) refresh();
  }, POLL_INTERVAL);
}

// Pause polling when the tab is hidden to save resources
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pollActive = false;
  } else {
    pollActive = true;
    refresh();
  }
});

// Initial fetch + start auto-refresh
refresh();
startPolling();
