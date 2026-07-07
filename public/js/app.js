const API = '/api';

let currentPage = 1;
let refreshInterval = null;
let quillEditor = null;
let charts = {};
let lastSenderRunning = false;
let selectedListId = 'list1';
let selectedAccountId = 'account2';
let loadedTemplateVersion = 0;
let accountsData = [];
let editingCampaignId = null;

// --- Quill Editor ---

function initEditor() {
  if (quillEditor) return;
  quillEditor = new Quill('#emailEditor', {
    theme: 'snow',
    placeholder: 'Write your email here...',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline'],
        [{ list: 'bullet' }, { list: 'ordered' }],
        ['link'],
      ],
    },
  });
  quillEditor.on('text-change', debounce(() => { runValidation(); updatePreview(); }, 400));
}

function getEditorHtml() {
  return quillEditor ? quillEditor.root.innerHTML : '';
}

function getEditorText() {
  return quillEditor ? quillEditor.getText().trim() : '';
}

function insertAtCursor(text) {
  if (!quillEditor) return;
  const range = quillEditor.getSelection(true);
  quillEditor.insertText(range.index, text);
  quillEditor.setSelection(range.index + text.length);
}

// --- Navigation ---

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    showPage(page);
  });
});

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'compose') loadComposePage();
  if (page === 'contacts') loadContacts();
  if (page === 'campaigns') loadCampaigns();
  if (page === 'settings') loadSettings();
}

// --- Toast ---

function toast(message, type = 'success') {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// --- API helpers ---

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

// --- Dashboard & Charts ---

const CHART_COLORS = {
  sent: '#22c55e',
  failed: '#ef4444',
  pending: '#6366f1',
  denied: '#f97316',
  grid: '#2e3345',
  text: '#8b90a0',
};

function renderAccountQuotas(accounts) {
  const el = document.getElementById('accountQuotas');
  if (!el || !accounts?.length) return;
  el.innerHTML = accounts.map(a => {
    const pct = a.dailyLimit > 0 ? Math.min((a.todaySent / a.dailyLimit) * 100, 100) : 0;
    const short = a.email.split('@')[0];
    return `<div class="sidebar-quota-item">
      <div class="sidebar-quota-label">${a.protected ? '🛡 ' : ''}${short}</div>
      <div class="quota-bar"><div class="quota-fill" style="width:${pct}%"></div></div>
      <div class="quota-text">${a.todaySent} / ${a.dailyLimit}</div>
    </div>`;
  }).join('');
}

function renderAccountCards(accounts) {
  const el = document.getElementById('accountCards');
  if (!el) return;
  if (!accounts?.length) { el.innerHTML = ''; return; }
  el.innerHTML = accounts.map(a => {
    let badge = 'ok', badgeText = 'Healthy';
    if (a.paused) { badge = 'warning'; badgeText = 'Paused'; }
    else if (a.isSending) { badge = 'sending'; badgeText = 'Sending now'; }
    else if (a.running) { badge = 'running'; badgeText = 'Running'; }
    else if (a.blocked) { badge = 'danger'; badgeText = 'Paused (block)'; }
    else if (a.dailyQuotaHit) { badge = 'warning'; badgeText = 'Daily limit'; }
    else if (a.protected) { badge = 'protected'; badgeText = 'Protected'; }
    const pct = a.dailyLimit > 0 ? Math.round((a.todaySent / a.dailyLimit) * 100) : 0;
    return `<div class="account-card ${a.protected ? 'protected' : ''}">
      <div class="account-card-header">
        <div><strong>${escapeHtml(a.label)}</strong><div class="account-card-email">${escapeHtml(a.email)}</div></div>
        <span class="account-badge ${badge}">${badgeText}</span>
      </div>
      <div class="quota-bar" style="margin:8px 0"><div class="quota-fill" style="width:${pct}%"></div></div>
      <div style="font-size:0.85rem;color:var(--text-muted)">
        ${a.todaySent}/${a.dailyLimit} today · ${a.remainingToday} left · ${a.sendDelayMs / 1000}s delay · ${escapeHtml(a.listLabel)}${a.pendingQueue ? ` · ${a.pendingQueue.toLocaleString()} queued` : ''}
      </div>
    </div>`;
  }).join('');
}

function failureLabel(type) {
  const map = {
    invalid_recipient: 'Not found',
    blocked: 'Blocked',
    rate_limit: 'Rate limit',
    daily_quota: 'Quota',
    permanent: 'Failed',
    temporary: 'Temp error',
  };
  return map[type] || type || '';
}

function upsertChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === 'undefined') return;
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    ...config.options,
  };
  if (charts[id]) {
    charts[id].data = config.data;
    charts[id].options = baseOptions;
    charts[id].update('none');
    return;
  }
  charts[id] = new Chart(canvas, { ...config, options: baseOptions });
}

function renderCharts(analytics, progress) {
  const o = analytics.overview;

  upsertChart('chartStatus', {
    type: 'doughnut',
    data: {
      labels: ['Sent', 'Failed', 'Pending'],
      datasets: [{
        data: [o.sent, o.failed, o.pending],
        backgroundColor: [CHART_COLORS.sent, CHART_COLORS.failed, CHART_COLORS.pending],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: CHART_COLORS.text } } },
    },
  });

  const daily = analytics.dailyChart;
  upsertChart('chartDaily', {
    type: 'bar',
    data: {
      labels: daily.map(d => d.day.slice(5)),
      datasets: [
        { label: 'Sent', data: daily.map(d => d.sent), backgroundColor: CHART_COLORS.sent },
        { label: 'Failed', data: daily.map(d => d.failed), backgroundColor: CHART_COLORS.failed },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
        y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
      },
      plugins: { legend: { labels: { color: CHART_COLORS.text } } },
    },
  });

  const hourly = analytics.hourlyToday.filter(h => h.sent > 0 || h.failed > 0);
  const hours = hourly.length > 0 ? hourly : analytics.hourlyToday;
  upsertChart('chartHourly', {
    type: 'line',
    data: {
      labels: hours.map(h => `${h.hour}:00`),
      datasets: [
        { label: 'Sent', data: hours.map(h => h.sent), borderColor: CHART_COLORS.sent, tension: 0.3, fill: false },
        { label: 'Failed', data: hours.map(h => h.failed), borderColor: CHART_COLORS.failed, tension: 0.3, fill: false },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
        y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
      },
      plugins: { legend: { labels: { color: CHART_COLORS.text } } },
    },
  });

  const fb = analytics.failureBreakdown;
  const fbLabels = Object.keys(fb);
  upsertChart('chartFailures', {
    type: 'bar',
    data: {
      labels: fbLabels.length ? fbLabels : ['none'],
      datasets: [{
        label: 'Count',
        data: fbLabels.length ? fbLabels.map(k => fb[k]) : [0],
        backgroundColor: CHART_COLORS.denied,
      }],
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      scales: {
        x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid }, beginAtZero: true },
        y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

async function loadDashboard() {
  try {
    const data = await api('/stats');
    const { sender, recentLogs, progress, analytics } = data;
    const accounts = data.accounts || sender.accounts || [];
    accountsData = accounts;
    const o = analytics.overview;

    document.getElementById('statTotalSent').textContent = o.sent.toLocaleString();
    document.getElementById('statTotalFailed').textContent = o.failed.toLocaleString();
    document.getElementById('statPending').textContent = o.pending.toLocaleString();
    document.getElementById('statSuccessRate').textContent = `${o.successRate}%`;
    document.getElementById('statTodaySent').textContent = o.todaySent.toLocaleString();
    document.getElementById('statReplies').textContent = o.replyCount.toLocaleString();

    renderAccountQuotas(accounts);
    renderAccountCards(accounts);

    renderQueueProgress(sender, progress);
    renderCharts(analytics, progress);

    const liveDot = document.getElementById('liveDot');
    if (sender.running) {
      liveDot.classList.remove('hidden');
    } else {
      liveDot.classList.add('hidden');
    }
    lastSenderRunning = sender.running;

    const badge = document.getElementById('senderBadge');
    if (sender.isSending) {
      badge.textContent = 'Sending...';
      badge.className = 'badge sending';
    } else if (sender.running) {
      badge.textContent = 'Running';
      badge.className = 'badge running';
    } else if (sender.userStopped && progress.pending > 0) {
      badge.textContent = 'Stopped';
      badge.className = 'badge paused';
    } else if (sender.dailyLimitReached) {
      badge.textContent = 'Daily Limit';
      badge.className = 'badge paused';
    } else {
      badge.textContent = 'Idle';
      badge.className = 'badge idle';
    }

    document.getElementById('toggleSender').textContent = sender.running ? 'Stop Sender' : 'Start Sender';
    renderDashboardAlerts(sender, progress);

    const campTbody = document.getElementById('campaignStatsTable');
    if (!analytics.campaignStats.length) {
      campTbody.innerHTML = '<tr><td colspan="10" class="empty-state">No campaigns yet</td></tr>';
    } else {
      campTbody.innerHTML = analytics.campaignStats.map(c => {
        const prog = c.total > 0 ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
        const acc = accounts.find(a => a.id === c.smtp_account_id);
        return `<tr>
          <td>${escapeHtml(c.name)}</td>
          <td style="font-size:0.8rem">${acc ? escapeHtml(acc.email.split('@')[0]) : c.smtp_account_id || '—'}</td>
          <td>${c.list_id || '—'}</td>
          <td style="font-size:0.85rem">${escapeHtml(c.subject || '—')}</td>
          <td><span class="status-badge ${c.status}">${c.status}</span></td>
          <td>${c.sent.toLocaleString()}</td>
          <td>${c.failed.toLocaleString()}</td>
          <td>${c.pending.toLocaleString()}</td>
          <td>${c.successRate}%</td>
          <td>
            <div class="progress-cell">
              <div class="progress-mini"><div class="progress-mini-fill" style="width:${prog}%"></div></div>
              <span>${prog}%</span>
            </div>
          </td>
        </tr>`;
      }).join('');
    }

    const failTbody = document.getElementById('failureReasonsTable');
    if (!analytics.topFailures.length) {
      failTbody.innerHTML = '<tr><td colspan="2" class="empty-state">No failures recorded</td></tr>';
    } else {
      failTbody.innerHTML = analytics.topFailures.map(f => `
        <tr>
          <td>${f.count}</td>
          <td style="font-size:0.85rem">${escapeHtml(f.reason)}</td>
        </tr>
      `).join('');
    }

    const tbody = document.getElementById('recentLogs');
    if (recentLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No activity yet</td></tr>';
    } else {
      tbody.innerHTML = recentLogs.map(log => `
        <tr>
          <td style="white-space:nowrap">${formatDate(log.sent_at)}</td>
          <td>${escapeHtml(log.email)}</td>
          <td style="white-space:nowrap">
            <span class="status-badge ${log.status === 'failed' ? 'failed' : log.status}">${log.status}</span>
            ${log.failure_type ? `<span class="failure-type">${failureLabel(log.failure_type)}</span>` : ''}
          </td>
          <td>
            <div class="log-actions">
              <span class="log-detail-text">${log.error_message ? escapeHtml(log.error_message.slice(0, 120)) : '—'}</span>
              ${log.status === 'sent' ? `<button class="btn btn-sm" onclick='logReply(${JSON.stringify(log.email)})'>Reply</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function logReply(email) {
  const subject = prompt(`Log reply from ${email} — subject (optional):`);
  if (subject === null) return;
  try {
    await api('/replies', { method: 'POST', body: JSON.stringify({ email, subject }) });
    toast('Reply logged');
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderQueueProgress(sender, progress) {
  const card = document.getElementById('queueProgressCard');
  if (!progress || progress.total === 0) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  document.getElementById('progressSent').textContent = progress.sent.toLocaleString();
  document.getElementById('progressPending').textContent = progress.pending.toLocaleString();
  document.getElementById('progressTotal').textContent = progress.total.toLocaleString();
  document.getElementById('progressPercent').textContent = `${progress.percentComplete}%`;
  document.getElementById('campaignProgressFill').style.width = `${progress.percentComplete}%`;

  const detail = document.getElementById('progressDetail');
  const estimate = document.getElementById('progressEstimate');

  if (sender.running) {
    detail.textContent = `Currently sending #${progress.nextPosition} of ${progress.total.toLocaleString()}${progress.nextEmail ? ` → ${progress.nextEmail}` : ''}`;
  } else if (sender.userStopped && progress.pending > 0) {
    detail.innerHTML = `Stopped at <strong>#${sender.stoppedAtPosition || progress.completed}</strong> of ${progress.total.toLocaleString()}. Click <strong>Start Sender</strong> to resume from ${progress.nextEmail || 'next email'}.`;
  } else if (sender.dailyLimitReached && progress.pending > 0) {
    detail.innerHTML = `Today's limit reached (${sender.dailyLimit}/day). <strong>${progress.pending.toLocaleString()}</strong> emails saved — auto-resumes tomorrow at midnight.`;
  } else if (progress.pending > 0) {
    detail.textContent = `Ready to send ${progress.pending.toLocaleString()} remaining emails. Next: ${progress.nextEmail || '—'}`;
  } else {
    detail.textContent = `All ${progress.total.toLocaleString()} emails processed (${progress.sent.toLocaleString()} sent, ${progress.failed} failed).`;
  }

  if (progress.pending > 0 && sender.estimatedDaysRemaining > 0) {
    const combinedDaily = (sender.accounts || []).reduce((sum, a) => sum + (a.remainingToday || 0), 0);
    const dailyNote = (sender.accounts || []).length > 1
      ? `~${combinedDaily} emails/day combined across accounts`
      : `${sender.accounts?.[0]?.dailyLimit || 490}/day`;
    estimate.textContent = `Estimated ~${sender.estimatedDaysRemaining} day(s) remaining at ${dailyNote}`;
  } else {
    estimate.textContent = '';
  }

  const campaigns = progress.activeCampaigns || (progress.activeCampaign ? [progress.activeCampaign] : []);
  const listEl = document.getElementById('activeCampaignsList');
  const actionsEl = document.getElementById('campaignProgressActions');

  if (listEl) {
    if (campaigns.length > 1) {
      listEl.innerHTML = campaigns.map(c => {
        const acc = accountsData.find(a => a.id === c.smtp_account_id);
        return `<div class="active-campaign-row">
          <div class="active-campaign-row-header">
            <div><strong>Campaign #${c.id}</strong> · <span class="status-badge ${c.status}">${c.status}</span></div>
            <div class="campaign-actions-cell">${campaignActions(c)}</div>
          </div>
          <div class="active-campaign-row-meta">
            ${escapeHtml(c.name)} · ${acc ? escapeHtml(acc.email) : c.smtp_account_id} · ${c.list_id || '—'}
          </div>
          <div class="quota-bar"><div class="quota-fill" style="width:${c.percentComplete || 0}%"></div></div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-top:6px">
            ${c.sent.toLocaleString()} sent · ${c.pending.toLocaleString()} remaining · ${c.total.toLocaleString()} total (${c.percentComplete || 0}%)
          </div>
        </div>`;
      }).join('');
      actionsEl?.classList.add('hidden');
      if (actionsEl) actionsEl.innerHTML = '';
    } else {
      listEl.innerHTML = '';
      const active = campaigns[0];
      if (actionsEl && active) {
        actionsEl.classList.remove('hidden');
        actionsEl.innerHTML = campaignActions(active);
      } else if (actionsEl) {
        actionsEl.classList.add('hidden');
        actionsEl.innerHTML = '';
      }
    }
  }

  const parallelHint = document.getElementById('parallelHint');
  if (parallelHint) {
    const runningCount = (sender.accounts || []).filter(a => a.running).length;
    parallelHint.textContent = runningCount > 1
      ? `${runningCount} Gmail accounts sending in parallel right now.`
      : 'Both Gmail accounts can run campaigns in parallel — one campaign per account.';
  }
}

function renderDashboardAlerts(sender, progress) {
  const el = document.getElementById('dashboardAlerts');
  const alerts = [];

  if (progress?.pending > 0 && sender.dailyLimitReached) {
    alerts.push({ type: 'info', msg: `${progress.pending.toLocaleString()} emails queued. Will auto-resume tomorrow (490/day limit).` });
  }
  if (sender.userStopped && progress?.pending > 0) {
    alerts.push({ type: 'warning', msg: `Sender stopped at email #${sender.stoppedAtPosition || progress.completed}. Click Start Sender to continue.` });
  }
  if (sender.dailyQuotaHit) {
    alerts.push({ type: 'error', msg: 'Gmail daily sending limit reached. Queue resumes automatically tomorrow.' });
  }
  if (sender.paused && sender.pauseReason) {
    alerts.push({ type: 'warning', msg: `Account paused: ${sender.pauseReason}${sender.pausedUntil ? `. Resumes at ${formatDate(sender.pausedUntil)}` : ''}` });
  }
  const runningAccounts = (sender.accounts || []).filter(a => a.running);
  if (runningAccounts.length > 1) {
    alerts.push({ type: 'info', msg: `${runningAccounts.length} campaigns sending in parallel (${runningAccounts.map(a => a.email.split('@')[0]).join(' + ')}).` });
  }
  if (sender.lastError?.type === 'blocked') {
    alerts.push({ type: 'error', msg: 'Gmail blocked an email. Review content and wait before resuming.' });
  }

  if (alerts.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = alerts.map(a =>
    `<div class="dashboard-alert ${a.type}">${escapeHtml(a.msg)}</div>`
  ).join('');
}

document.getElementById('toggleSender').addEventListener('click', async () => {
  try {
    const status = await api('/sender/status');
    if (status.running) {
      await api('/sender/stop', { method: 'POST' });
      toast('Sender stopped — progress saved. Click Start to resume from where you left off.');
    } else {
      await api('/sender/start', { method: 'POST' });
      toast('Sender resumed from saved position');
    }
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// --- Compose ---

async function loadAccounts() {
  try {
    const data = await api('/accounts');
    accountsData = data.accounts || [];
    return data;
  } catch {
    return { accounts: [], lists: {} };
  }
}

function populateAccountSelect() {
  const sel = document.getElementById('smtpAccountSelect');
  if (!sel) return;
  sel.innerHTML = accountsData.map(a =>
    `<option value="${a.id}" ${a.id === selectedAccountId ? 'selected' : ''}>${escapeHtml(a.label)} — ${escapeHtml(a.email)} (${a.dailyLimit}/day${a.protected ? ', protected' : ''})</option>`
  ).join('');
}

function getSelectedAccount() {
  return accountsData.find(a => a.id === selectedAccountId) || accountsData[0];
}

async function updateComposeMeta() {
  const acc = getSelectedAccount();
  if (!acc) return;
  document.getElementById('composeFrom').textContent = acc.email;
  const lists = await api('/accounts');
  const listCounts = lists.lists[acc.listId] || { active: 0, total: 0, bounced: 0, blocked: 0 };
  document.getElementById('composeContactCount').textContent = `${listCounts.active.toLocaleString()} eligible`;
  document.getElementById('composeTo').textContent = listCounts.active > 0
    ? `${acc.listLabel} (${listCounts.active.toLocaleString()} contacts, duplicates skipped)`
    : `Upload file to ${acc.listLabel} in Contacts tab`;
  const hint = document.getElementById('accountHint');
  if (hint) {
    hint.textContent = acc.protected
      ? `🛡 Protected: ${acc.dailyLimit}/day max, ${acc.sendDelayMs / 1000}s between sends, extended pause on blocks`
      : `Standard: ${acc.dailyLimit}/day, ${acc.sendDelayMs / 1000}s delay between sends`;
  }
  if (listCounts.active > 0) document.getElementById('step2')?.classList.add('done');
}

async function updatePreview() {
  const subject = document.getElementById('campaignSubject')?.value.trim();
  const body = getEditorHtml();
  if (!subject && !getEditorText()) return;

  try {
    const sample = testModes.compose === 'manual'
      ? getTestSampleContact('compose')
      : (previewSampleContact || undefined);
    const preview = await api('/campaigns/preview', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        body,
        preheader: document.getElementById('campaignPreheader').value.trim(),
        include_unsubscribe: document.getElementById('includeUnsubscribe').checked,
        smtp_account_id: selectedAccountId,
        sample_contact: sample,
      }),
    });
    document.getElementById('previewFrom').textContent = `${preview.fromName} <${preview.from}>`;
    document.getElementById('previewTo').textContent = preview.to;
    document.getElementById('previewSubject').textContent = preview.subject;
    document.getElementById('previewPlain').textContent = preview.text;
    const frame = document.getElementById('previewFrame');
    if (frame) frame.srcdoc = preview.html;
  } catch { /* ignore preview errors during typing */ }
}

async function loadComposePage() {
  initEditor();
  try {
    await loadAccounts();
    if (accountsData.find(a => a.id === 'account2')) selectedAccountId = 'account2';
    populateAccountSelect();
    document.getElementById('smtpAccountSelect').value = selectedAccountId;
    await updateComposeMeta();
    await loadDefaultEmail(true);
    document.getElementById('step1')?.classList.add('done');
  } catch { /* ignore */ }
}

document.getElementById('smtpAccountSelect')?.addEventListener('change', async (e) => {
  selectedAccountId = e.target.value;
  await updateComposeMeta();
  await updatePreview();
});

document.getElementById('refreshPreview')?.addEventListener('click', () => updatePreview());

async function runValidation() {
  const subject = document.getElementById('campaignSubject').value.trim();
  const body = getEditorHtml();
  const preheader = document.getElementById('campaignPreheader').value.trim();

  if (!subject && !getEditorText()) return;

  try {
    const result = await api('/campaigns/validate', {
      method: 'POST',
      body: JSON.stringify({ subject, body, preheader }),
    });
    updateDeliverabilityUI(result);
    updatePreview();
  } catch { /* ignore */ }
}

function updateDeliverabilityUI(result) {
  const badge = document.getElementById('deliverabilityBadge');
  const warnings = document.getElementById('deliverabilityWarnings');

  badge.textContent = result.deliverability.charAt(0).toUpperCase() + result.deliverability.slice(1);
  badge.className = `score-badge ${result.deliverability}`;

  if (result.warnings.length === 0) {
    warnings.innerHTML = '<li style="color:var(--success)">✓ No spam issues detected</li>';
  } else {
    warnings.innerHTML = result.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  }
}

let templateLoaded = false;
let previewSampleContact = null;
const testModes = { compose: 'quick', dashboard: 'quick' };

function readManualContact(panel) {
  const id = (name) => (document.getElementById(name)?.value || '').trim();
  const isDash = panel === 'dashboard';
  const first = id(isDash ? 'dashTestFirstName' : 'testFirstName');
  const last = id(isDash ? 'dashTestLastName' : 'testLastName');
  return {
    first_name: first,
    last_name: last,
    name: [first, last].filter(Boolean).join(' '),
    title: id(isDash ? 'dashTestTitle' : 'testTitle'),
    company: id(isDash ? 'dashTestCompany' : 'testCompany'),
    city: id(isDash ? 'dashTestCity' : 'testCity'),
    industry: id(isDash ? 'dashTestIndustry' : 'testIndustry'),
    company_profile: id(isDash ? 'dashTestCompanyProfile' : 'testCompanyProfile'),
    email: id(isDash ? 'dashTestTo' : 'testTo') || 'ahmadjutt463@gmail.com',
  };
}

function getTestSampleContact(panel) {
  if (testModes[panel] === 'manual') {
    const c = readManualContact(panel);
    if (!c.first_name || !c.title || !c.company) {
      throw new Error('Fill in First Name, Job Title, and Company for manual test');
    }
    if (!c.city) throw new Error('City is required for timezone line in email');
    return c;
  }
  return previewSampleContact || {
    first_name: 'Alex', last_name: 'Morgan', name: 'Alex Morgan',
    title: 'VP of Engineering', company: 'Example Technologies',
    city: 'San Francisco', industry: 'Information Technology',
    company_profile: 'Example Technologies builds cloud-native analytics tools for mid-market SaaS companies.',
    email: 'alex@example.com',
  };
}

function setTestMode(panel, mode) {
  testModes[panel] = mode;
  const manualId = panel === 'dashboard' ? 'dashManualTestFields' : 'composeManualTestFields';
  const quickId = panel === 'dashboard' ? 'dashQuickTestHint' : 'composeQuickTestHint';
  document.getElementById(manualId)?.classList.toggle('hidden', mode !== 'manual');
  document.getElementById(quickId)?.classList.toggle('hidden', mode === 'manual');
  document.querySelectorAll(`[data-test-panel="${panel}"]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.testMode === mode);
  });
}

document.querySelectorAll('[data-test-panel]').forEach(btn => {
  btn.addEventListener('click', () => {
    setTestMode(btn.dataset.testPanel, btn.dataset.testMode);
    if (btn.dataset.testPanel === 'compose') updatePreview();
  });
});

async function getEmailContentForTest(source) {
  if (source === 'compose') {
    const subject = document.getElementById('campaignSubject')?.value.trim();
    const body = getEditorHtml();
    const preheader = document.getElementById('campaignPreheader')?.value.trim();
    if (!subject || !getEditorText()) throw new Error('Load default email or write content in Compose first');
    return { subject, body, preheader };
  }

  const campaigns = await api('/campaigns');
  const active = campaigns.find(c => ['sending', 'queued', 'paused'].includes(c.status));
  if (active) {
    const full = await api(`/campaigns/${active.id}`);
    return {
      subject: full.subject,
      body: full.body_html,
      preheader: full.preheader || '',
      attachmentNote: active.attachment ? 'Using campaign attachment if present on server' : null,
    };
  }

  const tpl = await api('/campaigns/templates/default');
  return { subject: tpl.subject, body: tpl.body_html, preheader: tpl.preheader || '' };
}

async function sendTestFromPanel(source) {
  const panel = source;
  const btnId = source === 'dashboard' ? 'dashSendTestEmail' : 'sendTestEmail';
  const btn = document.getElementById(btnId);
  const data = source === 'compose' ? getComposeFormData() : {};
  const content = await getEmailContentForTest(source);
  const sample = getTestSampleContact(panel);

  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = 'Sending test...';

  try {
    const formData = new FormData();
    formData.append('subject', content.subject);
    formData.append('body', content.body);
    formData.append('preheader', content.preheader || data.preheader || '');
    formData.append('include_unsubscribe', document.getElementById('includeUnsubscribe')?.checked ?? false);
    formData.append('smtp_account_id', selectedAccountId || 'account2');
    formData.append('sample_contact', JSON.stringify(sample));
    formData.append('test_to', sample.email);
    const attach = document.getElementById('campaignAttachment')?.files[0];
    if (attach) formData.append('attachment', attach);

    const res = await fetch('/api/campaigns/test-email', { method: 'POST', body: formData });
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || result.error);
    toast(result.message);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

async function previewWithManualFields() {
  try {
    const sample = getTestSampleContact('compose');
    previewSampleContact = sample;
    await updatePreview();
    toast(`Preview updated for ${sample.first_name} at ${sample.company}`);
    showPage('compose');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function dashPreviewTest() {
  try {
    const sample = getTestSampleContact('dashboard');
    const content = await getEmailContentForTest('dashboard');
    const preview = await api('/campaigns/preview', {
      method: 'POST',
      body: JSON.stringify({
        subject: content.subject,
        body: content.body,
        preheader: content.preheader,
        smtp_account_id: 'account2',
        sample_contact: sample,
      }),
    });
    showPage('compose');
    document.getElementById('campaignSubject').value = content.subject;
    if (quillEditor) quillEditor.root.innerHTML = content.body;
    previewSampleContact = sample;
    document.getElementById('previewFrom').textContent = `${preview.fromName} <${preview.from}>`;
    document.getElementById('previewTo').textContent = sample.email;
    document.getElementById('previewSubject').textContent = preview.subject;
    document.getElementById('previewPlain').textContent = preview.text;
    document.getElementById('previewFrame').srcdoc = preview.html;
    setTestMode('compose', 'manual');
    document.getElementById('testFirstName').value = sample.first_name;
    document.getElementById('testLastName').value = sample.last_name || '';
    document.getElementById('testTitle').value = sample.title;
    document.getElementById('testCompany').value = sample.company;
    document.getElementById('testCity').value = sample.city || '';
    document.getElementById('testIndustry').value = sample.industry || '';
    document.getElementById('testCompanyProfile').value = sample.company_profile || '';
    document.getElementById('testTo').value = sample.email;
    toast(`Preview loaded for ${sample.first_name} at ${sample.company}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('sendTestEmail')?.addEventListener('click', () => sendTestFromPanel('compose'));
document.getElementById('dashSendTestEmail')?.addEventListener('click', () => sendTestFromPanel('dashboard'));
document.getElementById('previewManualTest')?.addEventListener('click', previewWithManualFields);
document.getElementById('dashPreviewTest')?.addEventListener('click', dashPreviewTest);

function fillManualTestDefaults(sample) {
  if (!sample) return;
  const fields = [
    ['testFirstName', 'dashTestFirstName', sample.first_name],
    ['testLastName', 'dashTestLastName', sample.last_name],
    ['testTitle', 'dashTestTitle', sample.title],
    ['testCompany', 'dashTestCompany', sample.company],
    ['testCity', 'dashTestCity', sample.city],
    ['testIndustry', 'dashTestIndustry', sample.industry],
    ['testCompanyProfile', 'dashTestCompanyProfile', sample.company_profile],
    ['testTo', 'dashTestTo', 'ahmadjutt463@gmail.com'],
  ];
  for (const [composeId, dashId, val] of fields) {
    if (val && document.getElementById(composeId)) document.getElementById(composeId).value = val;
    if (val && document.getElementById(dashId)) document.getElementById(dashId).value = val;
  }
}

async function loadDefaultEmail(silent = false) {
  try {
    const tpl = await api('/campaigns/templates/default');
    const needsReload = !templateLoaded || (tpl.version && tpl.version !== loadedTemplateVersion);
    if (!needsReload && getEditorText()) {
      await updatePreview();
      return;
    }
    document.getElementById('campaignSubject').value = tpl.subject;
    document.getElementById('campaignPreheader').value = tpl.preheader || '';
    if (quillEditor) quillEditor.root.innerHTML = tpl.body_html;
    document.getElementById('campaignName').value = tpl.name;
    previewSampleContact = tpl.sample_contact || null;
    fillManualTestDefaults(tpl.sample_contact);
    templateLoaded = true;
    loadedTemplateVersion = tpl.version || 0;
    document.getElementById('step1')?.classList.add('done');
    runValidation();
    updatePreview();
    if (!silent) toast('Default email loaded — attach resume, preview, test, then send');
  } catch (err) {
    if (!silent) toast(err.message, 'error');
  }
}

function getComposeFormData() {
  return {
    subject: document.getElementById('campaignSubject').value.trim(),
    body: getEditorHtml(),
    preheader: document.getElementById('campaignPreheader').value.trim(),
    includeUnsubscribe: document.getElementById('includeUnsubscribe').checked,
    attachmentFile: document.getElementById('campaignAttachment').files[0],
  };
}

function buildFormData(data) {
  const acc = getSelectedAccount();
  const formData = new FormData();
  formData.append('name', data.name || 'Ahmad Yaseen - Senior Software Developer (IoT, AI, Embedded, Full Stack)');
  formData.append('subject', data.subject);
  formData.append('body', data.body);
  formData.append('preheader', data.preheader);
  formData.append('include_unsubscribe', data.includeUnsubscribe);
  formData.append('smtp_account_id', selectedAccountId);
  formData.append('list_id', acc?.listId || 'list1');
  if (data.attachmentFile) formData.append('attachment', data.attachmentFile);
  return formData;
}

document.getElementById('campaignSubject').addEventListener('input', debounce(() => { runValidation(); updatePreview(); }, 400));
document.getElementById('campaignPreheader').addEventListener('input', debounce(() => { runValidation(); updatePreview(); }, 400));

document.getElementById('loadDefaultEmail').addEventListener('click', () => loadDefaultEmail(false));

document.getElementById('composeForm').addEventListener('submit', (e) => e.preventDefault());

document.getElementById('saveAndSend').addEventListener('click', async () => {
  if (editingCampaignId) {
    await saveCampaignEdits(true);
    return;
  }
  await saveCampaign(true);
});

document.getElementById('saveCampaignEdits')?.addEventListener('click', () => saveCampaignEdits(false));
document.getElementById('saveAndResumeCampaign')?.addEventListener('click', () => saveCampaignEdits(true));
document.getElementById('cancelEditCampaign')?.addEventListener('click', cancelEditCampaign);

async function saveCampaign(andSend) {
  if (editingCampaignId) {
    await saveCampaignEdits(andSend);
    return;
  }
  if (!templateLoaded && !getEditorText()) {
    await loadDefaultEmail(true);
  }

  const data = getComposeFormData();
  const name = 'Ahmad Yaseen - Senior Software Developer (IoT, AI, Embedded, Full Stack)';

  if (!data.subject || !getEditorText()) {
    toast('Click "Load Default Email" first', 'error');
    return;
  }

  if (andSend && !data.attachmentFile) {
    toast('Please attach your resume before sending the campaign', 'error');
    return;
  }

  const acc = getSelectedAccount();
  const lists = await api('/accounts');
  const listCounts = lists.lists[acc?.listId] || { active: 0 };

  if (andSend && listCounts.active === 0) {
    toast(`Upload contacts to ${acc?.listLabel || 'the list'} first`, 'error');
    showPage('contacts');
    return;
  }

  if (andSend && !confirm(`Send campaign from ${acc?.email} to ${listCounts.active.toLocaleString()} contacts on ${acc?.listLabel}?\n\nDuplicates & bounced addresses will be skipped.\nLimit: ${acc?.dailyLimit}/day`)) {
    return;
  }

  const validation = await api('/campaigns/validate', {
    method: 'POST',
    body: JSON.stringify({ subject: data.subject, body: data.body, preheader: data.preheader }),
  });

  if (!validation.valid) {
    toast(validation.errors.join('. '), 'error');
    return;
  }

  const formData = buildFormData({ ...data, name });

  try {
    const res = await fetch('/api/campaigns', { method: 'POST', body: formData });
    const campaign = await res.json();
    if (!res.ok) throw new Error(campaign.error || 'Failed to save campaign');

    if (andSend) {
      const result = await api(`/campaigns/${campaign.id}/send`, { method: 'POST' });
      toast(result.message);
      document.getElementById('step3')?.classList.add('done');
      showPage('dashboard');
    } else {
      toast('Campaign saved');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('campaignAttachment').addEventListener('change', (e) => {
  const file = e.target.files[0];
  document.getElementById('attachmentName').textContent = file
    ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)`
    : 'Max 25 MB';
});

// --- Contacts ---

function renderListTabs(accounts, lists) {
  const el = document.getElementById('listTabs');
  if (!el) return;
  el.innerHTML = accounts.map(a => {
    const c = lists[a.listId] || { active: 0, total: 0 };
    return `<button class="list-tab ${selectedListId === a.listId ? 'active' : ''}" data-list="${a.listId}" data-account="${a.id}">
      ${escapeHtml(a.listLabel)} <span style="opacity:0.7">(${c.total.toLocaleString()})</span>
    </button>`;
  }).join('');
  el.querySelectorAll('.list-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectedListId = tab.dataset.list;
      renderListTabs(accounts, lists);
      renderListSummary(lists);
      loadContacts(1);
    });
  });
}

function renderListSummary(lists) {
  const el = document.getElementById('listSummary');
  const acc = accountsData.find(a => a.listId === selectedListId);
  const c = lists[selectedListId] || { active: 0, total: 0, bounced: 0, blocked: 0 };
  if (!el) return;
  el.innerHTML = `<strong>${acc?.listLabel || selectedListId}</strong> → sends via <strong>${acc?.email || '—'}</strong>
    · ${c.active.toLocaleString()} active · ${c.bounced || 0} bounced · ${c.blocked || 0} blocked · ${c.total.toLocaleString()} total`;
  const uploadLabel = document.getElementById('uploadBtnLabel');
  if (uploadLabel) uploadLabel.childNodes[0].textContent = `Upload to ${acc?.listLabel || 'List'} `;
}

async function loadContacts(page = 1) {
  currentPage = page;
  const search = document.getElementById('contactSearch').value;

  try {
    const accountData = await loadAccounts();
    renderListTabs(accountData.accounts, accountData.lists);
    renderListSummary(accountData.lists);

    const data = await api(`/contacts?page=${page}&limit=50&search=${encodeURIComponent(search)}&list_id=${selectedListId}`);
    const tbody = document.getElementById('contactsTable');

    if (data.contacts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No contacts in this list. Upload your .xlsx or .csv file.</td></tr>';
    } else {
      tbody.innerHTML = data.contacts.map(c => `
        <tr>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '—')}</td>
          <td>${escapeHtml(c.title || '—')}</td>
          <td>${escapeHtml(c.company || '—')}</td>
          <td><span class="status-badge ${c.status}">${c.status}</span></td>
          <td style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml((c.failure_reason || '').slice(0, 60) || '—')}</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteContact(${c.id})">Delete</button></td>
        </tr>
      `).join('');
    }

    renderPagination(data.total, data.page, data.limit);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPagination(total, page, limit) {
  const pages = Math.ceil(total / limit);
  const el = document.getElementById('contactsPagination');
  if (pages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  for (let i = 1; i <= pages; i++) {
    html += `<button class="btn btn-sm ${i === page ? 'btn-primary' : ''}" onclick="loadContacts(${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

document.getElementById('contactSearch').addEventListener('input', debounce(() => loadContacts(1), 300));

document.getElementById('csvUpload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('list_id', selectedListId);

  try {
    const res = await fetch('/api/contacts/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(`Added ${data.added.toLocaleString()} to ${data.listLabel || selectedListId} (${data.skipped} duplicates skipped)`);
    document.getElementById('step2')?.classList.add('done');
    loadContacts();
  } catch (err) {
    toast(err.message, 'error');
  }
  e.target.value = '';
});

document.getElementById('addContactBtn').addEventListener('click', () => {
  document.getElementById('addContactModal').classList.remove('hidden');
});

document.getElementById('closeModal').addEventListener('click', () => {
  document.getElementById('addContactModal').classList.add('hidden');
});

document.getElementById('addContactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('newContactEmail').value.trim();
  const name = document.getElementById('newContactName').value.trim();

  try {
    await api('/contacts', { method: 'POST', body: JSON.stringify({ email, name, list_id: selectedListId }) });
    toast('Contact added');
    document.getElementById('addContactModal').classList.add('hidden');
    document.getElementById('addContactForm').reset();
    loadContacts();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('clearContacts').addEventListener('click', async () => {
  const acc = accountsData.find(a => a.listId === selectedListId);
  if (!confirm(`Delete ALL contacts in ${acc?.listLabel || selectedListId}? This cannot be undone.`)) return;
  try {
    await api(`/contacts?list_id=${selectedListId}`, { method: 'DELETE' });
    toast('List cleared');
    loadContacts();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try {
    await api(`/contacts/${id}`, { method: 'DELETE' });
    loadContacts(currentPage);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- Campaigns ---

async function loadCampaigns() {
  try {
    const campaigns = await api('/campaigns');
    const tbody = document.getElementById('campaignsTable');

    if (campaigns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No campaigns yet. Compose one to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = campaigns.map(c => {
      const acc = accountsData.find(a => a.id === c.smtp_account_id);
      return `<tr>
        <td>${escapeHtml(c.name)}${c.attachment ? ' 📎' : ''}</td>
        <td style="font-size:0.8rem">${acc ? escapeHtml(acc.email.split('@')[0]) : c.smtp_account_id || '—'}</td>
        <td>${c.list_id || '—'}</td>
        <td>${escapeHtml(c.subject)}</td>
        <td><span class="status-badge ${c.status}">${c.status}</span></td>
        <td>${c.sent_count}</td>
        <td>${c.failed_count}</td>
        <td>${c.total_recipients}</td>
        <td>${formatDate(c.created_at)}</td>
        <td>${campaignActions(c)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function campaignActions(c) {
  if (c.status === 'draft') {
    return `<button class="btn btn-sm btn-success" onclick="sendCampaign(${c.id})">Send</button>`;
  }
  if (c.status === 'paused') {
    return `<button class="btn btn-sm" onclick="editCampaign(${c.id})">Edit</button>
      <button class="btn btn-sm btn-primary" onclick="resumeCampaign(${c.id})">Resume</button>`;
  }
  if (c.status === 'sending' || c.status === 'queued') {
    return `<button class="btn btn-sm" onclick="pauseAndEditCampaign(${c.id})">Pause &amp; Edit</button>
      <button class="btn btn-sm" onclick="pauseCampaign(${c.id})">Pause</button>`;
  }
  return '—';
}

async function editCampaign(id) {
  try {
    const campaign = await api(`/campaigns/${id}`);
    if (!['draft', 'paused'].includes(campaign.status)) {
      toast('Pause the campaign before editing', 'error');
      return;
    }

    editingCampaignId = id;
    initEditor();
    showPage('compose');

    document.getElementById('campaignSubject').value = campaign.subject || '';
    document.getElementById('campaignPreheader').value = campaign.preheader || '';
    document.getElementById('includeUnsubscribe').checked = campaign.include_unsubscribe === true;
    if (quillEditor) quillEditor.root.innerHTML = campaign.body_html || '';

    if (campaign.smtp_account_id) {
      selectedAccountId = campaign.smtp_account_id;
      const sel = document.getElementById('smtpAccountSelect');
      if (sel) sel.value = campaign.smtp_account_id;
    }

    const attachLabel = campaign.attachment?.filename
      ? `${campaign.attachment.filename} (on server — upload a new file to replace)`
      : 'Max 25 MB';
    document.getElementById('attachmentName').textContent = attachLabel;

    const banner = document.getElementById('editCampaignBanner');
    const title = document.getElementById('editCampaignTitle');
    const hint = document.getElementById('editCampaignHint');
    banner?.classList.remove('hidden');
    if (title) {
      title.textContent = campaign.status === 'paused'
        ? `Editing paused campaign #${id} (${campaign.sent_count.toLocaleString()} already sent)`
        : `Editing draft campaign #${id}`;
    }
    if (hint) {
      hint.textContent = campaign.status === 'paused'
        ? `${(campaign.total_recipients - campaign.sent_count).toLocaleString()} emails still queued — updated content applies when you resume.`
        : 'Save your changes before sending.';
    }

    previewSampleContact = null;
    await updatePreview();
    toast(campaign.status === 'paused' ? 'Campaign loaded — edit, save, then resume' : 'Draft loaded for editing');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function cancelEditCampaign() {
  editingCampaignId = null;
  document.getElementById('editCampaignBanner')?.classList.add('hidden');
  toast('Edit cancelled');
}

async function saveCampaignEdits(andResume = false) {
  if (!editingCampaignId) {
    toast('No campaign selected for editing', 'error');
    return;
  }

  const data = getComposeFormData();
  if (!data.subject || !getEditorText()) {
    toast('Subject and body are required', 'error');
    return;
  }

  const validation = await api('/campaigns/validate', {
    method: 'POST',
    body: JSON.stringify({ subject: data.subject, body: data.body, preheader: data.preheader }),
  });
  if (!validation.valid) {
    toast(validation.errors.join('. '), 'error');
    return;
  }

  const formData = new FormData();
  formData.append('subject', data.subject);
  formData.append('body', data.body);
  formData.append('preheader', data.preheader);
  formData.append('include_unsubscribe', data.includeUnsubscribe);
  if (data.attachmentFile) formData.append('attachment', data.attachmentFile);

  try {
    const res = await fetch(`/api/campaigns/${editingCampaignId}`, { method: 'PUT', body: formData });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to update campaign');

    toast(result.message || 'Campaign updated');

    if (andResume) {
      await resumeCampaign(editingCampaignId);
      editingCampaignId = null;
      document.getElementById('editCampaignBanner')?.classList.add('hidden');
      showPage('dashboard');
    }

    loadCampaigns();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function pauseAndEditCampaign(id) {
  try {
    const result = await api(`/campaigns/${id}/pause`, { method: 'POST' });
    toast(result.message || 'Campaign paused');
    loadCampaigns();
    loadDashboard();
    await editCampaign(id);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendCampaign(id) {
  if (!confirm('Send this campaign to all active contacts?')) return;
  try {
    const result = await api(`/campaigns/${id}/send`, { method: 'POST' });
    toast(result.message);
    loadCampaigns();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function pauseCampaign(id) {
  try {
    const result = await api(`/campaigns/${id}/pause`, { method: 'POST' });
    toast(result.message || 'Campaign paused — open Campaigns or Compose to edit');
    loadCampaigns();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function resumeCampaign(id) {
  try {
    await api(`/campaigns/${id}/resume`, { method: 'POST' });
    toast('Campaign resumed — remaining emails use the latest content');
    editingCampaignId = null;
    document.getElementById('editCampaignBanner')?.classList.add('hidden');
    loadCampaigns();
    loadDashboard();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- Settings ---

async function loadSettings() {
  try {
    const data = await loadAccounts();
    const el = document.getElementById('settingsAccounts');
    if (!el) return;

    el.innerHTML = data.accounts.map(a => `
      <div class="card account-card ${a.protected ? 'protected' : ''}">
        <h2>${escapeHtml(a.label)}</h2>
        <p class="account-card-email">${escapeHtml(a.email)}</p>
        <ul class="tips-list">
          <li><strong>${a.dailyLimit}/day</strong> limit · <strong>${a.sendDelayMs / 1000}s</strong> delay between sends</li>
          <li>List: <strong>${escapeHtml(a.listLabel)}</strong> (${(data.lists[a.listId]?.total || 0).toLocaleString()} contacts)</li>
          <li>Today: ${a.todaySent}/${a.dailyLimit} sent · ${a.remainingToday} remaining</li>
          ${a.protected ? '<li>🛡 <strong>Protected mode</strong> — extended pauses on blocks</li>' : ''}
        </ul>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" onclick="testAccountSmtp('${a.id}')">Test Connection</button>
        </div>
        <div id="smtpStatus-${a.id}" class="alert hidden"></div>
      </div>
    `).join('');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function testAccountSmtp(accountId) {
  const statusEl = document.getElementById(`smtpStatus-${accountId}`);
  try {
    const result = await api('/smtp/test', { method: 'POST', body: JSON.stringify({ account: accountId }) });
    statusEl.className = 'alert success';
    statusEl.textContent = result.message;
    statusEl.classList.remove('hidden');
  } catch (err) {
    statusEl.className = 'alert error';
    statusEl.textContent = err.message;
    statusEl.classList.remove('hidden');
  }
}

// --- Utils ---

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.endsWith('Z') ? str : str + 'Z');
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Auto-refresh — every 2 seconds on dashboard for live monitoring
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    const dash = document.getElementById('page-dashboard');
    if (dash.classList.contains('active')) loadDashboard();
    const camps = document.getElementById('page-campaigns');
    if (camps.classList.contains('active')) loadCampaigns();
  }, 2000);
}

// Init
initEditor();
loadDashboard();
startAutoRefresh();
