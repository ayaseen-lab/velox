/* Reachly Pro — Email Config, Lead Research, Variables */

let selectedEmailProvider = 'gmail';
let selectedLeadProvider = 'apollo';
let leadSearchResults = [];

function insertVariableToken(token) {
  if (!token) return;
  if (typeof insertAtCursor === 'function' && typeof quillEditor !== 'undefined' && quillEditor) {
    insertAtCursor(token);
    toast(`Inserted ${token}`);
    if (typeof updatePreview === 'function') updatePreview();
    return;
  }
  toast(`Token: ${token}`, 'error');
}

async function loadVariablesPanel() {
  try {
    const data = await api('/variables');
    const dataEl = document.getElementById('dataVariableChips');
    const genEl = document.getElementById('generatedVariableChips');
    const customEl = document.getElementById('customVariableChips');

    if (dataEl) {
      dataEl.innerHTML = (data.data || [])
        .filter(v => v.source === 'data')
        .map(v => `<button type="button" class="var-chip data" onclick="insertVariableToken('${v.token}')" title="From contact: ${escapeHtml(v.label)}"><code>${escapeHtml(v.token)}</code> ${escapeHtml(v.label)}</button>`)
        .join('');
    }
    if (genEl) {
      genEl.innerHTML = (data.data || [])
        .filter(v => v.source === 'generated')
        .map(v => `<button type="button" class="var-chip generated" onclick="insertVariableToken('${v.token}')" title="${escapeHtml(v.label)}"><code>${escapeHtml(v.token)}</code> ${escapeHtml(v.label)}</button>`)
        .join('');
    }
    if (customEl) {
      customEl.innerHTML = (data.custom || []).map(v => `
        <span class="var-chip static">
          <button type="button" onclick="insertVariableToken('${escapeHtml(v.token)}')" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:6px">
            <code>${escapeHtml(v.token)}</code> ${escapeHtml(v.name)}
          </button>
          <span class="var-delete" onclick="deleteCustomVariable(${v.id})" title="Remove">×</span>
        </span>`).join('') || '<span class="hint">No static variables yet — add one below.</span>';
    }
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('newVarName')?.addEventListener('input', (e) => {
  const slug = e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
  const el = document.getElementById('newVarPreview');
  if (el) el.value = slug ? `{{${slug}}}` : '';
});

document.getElementById('addCustomVariable')?.addEventListener('click', async () => {
  const name = document.getElementById('newVarName')?.value.trim();
  const content = document.getElementById('newVarContent')?.value.trim();
  if (!name || !content) {
    toast('Variable name and content are required', 'error');
    return;
  }
  try {
    await api('/variables/custom', { method: 'POST', body: JSON.stringify({ name, value: content, content }) });
    document.getElementById('newVarName').value = '';
    document.getElementById('newVarContent').value = '';
    document.getElementById('newVarPreview').value = '';
    toast('Static variable added');
    loadVariablesPanel();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function deleteCustomVariable(id) {
  if (!confirm('Remove this variable?')) return;
  try {
    await api(`/variables/custom/${id}`, { method: 'DELETE' });
    loadVariablesPanel();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// --- Email Configuration ---

async function loadEmailConfig() {
  try {
    const [providers, accounts] = await Promise.all([
      api('/email-providers'),
      api('/email-config/accounts'),
    ]);

    const grid = document.getElementById('emailProviderGrid');
    if (grid) {
      grid.innerHTML = providers.map(p => `
        <div class="provider-card ${p.id === selectedEmailProvider ? 'active' : ''}" data-provider="${p.id}" onclick="selectEmailProvider('${p.id}')">
          <div class="provider-icon">${p.icon}</div>
          <strong>${escapeHtml(p.name)}</strong>
          <span>${p.host || 'Custom host'}</span>
        </div>`).join('');
    }

    const sel = document.getElementById('smtpProvider');
    if (sel) {
      sel.innerHTML = providers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      sel.value = selectedEmailProvider;
      sel.onchange = () => selectEmailProvider(sel.value);
    }

    applyProviderPreset(selectedEmailProvider, providers);
    renderConnectedAccounts(accounts);
    loadHostingerMailApiStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadHostingerMailApiStatus() {
  const el = document.getElementById('hostingerMailApiStatus');
  if (!el) return;
  try {
    const status = await api('/email-config/mail-api');
    el.classList.remove('hidden');
    if (status.ok) {
      const addrs = (status.mailboxes || []).map((b) => b.address).filter(Boolean).join(', ');
      el.className = 'alert success';
      el.textContent = `Mail API connected${addrs ? ` (${addrs})` : ''}`;
    } else if (status.tokenSet) {
      el.className = 'alert error';
      el.textContent = status.message || 'Mail API token rejected';
    } else {
      el.className = 'alert';
      el.textContent = 'No Mail API token yet — required for Railway sending';
    }
  } catch (err) {
    el.className = 'alert error';
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
}

document.getElementById('saveHostingerMailApi')?.addEventListener('click', async () => {
  const token = document.getElementById('hostingerMailApiToken')?.value.trim();
  if (!token) {
    toast('Paste a Hostinger Mail API token first', 'error');
    return;
  }
  try {
    const status = await api('/email-config/mail-api', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    document.getElementById('hostingerMailApiToken').value = '';
    toast(status.ok ? 'Hostinger Mail API saved' : (status.message || 'Token saved'));
    loadHostingerMailApiStatus();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function selectEmailProvider(id) {
  selectedEmailProvider = id;
  document.querySelectorAll('.provider-card').forEach(c => {
    c.classList.toggle('active', c.dataset.provider === id);
  });
  const sel = document.getElementById('smtpProvider');
  if (sel) sel.value = id;
  api('/email-providers').then(providers => applyProviderPreset(id, providers)).catch(() => {});
}

function applyProviderPreset(id, providers) {
  const p = (providers || []).find(x => x.id === id) || {};
  if (document.getElementById('smtpHost')) document.getElementById('smtpHost').value = p.host || '';
  if (document.getElementById('smtpPort')) document.getElementById('smtpPort').value = p.port || 587;
  if (document.getElementById('smtpSecure')) document.getElementById('smtpSecure').value = p.secure ? 'true' : 'false';
  const hint = document.getElementById('smtpProviderHint');
  if (hint) hint.textContent = p.hint || '';
}

function renderConnectedAccounts(data) {
  const el = document.getElementById('connectedAccountsList');
  if (!el) return;
  const rows = [
    ...(data.envAccounts || []).map(a => ({ ...a, readonly: true })),
    ...(data.demoAccounts || []).map(a => ({ ...a, readonly: true, isDemo: true })),
    ...(data.savedAccounts || []).map(a => ({ ...a, readonly: false })),
  ];
  if (!rows.length) {
    el.innerHTML = '<p class="hint">No accounts configured yet.</p>';
    return;
  }
  el.innerHTML = rows.map((a, i) => `
    <div class="account-row">
      <div>
        <strong>${escapeHtml(a.label || a.email)}</strong>
        <span class="badge-configured">${a.source === 'env' ? 'Active' : a.isDemo || a.source === 'demo' ? 'Demo' : 'Saved'}</span>
        ${a.first_name ? `<span class="badge-demo">${escapeHtml(a.first_name)}</span>` : ''}
        ${a.protected ? '<span class="badge-demo">Protected</span>' : ''}
        <div class="account-row-meta">${escapeHtml(a.email)} · ${escapeHtml(a.host || a.provider || 'smtp')} · ${a.dailyLimit || 490}/day · From: ${escapeHtml(a.fromName || '—')}</div>
      </div>
      <div class="form-actions" style="margin:0">
        ${a.source === 'env' ? `<button type="button" class="btn btn-sm btn-primary btn-3d" onclick="testEnvAccount('${a.id}')">Test</button>` : ''}
        ${a.source === 'demo' || a.isDemo ? `<button type="button" class="btn btn-sm btn-3d" onclick="fillDemoAccount('${a.id}')">Use in Form</button>` : ''}
        ${!a.readonly && a.source !== 'demo' ? `
          <button type="button" class="btn btn-sm btn-3d" onclick="editSavedAccount('${a.id}')">Edit</button>
          <button type="button" class="btn btn-sm btn-danger btn-3d" onclick="removeSavedAccount('${a.id}')">Remove</button>` : ''}
      </div>
    </div>`).join('');
}

function fillDemoAccount(id) {
  api('/email-config/accounts').then(data => {
    const acc = (data.demoAccounts || []).find(a => a.id === id);
    if (!acc) return;
    document.getElementById('smtpConfigId').value = '';
    document.getElementById('smtpLabel').value = acc.label || '';
    document.getElementById('smtpHost').value = acc.host || '';
    document.getElementById('smtpPort').value = acc.port || 587;
    document.getElementById('smtpEmail').value = acc.email || '';
    document.getElementById('smtpFromName').value = acc.fromName || 'Ahmad';
    document.getElementById('smtpPass').value = '';
    selectEmailProvider(acc.provider || 'gmail');
    toast(`Loaded demo: ${acc.label} (first name: Ahmad)`);
  });
}

function getSmtpFormData() {
  return {
    id: document.getElementById('smtpConfigId')?.value || undefined,
    provider: document.getElementById('smtpProvider')?.value,
    label: document.getElementById('smtpLabel')?.value,
    host: document.getElementById('smtpHost')?.value,
    port: document.getElementById('smtpPort')?.value,
    secure: document.getElementById('smtpSecure')?.value === 'true',
    email: document.getElementById('smtpEmail')?.value,
    pass: document.getElementById('smtpPass')?.value,
    fromName: document.getElementById('smtpFromName')?.value,
    test_to: document.getElementById('smtpTestTo')?.value,
  };
}

function showSmtpStatus(msg, ok) {
  const el = document.getElementById('smtpConfigStatus');
  if (!el) return;
  el.className = `alert ${ok ? 'success' : 'error'}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

document.getElementById('smtpTestConnection')?.addEventListener('click', async () => {
  const d = getSmtpFormData();
  try {
    const res = await api('/email-config/test', { method: 'POST', body: JSON.stringify(d) });
    showSmtpStatus(res.message, true);
    toast(res.message);
  } catch (err) {
    showSmtpStatus(err.message, false);
  }
});

document.getElementById('smtpTestSend')?.addEventListener('click', async () => {
  const d = getSmtpFormData();
  if (!d.test_to && !d.email) {
    toast('Enter a test recipient email', 'error');
    return;
  }
  try {
    const res = await api('/email-config/test-send', { method: 'POST', body: JSON.stringify({ ...d, test_to: d.test_to || d.email }) });
    showSmtpStatus(res.message, true);
    toast(res.message);
  } catch (err) {
    showSmtpStatus(err.message, false);
  }
});

document.getElementById('smtpSaveAccount')?.addEventListener('click', async () => {
  const d = getSmtpFormData();
  if (!d.email || !d.host) {
    toast('Email and host are required', 'error');
    return;
  }
  try {
    await api('/email-config/accounts', { method: 'POST', body: JSON.stringify(d) });
    toast('Account saved');
    loadEmailConfig();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function testEnvAccount(accountId) {
  try {
    const verify = await api('/email-config/test', { method: 'POST', body: JSON.stringify({ account: accountId }) });
    toast(verify.message);
    const testTo = document.getElementById('smtpTestTo')?.value.trim() || 'ahmadjutt463@gmail.com';
    const sent = await api('/email-config/test-send', {
      method: 'POST',
      body: JSON.stringify({ account: accountId, test_to: testTo }),
    });
    showSmtpStatus(sent.message, true);
    toast(sent.message);
  } catch (err) {
    showSmtpStatus(err.message, false);
    toast(err.message, 'error');
  }
}

async function removeSavedAccount(id) {
  if (!confirm('Remove this saved account?')) return;
  await api(`/email-config/accounts/${id}`, { method: 'DELETE' });
  loadEmailConfig();
}

function editSavedAccount(id) {
  api('/email-config/accounts').then(data => {
    const acc = (data.savedAccounts || []).find(a => a.id === id);
    if (!acc) return;
    document.getElementById('smtpConfigId').value = acc.id;
    document.getElementById('smtpLabel').value = acc.label || '';
    document.getElementById('smtpHost').value = acc.host || '';
    document.getElementById('smtpPort').value = acc.port || 587;
    document.getElementById('smtpSecure').value = acc.secure ? 'true' : 'false';
    document.getElementById('smtpEmail').value = acc.email || '';
    document.getElementById('smtpFromName').value = acc.fromName || '';
    selectEmailProvider(acc.provider || 'custom');
  });
}

// --- Lead Research ---

async function loadLeadResearch() {
  try {
    const data = await api('/lead-providers');
    const tabs = document.getElementById('leadProviderTabs');
    if (tabs) {
      tabs.innerHTML = (data.providers || []).map(p => `
        <button type="button" class="lead-tab ${p.id === selectedLeadProvider ? 'active' : ''}" data-provider="${p.id}" onclick="selectLeadProvider('${p.id}')">
          ${escapeHtml(p.name)}
        </button>`).join('');
    }
    updateLeadProviderUI(data);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function selectLeadProvider(id) {
  selectedLeadProvider = id;
  document.querySelectorAll('.lead-tab').forEach(t => t.classList.toggle('active', t.dataset.provider === id));
  api('/lead-providers').then(updateLeadProviderUI).catch(() => {});
}

function updateLeadProviderUI(data) {
  const p = (data.providers || []).find(x => x.id === selectedLeadProvider);
  const desc = document.getElementById('leadProviderDesc');
  if (desc && p) desc.textContent = p.description || '';
  const keyInfo = data.keys?.[selectedLeadProvider];
  const keyEl = document.getElementById('leadApiKey');
  if (keyEl && keyInfo?.configured) keyEl.placeholder = `Configured (${keyInfo.masked}) — paste to replace`;
}

document.getElementById('saveLeadApiKey')?.addEventListener('click', async () => {
  const apiKey = document.getElementById('leadApiKey')?.value.trim();
  try {
    await api(`/lead-providers/${selectedLeadProvider}/key`, { method: 'POST', body: JSON.stringify({ apiKey }) });
    toast('API key saved');
    document.getElementById('leadApiKey').value = '';
    loadLeadResearch();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('leadSearchBtn')?.addEventListener('click', () => runLeadSearch(false));
document.getElementById('leadLoadDemoBtn')?.addEventListener('click', () => runLeadSearch(true));

async function runLeadSearch(forceDemo) {
  const btn = document.getElementById(forceDemo ? 'leadLoadDemoBtn' : 'leadSearchBtn');
  const status = document.getElementById('leadSearchStatus');
  if (btn) { btn.disabled = true; btn.textContent = forceDemo ? 'Loading...' : 'Searching...'; }
  try {
    const query = {
      job_titles: document.getElementById('leadJobTitle')?.value.trim(),
      locations: document.getElementById('leadLocation')?.value.trim(),
      domain: document.getElementById('leadDomain')?.value.trim() || 'reachlydemo.com',
      industry: document.getElementById('leadIndustry')?.value.trim(),
      company: document.getElementById('leadDomain')?.value.trim(),
      seniority: document.getElementById('leadSeniority')?.value,
      company_size: document.getElementById('leadCompanySize')?.value,
      min_score: document.getElementById('leadMinScore')?.value || 80,
      verified_only: document.getElementById('leadVerifiedOnly')?.checked,
    };
    const result = await api('/lead-research/search', {
      method: 'POST',
      body: JSON.stringify({ provider: selectedLeadProvider, query }),
    });
    leadSearchResults = result.leads || [];
    renderLeadResults({ ...result, demo: forceDemo || result.demo });
    if (status) {
      status.textContent = result.live && !forceDemo
        ? `Live results from ${selectedLeadProvider} — ${leadSearchResults.length} leads`
        : `Demo mode: ${leadSearchResults.length} Ahmad-named leads ready for import (score filter applied).`;
    }
    document.getElementById('leadImportBtn')?.classList.remove('hidden');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = forceDemo ? 'Load Demo Data' : 'Search Leads';
    }
  }
}

function renderLeadResults(result) {
  const card = document.getElementById('leadResultsCard');
  const tbody = document.getElementById('leadResultsTable');
  const meta = document.getElementById('leadResultsMeta');
  if (!card || !tbody) return;
  card.classList.remove('hidden');
  if (meta) {
    meta.innerHTML = result.demo || !result.live
      ? '<span class="badge-demo">Demo · first name Ahmad</span>'
      : '<span class="badge-configured">Live data</span>';
  }
  tbody.innerHTML = (result.leads || []).map((l, i) => `
    <tr>
      <td><input type="checkbox" class="lead-check" data-idx="${i}" checked></td>
      <td><strong>${escapeHtml(l.name || `${l.first_name} ${l.last_name}`)}</strong></td>
      <td>${escapeHtml(l.email || '—')}</td>
      <td>${escapeHtml(l.title || '—')}</td>
      <td>${escapeHtml(l.company || '—')}</td>
      <td>${escapeHtml(l.city || '—')}</td>
      <td><span class="score-pill">${l.score ?? '—'}</span></td>
      <td class="${l.verified ? 'verified-yes' : 'verified-no'}">${l.verified ? 'Yes' : 'No'}</td>
    </tr>`).join('');
}

document.getElementById('leadSelectAll')?.addEventListener('change', (e) => {
  document.querySelectorAll('.lead-check').forEach(c => { c.checked = e.target.checked; });
});

document.getElementById('leadImportBtn')?.addEventListener('click', async () => {
  const selected = [];
  document.querySelectorAll('.lead-check:checked').forEach(c => {
    const idx = parseInt(c.dataset.idx, 10);
    if (leadSearchResults[idx]) selected.push(leadSearchResults[idx]);
  });
  if (!selected.length) {
    toast('Select at least one lead', 'error');
    return;
  }
  const list_id = document.getElementById('leadImportList')?.value || 'list1';
  try {
    const res = await api('/lead-research/import', {
      method: 'POST',
      body: JSON.stringify({ leads: selected, list_id }),
    });
    toast(`Imported ${res.added} leads (${res.skipped} skipped)`);
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* Custom cursor removed for performance */
