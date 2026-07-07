const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { getAccounts, getAccount, getDefaultAccount } = require('./accounts');
const { htmlToPlain, wrapHtmlEmail, classifySmtpError } = require('./email-utils');
const { generatePersonalizedOpener, generatePersonalizedClosing } = require('./personalize-opener');

const transporters = {};
const accountTimers = {};
let lastSendDelayMs = 5000;

const senderState = {
  lastError: null,
  lastSentAt: null,
  accountState: {},
};

function initAccountState(accountId) {
  if (!senderState.accountState[accountId]) {
    senderState.accountState[accountId] = {
      dailyQuotaHit: false,
      quotaHitDate: null,
      blockedUntil: null,
      pausedUntil: null,
      pauseReason: null,
      consecutiveRateLimits: 0,
      isSending: false,
    };
  }
  return senderState.accountState[accountId];
}

function getSmtpConfig(accountId) {
  const acc = getAccount(accountId) || getDefaultAccount();
  if (!acc) return {};
  return {
    id: acc.id,
    host: acc.host,
    port: acc.port,
    secure: acc.secure,
    user: acc.email,
    pass: acc.pass,
    from: acc.from,
    fromName: acc.fromName,
    dailyLimit: acc.dailyLimit,
    sendDelayMs: acc.sendDelayMs,
    protected: acc.protected,
  };
}

function createTransporter(accountId) {
  const cfg = getSmtpConfig(accountId);
  if (!cfg.user || !cfg.pass) {
    throw new Error(`SMTP not configured for ${accountId}`);
  }
  const auth = { user: cfg.user, pass: cfg.pass };
  if (cfg.host === 'smtp.gmail.com') {
    return nodemailer.createTransport({ service: 'gmail', auth, pool: false });
  }
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure, auth, pool: false,
  });
}

function getTransporter(accountId) {
  if (!transporters[accountId]) transporters[accountId] = createTransporter(accountId);
  return transporters[accountId];
}

function resetTransporter(accountId = null) {
  if (accountId) {
    delete transporters[accountId];
    return;
  }
  Object.keys(transporters).forEach(k => delete transporters[k]);
}

async function verifySmtp(accountId) {
  const id = accountId || getDefaultAccount()?.id;
  await createTransporter(id).verify();
  return true;
}

function personalize(text, contact) {
  const c = typeof contact === 'object' ? contact : { name: contact, email: arguments[2] };
  const first = c.first_name || (c.name || '').split(' ')[0] || 'there';
  const last = c.last_name || '';
  const fullName = c.name || [first, last].filter(Boolean).join(' ') || 'there';

  const location = c.city || 'your area';

  const map = {
    '{{first_name}}': first,
    '{{last_name}}': last,
    '{{name}}': fullName,
    '{{title}}': c.title || 'your role',
    '{{job_title}}': c.title || 'your role',
    '{{company}}': c.company || 'your organization',
    '{{website}}': c.website || '',
    '{{linkedin}}': c.linkedin || '',
    '{{email}}': c.email || '',
    '{{city}}': c.city || '',
    '{{country}}': c.country || '',
    '{{location}}': location,
    '{{industry}}': c.industry || 'your industry',
    '{{personalized_opener}}': generatePersonalizedOpener(c),
    '{{personalized_closing}}': generatePersonalizedClosing(c),
  };

  let result = text || '';
  for (const [token, value] of Object.entries(map)) {
    result = result.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'gi'), value);
  }
  return result;
}

function buildEmailContent(campaign, contact, accountId) {
  const cfg = getSmtpConfig(accountId);
  const subject = personalize(campaign.subject, contact);
  const rawHtml = personalize(campaign.body_html, contact);
  const preheader = personalize(campaign.preheader || '', contact);

  const html = campaign.include_unsubscribe === true
    ? wrapHtmlEmail(rawHtml, { preheader, fromEmail: cfg.from })
    : wrapHtmlEmail(rawHtml, { preheader });

  const plainSource = campaign.body_text || htmlToPlain(rawHtml);
  const text = personalize(plainSource, contact);

  return { subject, html, text, cfg };
}

function renderPreview(campaign, sampleContact, accountId) {
  const contact = sampleContact || {
    first_name: 'Alex', last_name: 'Morgan', name: 'Alex Morgan',
    title: 'CTO', company: 'Example Technologies', email: 'alex@example.com',
  };
  const { subject, html, text, cfg } = buildEmailContent(campaign, contact, accountId);
  return {
    subject,
    html,
    text,
    from: cfg.from,
    fromName: cfg.fromName,
    to: contact.email,
    sampleContact: contact,
  };
}

function pauseSenderForAccount(accountId, ms, reason) {
  const state = initAccountState(accountId);
  state.pausedUntil = Date.now() + ms;
  state.pauseReason = reason;
  console.log(`[${accountId}] Sender paused for ${Math.round(ms / 1000)}s: ${reason}`);
}

function clearAccountPause(accountId) {
  const state = initAccountState(accountId);
  state.pausedUntil = null;
  state.pauseReason = null;
}

function isAccountPaused(accountId) {
  const state = initAccountState(accountId);
  if (state.pausedUntil && Date.now() < state.pausedUntil) return true;
  if (state.pausedUntil && Date.now() >= state.pausedUntil) {
    clearAccountPause(accountId);
    state.consecutiveRateLimits = Math.max(0, state.consecutiveRateLimits - 1);
  }
  return false;
}

function accountCanSend(accountId) {
  const acc = getAccount(accountId);
  if (!acc) return false;

  const state = initAccountState(accountId);
  const today = new Date().toLocaleDateString('en-CA');

  if (state.blockedUntil && Date.now() < state.blockedUntil) return false;
  if (state.blockedUntil && Date.now() >= state.blockedUntil) state.blockedUntil = null;

  const remaining = store.getRemainingToday(acc.dailyLimit, accountId);
  if (remaining <= 0) return false;

  // Clear stale quota flag when sends are still available today
  if (state.dailyQuotaHit && state.quotaHitDate === today) {
    state.dailyQuotaHit = false;
    state.quotaHitDate = null;
  }

  return true;
}

function accountHasPendingWork(accountId) {
  return store.getPendingCount(accountId) > 0;
}

async function sendOneEmail(campaign, contact, accountId) {
  const cfg = getSmtpConfig(accountId);
  const t = getTransporter(accountId);
  const { subject, html, text } = buildEmailContent(campaign, contact, accountId);

  const mailOptions = {
    from: `"${cfg.fromName}" <${cfg.from}>`,
    replyTo: `"${cfg.fromName}" <${cfg.from}>`,
    to: contact.email,
    subject,
    html,
    text,
    headers: {
      'Message-ID': `<${crypto.randomUUID()}@${cfg.from.split('@')[1] || 'mail.local'}>`,
      'X-Auto-Response-Suppress': 'OOF, AutoReply',
    },
  };

  if (campaign.include_unsubscribe === true) {
    mailOptions.headers['List-Unsubscribe'] = `<mailto:${cfg.from}?subject=unsubscribe>`;
    mailOptions.headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  if (campaign.attachment?.path && fs.existsSync(campaign.attachment.path)) {
    mailOptions.attachments = [{
      filename: campaign.attachment.filename,
      path: campaign.attachment.path,
    }];
  }

  await t.sendMail(mailOptions);
}

async function sendTestEmail(campaign, testTo, sampleContact, accountId) {
  const contact = { ...sampleContact, email: testTo };
  await sendOneEmail(campaign, contact, accountId || getDefaultAccount()?.id);
  return { sentTo: testTo, previewAs: sampleContact.first_name };
}

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

async function processNextEmailForAccount(accountId) {
  const state = initAccountState(accountId);
  if (state.isSending) return { skipped: true, reason: 'already_sending', accountId };

  if (isAccountPaused(accountId)) {
    return { skipped: true, reason: 'paused', pauseReason: state.pauseReason, accountId };
  }

  if (!accountCanSend(accountId)) {
    return { skipped: true, reason: 'at_limit', accountId };
  }

  const items = store.getPendingQueue(1, accountId);
  if (items.length === 0) {
    if (store.getPendingCount() === 0) store.updateCampaignStatuses();
    stopAccountSender(accountId);
    return { skipped: true, reason: 'queue_empty', accountId };
  }

  const item = items[0];
  const acc = getAccount(accountId);
  const meta = { smtp_account_id: accountId, list_id: item.list_id };

  state.isSending = true;

  try {
    await sendOneEmail(item, item, accountId);
    store.markSent(item.queue_id, item.campaign_id, item.contact_id, item.email, meta);
    store.updateCampaignStatuses();
    state.consecutiveRateLimits = 0;
    senderState.lastError = null;
    senderState.lastSentAt = Date.now();
    lastSendDelayMs = acc?.sendDelayMs || 5000;
    const todayCount = store.getTodaySentCount(accountId);
    console.log(`✓ [${accountId}] Sent to ${item.email} (${todayCount}/${acc.dailyLimit} today)`);
    return { success: true, email: item.email, accountId };
  } catch (err) {
    const classified = classifySmtpError(err);
    senderState.lastError = { ...classified, raw: err.message, at: new Date().toISOString(), accountId };

    if (classified.type === 'rate_limit' || classified.type === 'temporary') {
      const retries = store.getQueueRetries(item.queue_id);
      if (retries < MAX_RETRIES) {
        store.requeueItem(item.queue_id, classified.message);
        state.consecutiveRateLimits++;
        const backoff = classified.pauseMs * Math.pow(1.5, state.consecutiveRateLimits - 1);
        const pauseMs = acc?.protected ? Math.min(backoff * 2, 3600000) : Math.min(backoff, 1800000);
        pauseSenderForAccount(accountId, pauseMs, classified.message);
        console.warn(`↻ [${accountId}] Rate limited on ${item.email} — retry ${retries + 1}/${MAX_RETRIES}`);
        return { success: false, email: item.email, retry: true, error: classified.message, accountId };
      }
    }

    if (classified.stopDay) {
      state.dailyQuotaHit = true;
      state.quotaHitDate = new Date().toLocaleDateString('en-CA');
      store.requeueItem(item.queue_id, classified.message);
      console.error(`⛔ [${accountId}] Daily quota hit — remaining saved for tomorrow`);
      return { success: false, email: item.email, error: classified.message, accountId };
    }

    if (classified.pauseAll) {
      store.pauseCampaignsForAccount(accountId);
      store.requeueItem(item.queue_id, classified.message);
      const pauseMs = acc?.protected ? 7200000 : 3600000;
      pauseSenderForAccount(accountId, pauseMs, classified.message);
      if (acc?.protected) {
        state.blockedUntil = Date.now() + pauseMs;
        console.error(`⛔ [${accountId}] PROTECTED account — blocked, pausing ${pauseMs / 60000} min`);
      } else {
        console.error(`⛔ [${accountId}] Gmail blocked sending — paused ${pauseMs / 60000} min`);
      }
      return { success: false, email: item.email, error: classified.message, accountId };
    }

    store.markFailed(item.queue_id, item.campaign_id, item.contact_id, item.email, err.message, classified.type, meta);
    store.updateCampaignStatuses();
    console.error(`✗ [${accountId}] Failed ${item.email}: ${err.message}`);
    return { success: false, email: item.email, error: err.message, accountId };
  } finally {
    state.isSending = false;
  }
}

async function processNextEmail() {
  const accounts = getAccounts();
  for (const acc of accounts) {
    if (!accountTimers[acc.id]) continue;
    const result = await processNextEmailForAccount(acc.id);
    if (result.success || result.retry) return result;
  }
  return { skipped: true, reason: 'no_active_workers' };
}

function scheduleAccountSender(accountId) {
  if (accountTimers[accountId]) return;

  const acc = getAccount(accountId);
  const tick = async () => {
    if (!accountTimers[accountId]) return;
    try {
      await processNextEmailForAccount(accountId);
    } catch (err) {
      console.error(`[${accountId}] Send error:`, err.message);
    }

    if (!accountTimers[accountId]) return;

    const pending = store.getPendingCount(accountId);
    if (pending === 0 || !accountCanSend(accountId)) {
      stopAccountSender(accountId);
      if (store.getPendingCount() === 0) store.updateCampaignStatuses();
      return;
    }

    const delay = acc?.sendDelayMs || 5000;
    accountTimers[accountId] = setTimeout(tick, delay);
  };

  accountTimers[accountId] = setTimeout(tick, 100);
}

function stopAccountSender(accountId) {
  if (accountTimers[accountId]) {
    clearTimeout(accountTimers[accountId]);
    delete accountTimers[accountId];
  }
}

function startSender() {
  const accounts = getAccounts();
  let started = false;

  for (const acc of accounts) {
    const pending = store.getPendingCount(acc.id);
    if (pending > 0 && accountCanSend(acc.id)) {
      scheduleAccountSender(acc.id);
      started = true;
    }
  }

  if (!started) {
    const totalPending = store.getPendingCount();
    if (totalPending === 0) {
      console.log('No pending emails in queue');
    } else {
      console.log('All accounts at daily limit — will resume tomorrow');
    }
    return;
  }

  store.resumeSendingCampaigns();
  store.setMeta({ userStoppedSender: false });
  const progress = store.getQueueProgress();
  const activeWorkers = Object.keys(accountTimers).join(', ');
  console.log(`Email sender started (${activeWorkers}) — #${progress.nextPosition} of ${progress.total} (${progress.pending} remaining)`);
}

function stopSender(userInitiated = true) {
  for (const accountId of Object.keys(accountTimers)) {
    stopAccountSender(accountId);
  }

  if (userInitiated) {
    const progress = store.getQueueProgress();
    store.setMeta({
      userStoppedSender: true,
      stoppedAt: new Date().toISOString(),
      stoppedAtPosition: progress.completed,
      stoppedNextEmail: progress.nextEmail,
    });
    console.log(`Sender stopped by user at #${progress.completed} of ${progress.total}`);
  }
}

function resetDailyState() {
  for (const acc of getAccounts()) {
    const state = initAccountState(acc.id);
    state.dailyQuotaHit = false;
    state.quotaHitDate = null;
    state.blockedUntil = null;
    state.pausedUntil = null;
    state.pauseReason = null;
    state.consecutiveRateLimits = 0;
  }
  store.setMeta({ userStoppedSender: false, lastDailyLimitAt: null });
}

function getAccountStatuses() {
  return getAccounts().map(acc => {
    const state = initAccountState(acc.id);
    const todaySent = store.getTodaySentCount(acc.id);
    const remaining = store.getRemainingToday(acc.dailyLimit, acc.id);
    const today = new Date().toLocaleDateString('en-CA');
    const paused = isAccountPaused(acc.id);
    return {
      id: acc.id,
      email: acc.email,
      label: acc.label,
      listId: acc.listId,
      listLabel: acc.listLabel,
      protected: acc.protected,
      dailyLimit: acc.dailyLimit,
      sendDelayMs: acc.sendDelayMs,
      todaySent,
      remainingToday: remaining,
      dailyQuotaHit: state.dailyQuotaHit && state.quotaHitDate === today,
      blocked: state.blockedUntil && Date.now() < state.blockedUntil,
      blockedUntil: state.blockedUntil ? new Date(state.blockedUntil).toISOString() : null,
      running: !!accountTimers[acc.id],
      isSending: !!state.isSending,
      paused,
      pauseReason: paused ? state.pauseReason : null,
      pausedUntil: paused && state.pausedUntil ? new Date(state.pausedUntil).toISOString() : null,
      pendingQueue: store.getPendingCount(acc.id),
    };
  });
}

function getSenderStatus() {
  const meta = store.getMeta();
  const progress = store.getQueueProgress();
  const accounts = getAccountStatuses();
  const totalRemaining = accounts.reduce((s, a) => s + a.remainingToday, 0);
  const totalSentToday = accounts.reduce((s, a) => s + a.todaySent, 0);
  const daysLeft = totalRemaining > 0
    ? Math.ceil(progress.pending / totalRemaining)
    : Math.ceil(progress.pending / (accounts[0]?.dailyLimit || 490));
  const running = accounts.some(a => a.running);
  const isSending = accounts.some(a => a.isSending);
  const pausedAccounts = accounts.filter(a => a.paused);
  const dailyQuotaHit = accounts.length > 0 && accounts.every(a => a.dailyQuotaHit || a.remainingToday <= 0);

  return {
    running,
    isSending,
    accounts,
    todaySent: totalSentToday,
    remainingToday: totalRemaining,
    pendingQueue: progress.pending,
    sendDelayMs: lastSendDelayMs,
    paused: pausedAccounts.length > 0,
    pauseReason: pausedAccounts.map(a => `[${a.id}] ${a.pauseReason}`).join('; ') || null,
    pausedUntil: pausedAccounts[0]?.pausedUntil || null,
    dailyQuotaHit,
    dailyLimitReached: totalRemaining <= 0 && progress.pending > 0,
    lastError: senderState.lastError,
    lastSentAt: senderState.lastSentAt ? new Date(senderState.lastSentAt).toISOString() : null,
    userStopped: meta.userStoppedSender || false,
    stoppedAtPosition: meta.stoppedAtPosition || progress.completed,
    stoppedNextEmail: meta.stoppedNextEmail || progress.nextEmail,
    progress,
    estimatedDaysRemaining: progress.pending > 0 ? daysLeft : 0,
    parallelMode: true,
  };
}

const defaultAccount = getDefaultAccount();
const DAILY_LIMIT = defaultAccount?.dailyLimit || parseInt(process.env.DAILY_LIMIT || '490', 10);

module.exports = {
  getSmtpConfig,
  verifySmtp,
  resetTransporter,
  startSender,
  stopSender,
  getSenderStatus,
  getAccountStatuses,
  queueCampaign: store.queueCampaign,
  processNextEmail,
  resetDailyState,
  sendTestEmail,
  renderPreview,
  personalize,
  DAILY_LIMIT,
};
