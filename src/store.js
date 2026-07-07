const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'store.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

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

function save(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

function withStore(fn) {
  const data = load();
  const result = fn(data);
  save(data);
  return result;
}

function withStoreRead(fn) {
  return fn(load());
}

// --- Contacts ---

function getContacts({ search = '', page = 1, limit = 50, list_id } = {}) {
  return withStoreRead((data) => {
    let list = data.contacts;
    if (list_id) list = list.filter(c => c.list_id === list_id);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.email.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q));
    }
    const total = list.length;
    const offset = (page - 1) * limit;
    const contacts = [...list].sort((a, b) => b.id - a.id).slice(offset, offset + limit);
    return { contacts, total, page, limit, list_id: list_id || null };
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
      company_profile: fields.company_profile || '',
      list_id: listId,
      status: 'active',
      created_at: now(),
    };
    data.contacts.push(contact);
    return contact;
  });
}

function addContactsBulk(rows, listId = 'list1') {
  const BATCH = 500;
  let added = 0, skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = withStore((data) => {
      let bAdded = 0, bSkipped = 0;
      for (const row of batch) {
        const { email, name, first_name, last_name, company, title, website, linkedin } = row;
        if (!email || !email.includes('@')) { bSkipped++; continue; }
        const exists = data.contacts.some(c =>
          c.email.toLowerCase() === email.toLowerCase() && c.list_id === listId
        );
        if (exists) { bSkipped++; continue; }
        data.contacts.push({
          id: nextId(data, 'contacts'), email,
          name: name || [first_name, last_name].filter(Boolean).join(' '),
          first_name: first_name || '', last_name: last_name || '',
          company: company || '', title: title || '',
          website: website || '', linkedin: linkedin || '',
          city: row.city || '', country: row.country || '', industry: row.industry || '',
          company_profile: row.company_profile || '',
          list_id: listId,
          status: 'active', created_at: now(),
        });
        bAdded++;
      }
      return { added: bAdded, skipped: bSkipped };
    });
    added += result.added;
    skipped += result.skipped;
  }

  return { added, skipped, listId };
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

function getSentEmailsForList(listId) {
  return withStoreRead((data) => {
    const sent = new Set();
    for (const log of data.send_log) {
      if (log.status === 'sent' && log.list_id === listId) {
        sent.add(log.email.toLowerCase());
      }
    }
    for (const q of data.send_queue) {
      if (q.status === 'sent') {
        const contact = data.contacts.find(c => c.id === q.contact_id);
        if (contact?.list_id === listId) sent.add(contact.email.toLowerCase());
      }
    }
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

function getEligibleContactIds(listId, { skipAlreadySent = true } = {}) {
  return withStoreRead((data) => {
    const sentEmails = new Set();
    if (skipAlreadySent) {
      for (const log of data.send_log) {
        if (log.status === 'sent' && log.list_id === listId) {
          sentEmails.add(log.email.toLowerCase());
        }
      }
      for (const q of data.send_queue) {
        if (q.status === 'sent') {
          const contact = data.contacts.find(c => c.id === q.contact_id);
          if (contact?.list_id === listId) sentEmails.add(contact.email.toLowerCase());
        }
      }
    }
    return data.contacts
      .filter(c => c.list_id === listId && c.status === 'active')
      .filter(c => !skipAlreadySent || !sentEmails.has(c.email.toLowerCase()))
      .map(c => c.id);
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

function createCampaign({ name, subject, body_html, body_text = '', attachment = null, preheader = '', include_unsubscribe = false, smtp_account_id = 'account1', list_id = 'list1' }) {
  return withStore((data) => {
    const campaign = {
      id: nextId(data, 'campaigns'), name, subject, body_html, body_text,
      preheader, include_unsubscribe,
      smtp_account_id, list_id,
      attachment,
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

function queueCampaign(campaignId, contactIds) {
  return withStore((data) => {
    const camp = data.campaigns.find(c => c.id === campaignId);
    const listId = camp?.list_id || 'list1';
    let added = 0;

    for (const contactId of contactIds) {
      const contact = data.contacts.find(c => c.id === contactId);
      if (!contact || contact.status !== 'active') continue;

      const alreadyQueued = data.send_queue.some(q =>
        q.campaign_id === campaignId && q.contact_id === contactId
      );
      const alreadySent = data.send_log.some(l =>
        l.status === 'sent' && l.email.toLowerCase() === contact.email.toLowerCase() && l.list_id === listId
      );
      if (alreadyQueued || alreadySent) continue;

      data.send_queue.push({
        id: nextId(data, 'send_queue'),
        campaign_id: campaignId,
        contact_id: contactId,
        smtp_account_id: camp?.smtp_account_id || 'account1',
        list_id: listId,
        status: 'pending',
        error_message: null,
        sent_at: null,
      });
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
    const items = data.send_queue
      .filter(q => q.status === 'pending')
      .sort((a, b) => a.id - b.id);

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
        subject: camp.subject, body_html: camp.body_html, body_text: camp.body_text,
        preheader: camp.preheader || '', include_unsubscribe: camp.include_unsubscribe === true,
        attachment: camp.attachment || null,
        campaign_name: camp.name,
      });
    }
    return result;
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
      if (l.status !== 'sent' || l.sent_at.slice(0, 10) !== today) return false;
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
    return [...data.send_log]
      .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))
      .slice(0, limit)
      .map(log => {
        const contact = data.contacts.find(c => c.id === log.contact_id);
        return { ...log, contact_name: contact?.name || null };
      });
  });
}

function getLast7Days() {
  return withStoreRead((data) => {
    const days = {};
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const log of data.send_log) {
      if (log.status !== 'sent' || new Date(log.sent_at) < cutoff) continue;
      const day = log.sent_at.slice(0, 10);
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

function getQueueProgress() {
  return withStoreRead((data) => {
    const total = data.send_queue.length;
    const pending = data.send_queue.filter(q => q.status === 'pending').length;
    const sent = data.send_queue.filter(q => q.status === 'sent').length;
    const failed = data.send_queue.filter(q => q.status === 'failed').length;
    const completed = sent + failed;

    const nextItem = data.send_queue
      .filter(q => q.status === 'pending')
      .sort((a, b) => a.id - b.id)[0];

    let nextEmail = null;
    if (nextItem) {
      const contact = data.contacts.find(c => c.id === nextItem.contact_id);
      nextEmail = contact?.email || null;
    }

    const lastSentLog = [...data.send_log]
      .filter(l => l.status === 'sent')
      .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0];

    const activeCampaigns = data.campaigns
      .filter(c => ['sending', 'queued', 'paused'].includes(c.status) && c.sent_count < c.total_recipients)
      .map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        smtp_account_id: c.smtp_account_id || 'account1',
        list_id: c.list_id || 'list1',
        sent: c.sent_count,
        total: c.total_recipients,
        pending: data.send_queue.filter(q => q.campaign_id === c.id && q.status === 'pending').length,
        percentComplete: c.total_recipients > 0
          ? Math.round((c.sent_count / c.total_recipients) * 100)
          : 0,
      }));

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
        if (hasPending) camp.status = 'queued';
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
    const queue = data.send_queue;
    const logs = data.send_log;
    const sent = queue.filter(q => q.status === 'sent').length;
    const failed = queue.filter(q => q.status === 'failed').length;
    const pending = queue.filter(q => q.status === 'pending').length;
    const total = queue.length;
    const processed = sent + failed;
    const successRate = processed > 0 ? Math.round((sent / processed) * 1000) / 10 : 0;

    const failureBreakdown = {};
    for (const log of logs.filter(l => l.status === 'failed')) {
      const cat = categorizeFailure(log.failure_type || 'other');
      failureBreakdown[cat] = (failureBreakdown[cat] || 0) + 1;
    }

    const failureReasons = {};
    for (const log of logs.filter(l => l.status === 'failed' && l.error_message)) {
      const key = (log.error_message || '').slice(0, 80);
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }
    const topFailures = Object.entries(failureReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count }));

    const today = todayLocal();
    const hourlyToday = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0, failed: 0 }));
    for (const log of logs) {
      const d = new Date(log.sent_at);
      if (d.toLocaleDateString('en-CA') !== today) continue;
      const h = d.getHours();
      if (log.status === 'sent') hourlyToday[h].sent++;
      else if (log.status === 'failed') hourlyToday[h].failed++;
    }

    const daily14 = {};
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const log of logs) {
      if (new Date(log.sent_at) < cutoff) continue;
      const day = log.sent_at.slice(0, 10);
      if (!daily14[day]) daily14[day] = { day, sent: 0, failed: 0 };
      if (log.status === 'sent') daily14[day].sent++;
      else if (log.status === 'failed') daily14[day].failed++;
    }
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
      pending: data.send_queue.filter(q => q.campaign_id === c.id && q.status === 'pending').length,
      successRate: (c.sent_count + c.failed_count) > 0
        ? Math.round((c.sent_count / (c.sent_count + c.failed_count)) * 1000) / 10
        : 0,
      started_at: c.started_at,
      completed_at: c.completed_at,
    })).sort((a, b) => b.id - a.id);

    const todaySent = logs.filter(l => l.status === 'sent' && l.sent_at.slice(0, 10) === today).length;
    const todayFailed = logs.filter(l => l.status === 'failed' && l.sent_at.slice(0, 10) === today).length;

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
  getActiveContactIds, getEligibleContactIds, getContactCounts, getAllListCounts,
  suppressContact, getSentEmailsForList,
  getCampaigns, getCampaign, createCampaign, updateCampaign, setCampaignStatus, getCampaignsByStatus,
  queueCampaign, getPendingQueue, getPendingCount, getQueueRetries, requeueItem, pauseAllCampaigns, pauseCampaignsForAccount,
  markSent, markFailed, updateCampaignStatuses,
  getTodaySentCount, getRemainingToday, getRecentLogs, getLast7Days, getCampaignStatusCounts,
  getMeta, setMeta, getQueueProgress, resumeSendingCampaigns, getAnalytics, markReply, markBounce,
};
