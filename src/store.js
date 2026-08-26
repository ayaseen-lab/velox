const fs = require('fs');
const path = require('path');
const { dataDir, isServerless } = require('./paths');

const dbPath = path.join(dataDir, 'store.json');
let memory = null;
let saveTimer = null;

const empty = () => ({
  contacts: [],
  campaigns: [],
  send_queue: [],
  send_log: [],
  meta: { userStoppedSender: false, lastDailyLimitAt: null },
  _counters: { contacts: 0, campaigns: 0, send_queue: 0, send_log: 0, replies: 0 },
  replies: [],
});

function load() {
  if (!fs.existsSync(dbPath)) return empty();
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    return migrateData(data);
  } catch {
    return empty();
  }
}

function migrateData(data) {
  for (const c of data.contacts) {
    if (!c.list_id) c.list_id = 'list1';
  }
  for (const camp of data.campaigns) {
    if (!camp.smtp_account_id) camp.smtp_account_id = 'account1';
    if (!camp.list_id) camp.list_id = 'list1';
  }
  for (const log of data.send_log) {
    if (!log.smtp_account_id) log.smtp_account_id = 'account1';
    if (!log.list_id) log.list_id = 'list1';
    if (!log.failure_type && log.status === 'failed') log.failure_type = 'other';
  }
  return data;
}

function persist(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data));
}

function getMemory() {
  if (!memory) memory = load();
  return memory;
}

function scheduleSave() {
  if (isServerless) {
    persist(getMemory());
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persist(getMemory());
    } catch (err) {
      console.error('Failed to save store:', err.message);
    }
  }, 80);
}

function flushStore() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (memory) persist(memory);
}

if (!isServerless) {
  process.on('exit', () => {
    try { flushStore(); } catch (_) { /* ignore */ }
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { flushStore(); } catch (_) { /* ignore */ }
      process.exit(0);
    });
  }
}

function now() {
  return new Date().toISOString();
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function toLocalDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA');
}

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

function withStore(fn) {
  const data = getMemory();
  const result = fn(data);
  scheduleSave();
  return result;
}

function withStoreRead(fn) {
  return fn(getMemory());
}

// --- Contacts ---

function getContacts({ search = '', page = 1, limit = 50, list_id } = {}) {
  return withStoreRead((data) => {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(20000, Math.max(1, parseInt(limit, 10) || 50));
    let list = data.contacts;
    if (list_id) list = list.filter(c => c.list_id === list_id);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.email.toLowerCase().includes(q)
        || (c.name || '').toLowerCase().includes(q)
        || (c.company || '').toLowerCase().includes(q)
        || (c.title || '').toLowerCase().includes(q)
      );
    }
    const total = list.length;
    const offset = (pageNum - 1) * limitNum;
    const contacts = list
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(offset, offset + limitNum);
    return { contacts, total, page: pageNum, limit: limitNum, list_id: list_id || null };
  });
}

function addContact(email, fields = {}, listId = 'list1') {
  return withStore((data) => {
    const exists = data.contacts.find(c =>
      c.email.toLowerCase() === email.toLowerCase() && c.list_id === listId
    );
    if (exists) throw new Error('UNIQUE constraint failed');
    const contact = {
      id: nextId(data, 'contacts'),
      email: email.trim(),
      name: fields.name || '',
      first_name: fields.first_name || '',
      last_name: fields.last_name || '',
      company: fields.company || '',
      title: fields.title || '',
      website: fields.website || '',
      linkedin: fields.linkedin || '',
      city: fields.city || '',
      country: fields.country || '',
      industry: fields.industry || '',
      phone: fields.phone || '',
      company_profile: fields.company_profile || '',
      dot: fields.dot || '',
      list_id: listId,
      status: 'active',
      created_at: now(),
    };
    data.contacts.push(contact);
    return contact;
  });
}

function addContactsBulk(rows, listId = 'list1') {
  const result = withStore((data) => {
    const existing = new Set(
      data.contacts
        .filter(c => c.list_id === listId)
        .map(c => c.email.toLowerCase())
    );
    let added = 0;
    let skipped = 0;
    const seen = new Set(existing);

    for (const row of rows) {
      const email = (row.email || '').trim();
      if (!email || !email.includes('@')) { skipped++; continue; }
      const key = email.toLowerCase();
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      data.contacts.push({
        id: nextId(data, 'contacts'),
        email,
        name: row.name || [row.first_name, row.last_name].filter(Boolean).join(' '),
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        company: row.company || '',
        title: row.title || '',
        website: row.website || '',
        linkedin: row.linkedin || '',
        city: row.city || '',
        country: row.country || '',
        industry: row.industry || '',
        phone: row.phone || '',
        company_profile: row.company_profile || '',
        dot: row.dot || '',
        list_id: listId,
        status: 'active',
        created_at: now(),
      });
      added++;
    }
    return { added, skipped, listId };
  });
  flushStore();
  return result;
}

function deleteContact(id) {
  withStore((data) => { data.contacts = data.contacts.filter(c => c.id !== id); });
}

function deleteAllContacts(listId = null) {
  withStore((data) => {
    if (listId) {
      data.contacts = data.contacts.filter(c => c.list_id !== listId);
    } else {
      data.contacts = [];
    }
  });
}

function suppressContact(contactId, status, reason) {
  withStore((data) => {
    const c = data.contacts.find(x => x.id === contactId);
    if (c) {
      c.status = status;
      c.failure_reason = reason;
      c.suppressed_at = now();
    }
  });
}

function buildGloballySentEmailSet(data) {
  const sent = new Set();
  for (const log of data.send_log) {
    if (log.status === 'sent' && log.email) sent.add(log.email.toLowerCase());
  }
  for (const q of data.send_queue) {
    if (q.status !== 'sent') continue;
    const contact = data.contacts.find(c => c.id === q.contact_id);
    if (contact?.email) sent.add(contact.email.toLowerCase());
  }
  return sent;
}

function wasEmailSentGlobally(email) {
  if (!email) return false;
  const key = email.toLowerCase();
  return withStoreRead((data) => buildGloballySentEmailSet(data).has(key));
}

function getSentEmailsForList(listId) {
  return withStoreRead((data) => {
    const sent = buildGloballySentEmailSet(data);
    return sent;
  });
}

function getActiveContactIds(listId = null) {
  return withStoreRead((data) => {
    let contacts = data.contacts.filter(c => c.status === 'active');
    if (listId) contacts = contacts.filter(c => c.list_id === listId);
    return contacts.map(c => c.id);
  });
}

function getContactById(id) {
  return withStoreRead((data) => data.contacts.find((c) => c.id === id) || null);
}

function getEligibleContactIds(listId, { skipAlreadySent = true, emailAllowlist = null } = {}) {
  return withStoreRead((data) => {
    const sentEmails = skipAlreadySent ? buildGloballySentEmailSet(data) : new Set();
    const allow = Array.isArray(emailAllowlist) && emailAllowlist.length
      ? new Set(emailAllowlist.map((e) => String(e).toLowerCase()))
      : null;
    return data.contacts
      .filter(c => c.list_id === listId && c.status === 'active')
      .filter(c => !skipAlreadySent || !sentEmails.has(c.email.toLowerCase()))
      .filter(c => !allow || allow.has(c.email.toLowerCase()))
      .map(c => c.id);
  });
}

function getSuccessfulContactIds(campaignId) {
  return withStoreRead((data) => {
    const ids = new Set();
    for (const log of data.send_log) {
      if (log.campaign_id === campaignId && log.status === 'sent' && log.contact_id) {
        ids.add(log.contact_id);
      }
    }
    for (const q of data.send_queue) {
      if (q.campaign_id === campaignId && q.status === 'sent' && q.contact_id) {
        ids.add(q.contact_id);
      }
    }
    return [...ids].filter(id => {
      const c = data.contacts.find(x => x.id === id);
      return c && c.status === 'active';
    });
  });
}

function getCampaignSentCount(campaignId) {
  return withStoreRead((data) => {
    const camp = data.campaigns.find(c => c.id === campaignId);
    if (!camp) return 0;
    return camp.sent_count || 0;
  });
}

function getContactCounts(listId = null) {
  return withStoreRead((data) => {
    let contacts = data.contacts;
    if (listId) contacts = contacts.filter(c => c.list_id === listId);
    return {
      total: contacts.length,
      active: contacts.filter(c => c.status === 'active').length,
      bounced: contacts.filter(c => c.status === 'bounced').length,
      blocked: contacts.filter(c => c.status === 'blocked').length,
      sent: contacts.filter(c => c.status === 'sent').length,
      list_id: listId,
    };
  });
}

function getAllListCounts() {
  return withStoreRead((data) => {
    const lists = {};
    for (const c of data.contacts) {
      const lid = c.list_id || 'list1';
      if (!lists[lid]) lists[lid] = { total: 0, active: 0, bounced: 0, blocked: 0 };
      lists[lid].total++;
      if (c.status === 'active') lists[lid].active++;
      else if (c.status === 'bounced') lists[lid].bounced++;
      else if (c.status === 'blocked') lists[lid].blocked++;
    }
    return lists;
  });
}

// --- Campaigns ---

function getCampaigns() {
  return withStoreRead((data) => [...data.campaigns].sort((a, b) => b.id - a.id));
}

function getCampaign(id) {
  return withStoreRead((data) => {
    const campaign = data.campaigns.find(c => c.id === id);
    if (!campaign) return null;
    const queueStats = {};
    for (const q of data.send_queue.filter(q => q.campaign_id === id)) {
      queueStats[q.status] = (queueStats[q.status] || 0) + 1;
    }
    return { ...campaign, queueStats: Object.entries(queueStats).map(([status, count]) => ({ status, count })) };
  });
}

function createCampaign({ name, subject, body_html, body_text = '', attachment = null, preheader = '', include_unsubscribe = false, smtp_account_id = 'account1', list_id = 'list1', parent_campaign_id = null, campaign_type = 'initial', delay_days = 0 }) {
  return withStore((data) => {
    const campaign = {
      id: nextId(data, 'campaigns'), name, subject, body_html, body_text,
      preheader, include_unsubscribe,
      smtp_account_id, list_id,
      attachment,
      parent_campaign_id,
      campaign_type: campaign_type || 'initial',
      delay_days: delay_days || 0,
      status: 'draft', total_recipients: 0, sent_count: 0, failed_count: 0,
      created_at: now(), started_at: null, completed_at: null,
    };
    data.campaigns.push(campaign);
    return campaign;
  });
}

function updateCampaign(id, fields) {
  withStore((data) => {
    const c = data.campaigns.find(c => c.id === id);
    if (!c) return;
    Object.assign(c, fields);
  });
}

function setCampaignStatus(id, status) {
  withStore((data) => {
    const c = data.campaigns.find(c => c.id === id);
    if (c) c.status = status;
  });
}

function getCampaignsByStatus(statuses) {
  return withStoreRead((data) => data.campaigns.filter(c => statuses.includes(c.status)));
}

// --- Queue ---

function queueCampaign(campaignId, contactIds, { allowResend = false } = {}) {
  return withStore((data) => {
    const camp = data.campaigns.find(c => c.id === campaignId);
    const listId = camp?.list_id || 'list1';
    const isFollowUp = allowResend || camp?.campaign_type === 'follow_up';
    const sentEmails = isFollowUp ? null : buildGloballySentEmailSet(data);
    const queuedContactIds = new Set(
      data.send_queue.filter(q => q.campaign_id === campaignId).map(q => q.contact_id)
    );
    let added = 0;

    for (const contactId of contactIds) {
      const contact = data.contacts.find(c => c.id === contactId);
      if (!contact || contact.status !== 'active') continue;

      if (queuedContactIds.has(contactId)) continue;

      if (!isFollowUp) {
        if (sentEmails.has(contact.email.toLowerCase())) continue;
      } else {
        const alreadySentFollowUp = data.send_log.some(l =>
          l.status === 'sent' && l.campaign_id === campaignId && l.contact_id === contactId
        );
        if (alreadySentFollowUp) continue;
      }

      data.send_queue.push({
        id: nextId(data, 'send_queue'),
        campaign_id: campaignId,
        contact_id: contactId,
        smtp_account_id: camp?.smtp_account_id || 'account1',
        list_id: listId,
        status: 'pending',
        error_message: null,
        sent_at: null,
        is_follow_up: !!isFollowUp,
      });
      queuedContactIds.add(contactId);
      added++;
    }

    if (camp) {
      camp.total_recipients = data.send_queue.filter(q => q.campaign_id === campaignId).length;
      camp.status = 'queued';
    }
    return data.send_queue.filter(q => q.campaign_id === campaignId && q.status === 'pending').length;
  });
}

function getPendingQueue(limit, accountId = null) {
  return withStoreRead((data) => {
    const now = Date.now();
    const items = data.send_queue
      .filter(q => q.status === 'pending')
      .filter(q => !q.deferred_until || new Date(q.deferred_until).getTime() <= now)
      .sort((a, b) => {
        const ra = a.retry_count || 0;
        const rb = b.retry_count || 0;
        if (ra !== rb) return ra - rb; // fresh items first
        return b.id - a.id; // newer campaigns next
      });

    const result = [];
    for (const q of items) {
      if (result.length >= limit) break;
      const camp = data.campaigns.find(c => c.id === q.campaign_id);
      if (!camp || !['sending', 'queued'].includes(camp.status)) continue;
      const contact = data.contacts.find(c => c.id === q.contact_id);
      if (!contact || contact.status !== 'active') continue;

      const smtpAccountId = q.smtp_account_id || camp.smtp_account_id || 'account1';
      if (accountId && smtpAccountId !== accountId) continue;

      result.push({
        queue_id: q.id, campaign_id: q.campaign_id, contact_id: q.contact_id,
        smtp_account_id: smtpAccountId,
        list_id: q.list_id || camp.list_id || contact.list_id || 'list1',
        email: contact.email,
        name: contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        company: contact.company || '',
        title: contact.title || '',
        website: contact.website || '',
        linkedin: contact.linkedin || '',
        city: contact.city || '',
        country: contact.country || '',
        industry: contact.industry || '',
        company_profile: contact.company_profile || '',
        dot: contact.dot || '',
        subject: camp.subject, body_html: camp.body_html, body_text: camp.body_text,
        preheader: camp.preheader || '', include_unsubscribe: camp.include_unsubscribe === true,
        attachment: camp.attachment || null,
        campaign_name: camp.name,
      });
    }
    return result;
  });
}

function restoreTransientBlockedContacts(listIds = null) {
  return withStore((data) => {
    const lists = listIds ? new Set(listIds) : null;
    let restored = 0;
    for (const contact of data.contacts) {
      if (contact.status !== 'blocked' && contact.status !== 'bounced') continue;
      if (lists && !lists.has(contact.list_id)) continue;
      const reason = (contact.failure_reason || '').toLowerCase();
      const transient =
        reason.includes('timed out') ||
        reason.includes('timeout') ||
        reason.includes('enetunreach') ||
        reason.includes('econn') ||
        reason.includes('connect ') ||
        reason.includes('lookup failure') ||
        reason.includes('451 4.3.0') ||
        reason.includes('network') ||
        reason.includes('temporary');
      if (!transient) continue;
      contact.status = 'active';
      contact.failure_reason = null;
      contact.suppressed_at = null;
      restored++;
    }
    return restored;
  });
}

function requeueFailedActiveForAccount(accountId, { includeLookupFailures = true } = {}) {
  return withStore((data) => {
    const sentEmails = buildGloballySentEmailSet(data);
    let added = 0;
    const campaignIds = new Set();

    for (const q of data.send_queue) {
      const camp = data.campaigns.find(c => c.id === q.campaign_id);
      const smtpId = q.smtp_account_id || camp?.smtp_account_id;
      if (smtpId !== accountId) continue;
      if (q.status !== 'failed' && q.status !== 'skipped') continue;
      if (!includeLookupFailures && /lookup failure|451 4\.3\.0/i.test(q.error_message || '')) continue;

      const contact = data.contacts.find(c => c.id === q.contact_id);
      if (!contact || contact.status !== 'active') continue;
      if (sentEmails.has((contact.email || '').toLowerCase())) continue;

      q.status = 'pending';
      q.error_message = null;
      q.retry_count = 0;
      q.deferred_until = null;
      q.sent_at = null;
      added++;
      if (camp) campaignIds.add(camp.id);
    }

    for (const id of campaignIds) {
      const camp = data.campaigns.find(c => c.id === id);
      if (camp) {
        camp.status = 'sending';
        camp.completed_at = null;
      }
    }

    return added;
  });
}

function getPendingCount(accountId = null) {
  return withStoreRead((data) => data.send_queue.filter(q => {
    if (q.status !== 'pending') return false;
    if (!accountId) return true;
    const camp = data.campaigns.find(c => c.id === q.campaign_id);
    const smtpId = q.smtp_account_id || camp?.smtp_account_id || 'account1';
    return smtpId === accountId;
  }).length);
}

function getQueueRetries(queueId) {
  return withStoreRead((data) => {
    const q = data.send_queue.find(q => q.id === queueId);
    return q?.retry_count || 0;
  });
}

function requeueItem(queueId, errorMessage) {
  withStore((data) => {
    const q = data.send_queue.find(q => q.id === queueId);
    if (q) {
      q.status = 'pending';
      q.error_message = errorMessage;
      q.retry_count = (q.retry_count || 0) + 1;
    }
  });
}

function bumpQueueItemToEnd(queueId) {
  withStore((data) => {
    const q = data.send_queue.find(item => item.id === queueId);
    if (!q) return;
    q.id = nextId(data, 'send_queue');
  });
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function deferQueueItem(queueId, errorMessage) {
  withStore((data) => {
    const q = data.send_queue.find(q => q.id === queueId);
    if (q) {
      q.status = 'pending';
      q.error_message = errorMessage;
      q.deferred_until = endOfToday();
    }
  });
}

function deferBlockedQueueItems(accountId = null) {
  return withStore((data) => {
    let count = 0;
    for (const q of data.send_queue) {
      if (q.status !== 'pending') continue;
      const camp = data.campaigns.find(c => c.id === q.campaign_id);
      const smtpId = q.smtp_account_id || camp?.smtp_account_id || 'account1';
      if (accountId && smtpId !== accountId) continue;
      const msg = (q.error_message || '').toLowerCase();
      const stuck = msg.includes('daily') && msg.includes('limit') && (q.retry_count || 0) >= 3;
      if (stuck) {
        q.deferred_until = endOfToday();
        count++;
      }
    }
    return count;
  });
}

function getAccountQuotaState(accountId) {
  const meta = getMeta();
  return meta.accountQuotas?.[accountId] || {};
}

function setAccountQuotaState(accountId, fields) {
  const meta = getMeta();
  const accountQuotas = { ...(meta.accountQuotas || {}) };
  accountQuotas[accountId] = { ...(accountQuotas[accountId] || {}), ...fields };
  setMeta({ accountQuotas });
}

function pauseAllCampaigns() {
  withStore((data) => {
    for (const c of data.campaigns) {
      if (['sending', 'queued'].includes(c.status)) c.status = 'paused';
    }
  });
}

function pauseCampaignsForAccount(accountId) {
  withStore((data) => {
    for (const c of data.campaigns) {
      if (['sending', 'queued'].includes(c.status) && (c.smtp_account_id || 'account1') === accountId) {
        c.status = 'paused';
      }
    }
  });
}

function markQueueSkippedDuplicate(queueId, campaignId, contactId, email, meta = {}, reason) {
  withStore((data) => {
    const q = data.send_queue.find(item => item.id === queueId);
    if (q) {
      q.status = 'skipped';
      q.error_message = reason || 'Skipped — already sent to this email';
      q.sent_at = now();
    }
    data.send_log.push({
      id: nextId(data, 'send_log'),
      campaign_id: campaignId,
      contact_id: contactId,
      email,
      status: 'skipped',
      failure_type: 'duplicate',
      error_message: 'Skipped — already sent to this email',
      sent_at: now(),
      smtp_account_id: meta.smtp_account_id || q?.smtp_account_id || 'account1',
      list_id: meta.list_id || q?.list_id || data.contacts.find(c => c.id === contactId)?.list_id || 'list1',
    });
  });
}

function purgeDuplicatePendingQueue() {
  return withStore((data) => {
    const sent = buildGloballySentEmailSet(data);
    let skipped = 0;
    for (const q of data.send_queue) {
      if (q.status !== 'pending') continue;
      const contact = data.contacts.find(c => c.id === q.contact_id);
      const email = contact?.email?.toLowerCase();
      if (!email || !sent.has(email)) continue;
      q.status = 'skipped';
      q.error_message = 'Skipped — already sent to this email';
      q.sent_at = now();
      skipped++;
    }
    return skipped;
  });
}

function markSent(queueId, campaignId, contactId, email, meta = {}) {
  withStore((data) => {
    const q = data.send_queue.find(q => q.id === queueId);
    if (q) { q.status = 'sent'; q.sent_at = now(); }
    const contact = data.contacts.find(c => c.id === contactId);
    data.send_log.push({
      id: nextId(data, 'send_log'), campaign_id: campaignId, contact_id: contactId,
      email, status: 'sent', error_message: null, sent_at: now(),
      smtp_account_id: meta.smtp_account_id || q?.smtp_account_id || 'account1',
      list_id: meta.list_id || q?.list_id || contact?.list_id || 'list1',
    });
    const camp = data.campaigns.find(c => c.id === campaignId);
    if (camp) camp.sent_count++;
  });
}

function markFailed(queueId, campaignId, contactId, email, errorMessage, failureType = 'other', meta = {}) {
  withStore((data) => {
    const q = data.send_queue.find(q => q.id === queueId);
    if (q) { q.status = 'failed'; q.error_message = errorMessage; q.sent_at = now(); }
    const contact = data.contacts.find(c => c.id === contactId);
    const listId = meta.list_id || q?.list_id || contact?.list_id || 'list1';
    data.send_log.push({
      id: nextId(data, 'send_log'), campaign_id: campaignId, contact_id: contactId,
      email, status: 'failed', error_message: errorMessage, failure_type: failureType, sent_at: now(),
      smtp_account_id: meta.smtp_account_id || q?.smtp_account_id || 'account1',
      list_id: listId,
    });
    const camp = data.campaigns.find(c => c.id === campaignId);
    if (camp) camp.failed_count++;

    if (contact && ['invalid_recipient', 'blocked', 'permanent'].includes(failureType)) {
      contact.status = failureType === 'invalid_recipient' ? 'bounced' : 'blocked';
      contact.failure_reason = errorMessage;
      contact.suppressed_at = now();
    }
  });
}

function updateCampaignStatuses() {
  withStore((data) => {
    for (const camp of data.campaigns.filter(c => ['sending', 'queued'].includes(c.status))) {
      const pending = data.send_queue.filter(q => q.campaign_id === camp.id && q.status === 'pending').length;
      if (pending === 0) {
        camp.status = 'completed';
        camp.completed_at = now();
      } else if (camp.status === 'queued') {
        camp.status = 'sending';
        camp.started_at = now();
      }
    }
  });
}

// --- Logs & Stats ---

function getTodaySentCount(accountId = null) {
  return withStoreRead((data) => {
    const today = todayLocal();
    return data.send_log.filter(l => {
      if (l.status !== 'sent' || toLocalDate(l.sent_at) !== today) return false;
      if (accountId) return l.smtp_account_id === accountId;
      return true;
    }).length;
  });
}

function getRemainingToday(limit, accountId = null) {
  return Math.max(0, limit - getTodaySentCount(accountId));
}

function getRecentLogs(limit = 20) {
  return withStoreRead((data) => {
    const logs = data.send_log;
    const out = [];
    for (let i = logs.length - 1; i >= 0 && out.length < limit; i--) {
      const log = logs[i];
      const contact = data.contacts.find(c => c.id === log.contact_id);
      out.push({ ...log, contact_name: contact?.name || null });
    }
    return out;
  });
}

function getLast7Days() {
  return withStoreRead((data) => {
    const days = {};
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const log of data.send_log) {
      if (log.status !== 'sent' || new Date(log.sent_at) < cutoff) continue;
      const day = toLocalDate(log.sent_at);
      days[day] = (days[day] || 0) + 1;
    }
    return Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([day, sent]) => ({ day, sent }));
  });
}

function getCampaignStatusCounts() {
  return withStoreRead((data) => {
    const counts = {};
    for (const c of data.campaigns) counts[c.status] = (counts[c.status] || 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  });
}

function getMeta() {
  return withStoreRead((data) => data.meta || {});
}

function setMeta(fields) {
  withStore((data) => {
    data.meta = { ...(data.meta || {}), ...fields };
  });
}

function getCustomVariables() {
  return withStoreRead((data) => data.meta?.custom_variables || []);
}

function setCustomVariables(vars) {
  withStore((data) => {
    data.meta = { ...(data.meta || {}), custom_variables: vars };
  });
}

function addCustomVariable({ name, value, content }) {
  const { normalizeToken } = require('./variables');
  return withStore((data) => {
    const vars = data.meta?.custom_variables || [];
    const token = normalizeToken(name);
    if (!token) throw new Error('Variable name is required');
    if (vars.some(v => v.token === token)) throw new Error('Variable already exists');
    const item = {
      id: vars.length ? Math.max(...vars.map(v => v.id || 0)) + 1 : 1,
      name: name.trim(),
      token,
      value: value || content || '',
      source: 'static',
      created_at: now(),
    };
    if (!data.meta) data.meta = {};
    data.meta.custom_variables = [...vars, item];
    return item;
  });
}

function deleteCustomVariable(id) {
  withStore((data) => {
    const vars = data.meta?.custom_variables || [];
    data.meta = {
      ...(data.meta || {}),
      custom_variables: vars.filter(v => v.id !== id),
    };
  });
}

function getLeadProviderKeys() {
  return withStoreRead((data) => {
    const keys = data.meta?.lead_provider_keys || {};
    return Object.fromEntries(
      Object.entries(keys).map(([k, v]) => [k, { configured: !!v, masked: v ? `${v.slice(0, 4)}••••` : '' }])
    );
  });
}

function getLeadProviderKey(providerId) {
  return withStoreRead((data) => data.meta?.lead_provider_keys?.[providerId] || '');
}

function setLeadProviderKey(providerId, apiKey) {
  withStore((data) => {
    const keys = { ...(data.meta?.lead_provider_keys || {}) };
    if (apiKey) keys[providerId] = apiKey.trim();
    else delete keys[providerId];
    data.meta = { ...(data.meta || {}), lead_provider_keys: keys };
  });
}

function getAccountDailyLimits() {
  return withStoreRead((data) => ({ ...(data.meta?.account_daily_limits || {}) }));
}

function getAccountDailyLimit(accountId) {
  if (!accountId) return null;
  const limits = getAccountDailyLimits();
  const value = limits[accountId];
  return Number.isFinite(value) ? value : null;
}

function setAccountDailyLimit(accountId, dailyLimit) {
  if (!accountId) throw new Error('Account id is required');
  const limit = parseInt(dailyLimit, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
    throw new Error('Daily limit must be a number between 1 and 10000');
  }
  return withStore((data) => {
    const limits = { ...(data.meta?.account_daily_limits || {}) };
    limits[accountId] = limit;
    data.meta = { ...(data.meta || {}), account_daily_limits: limits };
    return limit;
  });
}

function getSavedSmtpAccounts() {
  return withStoreRead((data) => (data.meta?.saved_smtp_accounts || []).map(a => ({
    ...a,
    pass: a.pass ? '••••••••' : '',
  })));
}

function saveSmtpAccount(account) {
  return withStore((data) => {
    const list = data.meta?.saved_smtp_accounts || [];
    const id = account.id || `saved_${Date.now()}`;
    const existing = list.findIndex(a => a.id === id);
    const entry = {
      id,
      provider: account.provider || 'custom',
      label: account.label || account.email,
      host: account.host,
      port: parseInt(account.port, 10) || 587,
      secure: !!account.secure,
      email: account.email?.trim(),
      fromName: account.fromName || account.email?.split('@')[0] || '',
      pass: account.pass && account.pass !== '••••••••' ? account.pass.replace(/\s/g, '') : undefined,
      listId: account.listId || 'list1',
      dailyLimit: parseInt(account.dailyLimit, 10) || 490,
      sendDelayMs: parseInt(account.sendDelayMs, 10) || 5000,
      verified: !!account.verified,
      updated_at: now(),
    };
    if (existing >= 0) {
      if (!entry.pass) entry.pass = list[existing].pass;
      list[existing] = { ...list[existing], ...entry };
    } else {
      if (!entry.pass) throw new Error('Password is required');
      list.push(entry);
    }
    data.meta = { ...(data.meta || {}), saved_smtp_accounts: list };
    return { ...entry, pass: '••••••••' };
  });
}

function getSavedSmtpAccountRaw(id) {
  return withStoreRead((data) => (data.meta?.saved_smtp_accounts || []).find(a => a.id === id) || null);
}

function deleteSavedSmtpAccount(id) {
  withStore((data) => {
    data.meta = {
      ...(data.meta || {}),
      saved_smtp_accounts: (data.meta?.saved_smtp_accounts || []).filter(a => a.id !== id),
    };
  });
}

function getQueueProgress() {
  return withStoreRead((data) => {
    let pending = 0;
    let sent = 0;
    let failed = 0;
    let nextItem = null;
    const pendingByCampaign = {};
    const nowMs = Date.now();
    for (const q of data.send_queue) {
      if (q.status === 'pending') {
        pending++;
        pendingByCampaign[q.campaign_id] = (pendingByCampaign[q.campaign_id] || 0) + 1;
        const ready = !q.deferred_until || new Date(q.deferred_until).getTime() <= nowMs;
        if (ready && (!nextItem || q.id < nextItem.id)) nextItem = q;
      } else if (q.status === 'sent') sent++;
      else if (q.status === 'failed') failed++;
    }
    const total = data.send_queue.length;
    const completed = sent + failed;

    let nextEmail = null;
    if (nextItem) {
      const contact = data.contacts.find(c => c.id === nextItem.contact_id);
      nextEmail = contact?.email || null;
    }

    let lastSentLog = null;
    for (let i = data.send_log.length - 1; i >= 0; i--) {
      if (data.send_log[i].status === 'sent') {
        lastSentLog = data.send_log[i];
        break;
      }
    }

    const allCampaigns = data.campaigns
      .slice()
      .sort((a, b) => b.id - a.id)
      .map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        smtp_account_id: c.smtp_account_id || 'account1',
        list_id: c.list_id || 'list1',
        sent: c.sent_count || 0,
        failed: c.failed_count || 0,
        total: c.total_recipients || 0,
        pending: pendingByCampaign[c.id] || 0,
        percentComplete: c.total_recipients > 0
          ? Math.round(((c.sent_count || 0) / c.total_recipients) * 100)
          : 0,
      }));

    const activeCampaigns = allCampaigns.filter(c =>
      ['sending', 'queued', 'paused'].includes(c.status) && c.sent < c.total
    );

    return {
      total,
      pending,
      sent,
      failed,
      completed,
      nextPosition: total > 0 ? completed + 1 : 0,
      nextEmail,
      lastSentEmail: lastSentLog?.email || null,
      lastSentAt: lastSentLog?.sent_at || null,
      percentComplete: total > 0 ? Math.round((sent / total) * 100) : 0,
      campaigns: allCampaigns,
      activeCampaigns,
      activeCampaign: activeCampaigns[0] || null,
    };
  });
}

function resumeSendingCampaigns() {
  withStore((data) => {
    for (const camp of data.campaigns) {
      if (camp.status === 'paused') {
        const hasPending = data.send_queue.some(q => q.campaign_id === camp.id && q.status === 'pending');
        if (hasPending) camp.status = 'sending';
      }
    }
  });
}

function categorizeFailure(type) {
  if (['blocked', 'spam'].includes(type) || type === 'blocked') return 'denied';
  if (type === 'invalid_recipient') return 'invalid';
  if (type === 'rate_limit') return 'rate_limited';
  if (type === 'daily_quota') return 'quota';
  if (type === 'temporary') return 'temporary';
  return 'other';
}

function getAnalytics() {
  return withStoreRead((data) => {
    let sent = 0;
    let failed = 0;
    let pending = 0;
    const pendingByCampaign = {};
    for (const q of data.send_queue) {
      if (q.status === 'sent') sent++;
      else if (q.status === 'failed') failed++;
      else if (q.status === 'pending') {
        pending++;
        pendingByCampaign[q.campaign_id] = (pendingByCampaign[q.campaign_id] || 0) + 1;
      }
    }
    const total = data.send_queue.length;
    const processed = sent + failed;
    const successRate = processed > 0 ? Math.round((sent / processed) * 1000) / 10 : 0;

    const today = todayLocal();
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const failureBreakdown = {};
    const failureReasons = {};
    const hourlyToday = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0, failed: 0 }));
    const daily14 = {};
    let todaySent = 0;
    let todayFailed = 0;

    for (const log of data.send_log) {
      const day = toLocalDate(log.sent_at);
      const ts = log.sent_at ? new Date(log.sent_at).getTime() : 0;
      if (log.status === 'failed') {
        const cat = categorizeFailure(log.failure_type || 'other');
        failureBreakdown[cat] = (failureBreakdown[cat] || 0) + 1;
        if (log.error_message) {
          const key = log.error_message.slice(0, 80);
          failureReasons[key] = (failureReasons[key] || 0) + 1;
        }
      }
      if (day === today) {
        const h = new Date(log.sent_at).getHours();
        if (log.status === 'sent') {
          hourlyToday[h].sent++;
          todaySent++;
        } else if (log.status === 'failed') {
          hourlyToday[h].failed++;
          todayFailed++;
        }
      }
      if (ts >= cutoff) {
        if (!daily14[day]) daily14[day] = { day, sent: 0, failed: 0 };
        if (log.status === 'sent') daily14[day].sent++;
        else if (log.status === 'failed') daily14[day].failed++;
      }
    }

    const topFailures = Object.entries(failureReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count }));
    const dailyChart = Object.values(daily14).sort((a, b) => a.day.localeCompare(b.day));

    const campaignStats = data.campaigns.map(c => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      status: c.status,
      smtp_account_id: c.smtp_account_id || 'account1',
      list_id: c.list_id || 'list1',
      sent: c.sent_count,
      failed: c.failed_count,
      total: c.total_recipients,
      pending: pendingByCampaign[c.id] || 0,
      successRate: (c.sent_count + c.failed_count) > 0
        ? Math.round((c.sent_count / (c.sent_count + c.failed_count)) * 1000) / 10
        : 0,
      started_at: c.started_at,
      completed_at: c.completed_at,
    })).sort((a, b) => b.id - a.id);

    const replies = data.replies || [];

    return {
      overview: {
        total, sent, failed, pending, processed, successRate,
        denied: failureBreakdown.denied || 0,
        invalid: failureBreakdown.invalid || 0,
        rateLimited: failureBreakdown.rate_limited || 0,
        todaySent, todayFailed,
        replyCount: replies.length,
      },
      failureBreakdown,
      topFailures,
      hourlyToday,
      dailyChart,
      campaignStats,
      replies: replies.slice(-20),
    };
  });
}

function markReply(email, subject, snippet) {
  withStore((data) => {
    if (!data.replies) data.replies = [];
    data.replies.push({
      id: nextId(data, 'replies'),
      email, subject: subject || '', snippet: snippet || '', received_at: now(),
    });
  });
}

function markBounce(email, reason = 'Delivery failed') {
  withStore((data) => {
    const emailLower = email.toLowerCase();
    const contact = data.contacts.find(c => c.email.toLowerCase() === emailLower);
    if (contact) {
      contact.status = 'bounced';
      contact.failure_reason = reason;
      contact.suppressed_at = now();
    }
    for (const log of data.send_log) {
      if (log.email.toLowerCase() === emailLower && log.status === 'sent') {
        log.status = 'failed';
        log.failure_type = 'invalid_recipient';
        log.error_message = reason;
      }
    }
  });
}

module.exports = {
  getContacts, addContact, addContactsBulk, deleteContact, deleteAllContacts,
  getContactById, getActiveContactIds, getEligibleContactIds, getSuccessfulContactIds, getCampaignSentCount, getContactCounts, getAllListCounts,
  suppressContact, getSentEmailsForList,
  getCampaigns, getCampaign, createCampaign, updateCampaign, setCampaignStatus, getCampaignsByStatus,
  queueCampaign, getPendingQueue, getPendingCount, getQueueRetries, requeueItem, bumpQueueItemToEnd, deferQueueItem,
  requeueFailedActiveForAccount, restoreTransientBlockedContacts,
  deferBlockedQueueItems, getAccountQuotaState, setAccountQuotaState,
  pauseAllCampaigns, pauseCampaignsForAccount,
  markSent, markFailed, markQueueSkippedDuplicate, purgeDuplicatePendingQueue, wasEmailSentGlobally, updateCampaignStatuses,
  getTodaySentCount, getRemainingToday, getRecentLogs, getLast7Days, getCampaignStatusCounts,
  getMeta, setMeta, getCustomVariables, setCustomVariables, addCustomVariable, deleteCustomVariable,
  getLeadProviderKeys, getLeadProviderKey, setLeadProviderKey,
  getAccountDailyLimits, getAccountDailyLimit, setAccountDailyLimit,
  getSavedSmtpAccounts, saveSmtpAccount, getSavedSmtpAccountRaw, deleteSavedSmtpAccount,
  getQueueProgress, resumeSendingCampaigns, getAnalytics, markReply, markBounce,
  flushStore,
};
