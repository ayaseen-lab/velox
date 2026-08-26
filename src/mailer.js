const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const { getAccounts, getAccount, getDefaultAccount, resetAccountsCache } = require('./accounts');
const { saveCopyToSent } = require('./save-to-sent');
const hostingerMailApi = require('./hostinger-mail-api');
const { getWarmupPlan, jitterDelay, warmupAllowsRecipient, isWarmupSeedOnly, getWarmupSeedEmails } = require('./warmup');
const { htmlToPlain, wrapHtmlEmail, classifySmtpError } = require('./email-utils');
const {
  generatePersonalizedOpener,
  generatePersonalizedClosing,
  generatePersonalizedSubject,
  generateLocationLine,
} = require('./personalize-opener');

const transporters = {};
const accountTimers = {};
let lastSendDelayMs = parseInt(process.env.SEND_DELAY_MS || '100', 10);

const ON_RAILWAY = !!(
  process.env.RAILWAY_ENVIRONMENT
  || process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_PROJECT_ID
);
const SEND_CONCURRENCY = Math.max(1, Math.min(parseInt(process.env.SEND_CONCURRENCY || '8', 10) || 8, 12));
const DEFAULT_SEND_DELAY_MS = parseInt(process.env.SEND_DELAY_MS || '100', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function smtpFallbackAllowed(accountId) {
  if (ON_RAILWAY) return false;
  if (hostingerMailApi.isConfigured(accountId)) return false;
  if (String(process.env.DISABLE_SMTP_FALLBACK || '').toLowerCase() === 'true') return false;
  return true;
}

const senderState = {
  lastError: null,
  lastSentAt: null,
  accountState: {},
};

function initAccountState(accountId) {
  if (!senderState.accountState[accountId]) {
    const today = new Date().toLocaleDateString('en-CA');
    const persisted = store.getAccountQuotaState(accountId);
    senderState.accountState[accountId] = {
      dailyQuotaHit: !!(persisted.dailyQuotaHit && persisted.quotaHitDate === today),
      quotaHitDate: persisted.quotaHitDate || null,
      blockedUntil: null,
      pausedUntil: null,
      pauseReason: null,
      consecutiveRateLimits: 0,
      isSending: false,
      inFlight: 0,
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

function smtpTransportOptions(cfg) {
  const host = cfg.host;
  const port = parseInt(cfg.port, 10) || 587;
  const secure = cfg.secure === true || port === 465;
  const auth = { user: cfg.user || cfg.email, pass: cfg.pass };
  const opts = {
    host,
    port,
    secure,
    auth,
    pool: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    family: 4,
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
      rejectUnauthorized: true,
    },
  };
  if (!secure) opts.requireTLS = true;
  return opts;
}

function createTransporter(accountId) {
  const cfg = getSmtpConfig(accountId);
  if (!cfg.user || !cfg.pass) {
    throw new Error(`SMTP not configured for ${accountId}`);
  }
  return nodemailer.createTransport(smtpTransportOptions(cfg));
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

function isTimeoutError(err) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  return /timeout|timed out|etimedout|econnrefused|enotfound/.test(msg);
}

async function verifySmtp(accountId) {
  const id = accountId || getDefaultAccount()?.id;
  const cfg = getSmtpConfig(id);

  if (hostingerMailApi.isConfigured(id)) {
    try {
      await hostingerMailApi.verifyMailApi(id);
      return { ok: true, via: 'hostinger-mail-api' };
    } catch (err) {
      if (!smtpFallbackAllowed(id)) throw err;
      console.warn(`[${id}] Hostinger Mail API verify failed, trying SMTP: ${err.message}`);
    }
  }

  try {
    await createTransporter(id).verify();
    return { ok: true, via: 'smtp' };
  } catch (err) {
    const hostinger = (cfg.host || '').includes('hostinger');
    if (hostinger && isTimeoutError(err) && cfg.port === 465) {
      const fallback = nodemailer.createTransport(smtpTransportOptions({
        ...cfg,
        port: 587,
        secure: false,
      }));
      await fallback.verify();
      transporters[id] = fallback;
      console.warn(`[${id}] SMTP 465 timed out; using 587 STARTTLS`);
      return { ok: true, via: 'smtp' };
    }
    if (hostingerMailApi.isConfigured(id) && isTimeoutError(err)) {
      await hostingerMailApi.verifyMailApi(id);
      return { ok: true, via: 'hostinger-mail-api' };
    }
    throw err;
  }
}

function toDisplayCase(value) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s !== s.toUpperCase() || s.length < 2) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Ltd|Llp|Dba)\b/g, (m) => m.toUpperCase());
}

function personalize(text, contact) {
  const c = typeof contact === 'object' ? contact : { name: contact, email: arguments[2] };
  const first = toDisplayCase(c.first_name) || toDisplayCase(c.name).split(' ')[0] || 'there';
  const last = toDisplayCase(c.last_name);
  const fullName = toDisplayCase(c.name) || [first, last].filter(Boolean).join(' ') || 'there';
  const company = toDisplayCase(c.company);
  const title = toDisplayCase(c.title);
  const city = toDisplayCase(c.city);
  const country = String(c.country || '').trim();
  const location = [city, country].filter(Boolean).join(', ') || city || country;
  const dot = String(c.dot || c.usdot || c.dot_number || '').replace(/[^0-9]/g, '') || String(c.dot || '').trim();
  const mcRaw = String(c.mc || '').trim();
  const mc = mcRaw ? ( /^mc/i.test(mcRaw) ? mcRaw.toUpperCase().replace(/\s+/g, '') : `MC${mcRaw.replace(/[^0-9]/g, '')}` ) : '';

  const map = {
    '{{first_name}}': first,
    '{{last_name}}': last,
    '{{name}}': fullName,
    '{{title}}': title,
    '{{job_title}}': title,
    '{{company}}': company,
    '{{website}}': c.website || '',
    '{{linkedin}}': c.linkedin || '',
    '{{email}}': c.email || '',
    '{{city}}': city,
    '{{country}}': country,
    '{{state}}': country,
    '{{zip}}': String(c.zip || '').trim(),
    '{{location}}': location,
    '{{address}}': String(c.address || '').trim(),
    '{{industry}}': (c.industry || '').trim(),
    '{{phone}}': String(c.phone || '').trim(),
    '{{dot}}': dot,
    '{{usdot}}': dot,
    '{{mc}}': mc,
    '{{drivers}}': String(c.drivers || '').trim(),
    '{{power_units}}': String(c.power_units || '').trim(),
    '{{authority_status}}': String(c.authority_status || '').trim(),
    '{{personalized_opener}}': generatePersonalizedOpener(c),
    '{{personalized_closing}}': generatePersonalizedClosing(c),
    '{{personalized_subject}}': generatePersonalizedSubject(c),
    '{{location_line}}': generateLocationLine(c),
    '{{portfolio_url}}': 'https://laneforge.xynovix.com/',
  };

  for (const cv of store.getCustomVariables()) {
    if (cv.token) map[cv.token] = cv.value || '';
  }

  for (const [key, val] of Object.entries(c)) {
    if (typeof val === 'string' && key.startsWith('custom_')) {
      map[`{{${key.replace(/^custom_/, '')}}}`] = val;
    }
  }

  let result = text || '';
  for (const [token, value] of Object.entries(map)) {
    result = result.replace(new RegExp(token.replace(/[{}]/g, '\\$&'), 'gi'), value);
  }

  // Clean awkward leftovers when company/title/location were empty
  result = result
    .replace(/\s+at\s+(?=[\.,;:!?<]|$)/gi, '')
    .replace(/\s+at\s+<\/p>/gi, '</p>')
    .replace(/\s+—\s+(?=[\.,;:!?<]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/>\s+</g, '><');

  return result;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAccountSignature(accountId) {
  const acc = getAccount(accountId);
  if (!acc?.email) return { html: '', text: '' };
  const isMarcus = acc.id === 'account1' || /marcus\.laneforge@/i.test(acc.email);
  if (!isMarcus) return { html: '', text: '' };

  const name = acc.fromName || 'Marcus Hale';
  const email = acc.email;
  const siteUrl = 'https://laneforge.xynovix.com';
  const siteLabel = 'laneforge.xynovix.com';
  const font = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.35;color:#222222;";
  return {
    html: `<p style="margin:12px 0 0;${font}">Cheers,<br>${escapeHtml(name)}<br>LaneForge Dispatch<br><a href="${siteUrl}" style="color:#222222;text-decoration:none;">${siteLabel}</a><br><a href="mailto:${escapeHtml(email)}" style="color:#222222;text-decoration:none;">${escapeHtml(email)}</a></p>`,
    text: `\nCheers,\n${name}\nLaneForge Dispatch\n${siteUrl}\n${email}`,
  };
}

function buildEmailContent(campaign, contact, accountId) {
  const cfg = getSmtpConfig(accountId);
  const subject = personalize(campaign.subject, contact);
  const rawHtml = personalize(campaign.body_html, contact);
  const preheader = personalize(campaign.preheader || '', contact);
  const signature = getAccountSignature(accountId);

  const html = wrapHtmlEmail(rawHtml, {
    preheader,
    fromEmail: campaign.include_unsubscribe === true ? cfg.from : '',
    signatureHtml: signature.html,
  });

  const plainSource = campaign.body_text || htmlToPlain(rawHtml);
  const text = personalize(plainSource, contact) + (signature.text || '');

  return { subject, html, text, cfg };
}

function renderPreview(campaign, sampleContact, accountId) {
  const contact = sampleContact || {
    first_name: 'Sherika', last_name: 'Rogers', name: 'Sherika Rogers',
    title: 'Owner', company: 'Inna Gee 365 LLC',
    city: 'Portsmouth', country: 'VA', email: 'ahmadjutt463@gmail.com',
    dot: '4504797', mc: 'MC1782591', drivers: '1',
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

function markAccountDailyQuotaHit(accountId) {
  const today = new Date().toLocaleDateString('en-CA');
  const state = initAccountState(accountId);
  state.dailyQuotaHit = true;
  state.quotaHitDate = today;
  store.setAccountQuotaState(accountId, { dailyQuotaHit: true, quotaHitDate: today });
  store.setMeta({ lastDailyLimitAt: new Date().toISOString() });
}

function accountCanSend(accountId, extraInFlight = 0) {
  const acc = getAccount(accountId);
  if (!acc) return false;

  const state = initAccountState(accountId);
  const today = new Date().toLocaleDateString('en-CA');

  if (state.blockedUntil && Date.now() < state.blockedUntil) return false;
  if (state.blockedUntil && Date.now() >= state.blockedUntil) state.blockedUntil = null;

  if (state.dailyQuotaHit && state.quotaHitDate === today) return false;

  const warmup = getWarmupPlan(accountId);
  if (warmup?.enabled && !warmup.inSendWindow) return false;

  const remaining = store.getRemainingToday(acc.dailyLimit, accountId);
  if (remaining - extraInFlight <= 0) {
    markAccountDailyQuotaHit(accountId);
    return false;
  }

  return true;
}

function accountHasPendingWork(accountId) {
  return store.getPendingCount(accountId) > 0;
}

async function sendViaSmtp(accountId, mailOptions) {
  const timeoutMs = parseInt(process.env.SEND_TIMEOUT_MS || '20000', 10);
  const t = getTransporter(accountId);
  await Promise.race([
    t.sendMail(mailOptions),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`SMTP send timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    }),
  ]);
  return { via: 'smtp', savedToSent: false };
}

async function sendOneEmail(campaign, contact, accountId, { waitForSent = false } = {}) {
  const cfg = getSmtpConfig(accountId);
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

  let via = 'smtp';
  let apiSavedToSent = false;

  if (hostingerMailApi.isConfigured(accountId)) {
    const apiResult = await hostingerMailApi.sendViaMailApiWithRetry(accountId, mailOptions);
    via = apiResult.via || 'hostinger-mail-api';
    apiSavedToSent = !!apiResult.savedToSent;
  } else if (smtpFallbackAllowed(accountId)) {
    await sendViaSmtp(accountId, mailOptions);
  } else {
    throw new Error('Mail API is required on this host; SMTP fallback is disabled');
  }

  let savedToSent = apiSavedToSent;
  if (!apiSavedToSent && !ON_RAILWAY) {
    const sentPromise = saveCopyToSent(accountId, mailOptions).catch((err) => {
      console.warn(`[${accountId}] Sent folder copy failed: ${err.message}`);
      return false;
    });
    if (waitForSent) {
      savedToSent = await sentPromise;
    } else {
      void sentPromise;
    }
  }
  return { savedToSent, via };
}

async function sendTestEmail(campaign, testTo, sampleContact, accountId) {
  const contact = { ...sampleContact, email: testTo };
  const result = await sendOneEmail(campaign, contact, accountId || getDefaultAccount()?.id, { waitForSent: true });
  return {
    sentTo: testTo,
    previewAs: sampleContact.first_name,
    savedToSent: !!result?.savedToSent,
    via: result?.via || 'smtp',
  };
}

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);

async function processNextEmailForAccount(accountId) {
  const state = initAccountState(accountId);

  if (isAccountPaused(accountId)) {
    return { skipped: true, reason: 'paused', pauseReason: state.pauseReason, accountId };
  }

  if (!accountCanSend(accountId, state.inFlight || 0)) {
    return { skipped: true, reason: 'at_limit', accountId };
  }

  let item;
  try {
    item = store.claimNextPending(accountId);
  } catch (err) {
    console.error(`[${accountId}] Queue claim failed: ${err.message}`);
    return { skipped: true, reason: 'claim_error', accountId };
  }

  if (item?.skippedBatch) {
    try { store.updateCampaignStatuses(); } catch (err) {
      console.warn(`[${accountId}] Status update failed: ${err.message}`);
    }
    return { success: true, skipped: true, skippedBatch: true, accountId };
  }

  if (!item) {
    if (store.getPendingCount() === 0) {
      try { store.updateCampaignStatuses(); } catch { /* ignore */ }
    }
    return { skipped: true, reason: 'queue_empty', accountId };
  }

  const acc = getAccount(accountId);
  const meta = { smtp_account_id: accountId, list_id: item.list_id };

  if (!warmupAllowsRecipient(accountId, item.email)) {
    store.markQueueSkippedDuplicate(
      item.queue_id,
      item.campaign_id,
      item.contact_id,
      item.email,
      meta,
      'Warmup seed-only — carrier list blocked until later warmup days',
    );
    store.updateCampaignStatuses();
    console.log(`⊘ [${accountId}] Warmup seed-only, skipped ${item.email}`);
    return { success: true, skipped: true, email: item.email, accountId };
  }

  state.inFlight = (state.inFlight || 0) + 1;
  state.isSending = true;

  try {
    await sendOneEmail(item, item, accountId, { waitForSent: false });
    try {
      store.markSent(item.queue_id, item.campaign_id, item.contact_id, item.email, meta);
      store.updateCampaignStatuses();
    } catch (storeErr) {
      console.error(`[${accountId}] Store update failed after send to ${item.email}: ${storeErr.message}`);
    }
    state.consecutiveRateLimits = 0;
    senderState.lastError = null;
    senderState.lastSentAt = Date.now();
    lastSendDelayMs = Number.isFinite(acc?.sendDelayMs) ? acc.sendDelayMs : DEFAULT_SEND_DELAY_MS;
    const todayCount = store.getTodaySentCount(accountId);
    console.log(`✓ [${accountId}] Sent to ${item.email} (${todayCount}/${acc.dailyLimit} today)`);
    return { success: true, email: item.email, accountId };
  } catch (err) {
    const classified = classifySmtpError(err);
    senderState.lastError = { ...classified, raw: err.message, at: new Date().toISOString(), accountId };

    if (classified.type === 'rate_limit' || classified.type === 'temporary') {
      const retries = store.getQueueRetries(item.queue_id);
      if (classified.retry !== false && retries < MAX_RETRIES) {
        store.requeueItem(item.queue_id, classified.message);
        store.bumpQueueItemToEnd(item.queue_id);
        state.consecutiveRateLimits++;
        if (acc?.protected && Number(classified.pauseMs) > 0) {
          const backoff = classified.pauseMs * Math.pow(1.5, state.consecutiveRateLimits - 1);
          const pauseMs = Math.min(backoff * 2, 3600000);
          pauseSenderForAccount(accountId, pauseMs, classified.message);
        }
        const workerDelayMs = classified.type === 'rate_limit'
          ? Math.min(2000 * state.consecutiveRateLimits, 8000)
          : 250;
        console.warn(`↻ [${accountId}] ${classified.type} on ${item.email} — retry ${retries + 1}/${MAX_RETRIES}`);
        return { success: false, email: item.email, retry: true, error: classified.message, accountId, workerDelayMs };
      }
    }

    if (classified.stopDay) {
      markAccountDailyQuotaHit(accountId);
      store.deferQueueItem(item.queue_id, classified.message);
      stopAccountSender(accountId);
      console.error(`⛔ [${accountId}] Gmail daily limit — deferred ${item.email} until tomorrow`);
      return { success: false, email: item.email, error: classified.message, accountId, stopDay: true };
    }

    if (classified.pauseAll) {
      store.requeueItem(item.queue_id, classified.message);
      if (acc?.protected) {
        store.pauseCampaignsForAccount(accountId);
        const pauseMs = 7200000;
        pauseSenderForAccount(accountId, pauseMs, classified.message);
        state.blockedUntil = Date.now() + pauseMs;
        console.error(`⛔ [${accountId}] PROTECTED account — blocked, pausing ${pauseMs / 60000} min`);
      } else {
        console.warn(`⊘ [${accountId}] pauseAll ignored for unprotected account — continuing`);
      }
      return { success: false, email: item.email, error: classified.message, accountId };
    }

    if (classified.type === 'blocked') {
      store.markFailed(item.queue_id, item.campaign_id, item.contact_id, item.email, classified.message, classified.type, meta);
      store.updateCampaignStatuses();
      if (acc?.protected) {
        pauseSenderForAccount(accountId, 7200000, classified.message);
        state.blockedUntil = Date.now() + 7200000;
        console.error(`⛔ [${accountId}] PROTECTED account — contact blocked, pausing 120 min`);
      } else {
        console.warn(`⊘ [${accountId}] Contact blocked ${item.email} — skipped, continuing`);
      }
      return { success: false, email: item.email, error: classified.message, accountId };
    }

    store.markFailed(item.queue_id, item.campaign_id, item.contact_id, item.email, err.message, classified.type, meta);
    store.updateCampaignStatuses();
    console.error(`✗ [${accountId}] Failed ${item.email}: ${err.message}`);
    return { success: false, email: item.email, error: err.message, accountId };
  } finally {
    state.inFlight = Math.max(0, (state.inFlight || 1) - 1);
    state.isSending = state.inFlight > 0;
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

function workerDelayForAccount(accountId, extraMs = 0) {
  const live = getAccount(accountId);
  const warmup = getWarmupPlan(accountId);
  let delay = Number.isFinite(live?.sendDelayMs) ? live.sendDelayMs : DEFAULT_SEND_DELAY_MS;
  delay = jitterDelay(delay, { warmup: !!warmup?.enabled });
  if (warmup?.enabled && !warmup.inSendWindow) {
    delay = Math.max(warmup.waitMs, 30000);
  }
  const state = initAccountState(accountId);
  if (state.pausedUntil && Date.now() < state.pausedUntil) {
    delay = Math.max(state.pausedUntil - Date.now() + 200, delay);
  }
  return Math.max(delay, extraMs, 0);
}

async function runAccountWorker(accountId, workerId, generation) {
  while (accountTimers[accountId]?.generation === generation && !accountTimers[accountId].stop) {
    let extraDelay = 0;
    try {
      const result = await processNextEmailForAccount(accountId);
      extraDelay = Number(result?.workerDelayMs) || 0;

      if (result?.skippedBatch) continue;

      if (result?.skipped) {
        if (result.reason === 'paused') {
          await sleep(workerDelayForAccount(accountId, 200));
          continue;
        }
        if (result.reason === 'at_limit') {
          stopAccountSender(accountId);
          return;
        }
        if (result.reason === 'queue_empty') {
          const state = initAccountState(accountId);
          if ((state.inFlight || 0) > 0) {
            await sleep(150);
            continue;
          }
          stopAccountSender(accountId);
          if (store.getPendingCount() === 0) {
            try { store.updateCampaignStatuses(); } catch { /* ignore */ }
          }
          return;
        }
      }
    } catch (err) {
      console.error(`[${accountId}] worker ${workerId} error:`, err?.message || err);
      extraDelay = Math.max(extraDelay, 250);
    }

    if (accountTimers[accountId]?.generation !== generation || accountTimers[accountId]?.stop) return;

    const delay = workerDelayForAccount(accountId, extraDelay);
    lastSendDelayMs = delay;
    await sleep(delay);
  }
}

function scheduleAccountSender(accountId) {
  if (accountTimers[accountId]) return;

  const generation = Date.now();
  accountTimers[accountId] = { generation, stop: false };
  const acc = getAccount(accountId);
  const delay = Number.isFinite(acc?.sendDelayMs) ? acc.sendDelayMs : DEFAULT_SEND_DELAY_MS;
  console.log(`[${accountId}] Starting ${SEND_CONCURRENCY} Mail API worker(s), delay ${delay}ms`);
  for (let i = 0; i < SEND_CONCURRENCY; i++) {
    void runAccountWorker(accountId, i, generation).catch((err) => {
      console.error(`[${accountId}] worker ${i} crashed:`, err?.message || err);
    });
  }
}

function stopAccountSender(accountId) {
  const handle = accountTimers[accountId];
  if (handle) {
    handle.stop = true;
    delete accountTimers[accountId];
  }
}

function startAccountSender(accountId) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('Account not found');

  clearAccountPause(accountId);
  const state = initAccountState(accountId);
  state.blockedUntil = null;
  state.pauseReason = null;
  state.consecutiveRateLimits = 0;
  state.inFlight = 0;
  state.isSending = false;
  const released = store.releaseSendingItems(accountId);
  if (released > 0) {
    console.log(`[${accountId}] Reclaimed ${released} in-flight queue item(s)`);
  }
  if (senderState.lastError?.accountId === accountId) {
    senderState.lastError = null;
  }

  let pending = store.getPendingCount(accountId);
  if (pending === 0) {
    const lists = getAccounts()
      .filter(a => a.id === accountId)
      .flatMap(() => {
        // Restore transient failures for lists this account has campaigned
        const camps = store.getCampaigns().filter(c => (c.smtp_account_id || 'account1') === accountId);
        return [...new Set(camps.map(c => c.list_id).filter(Boolean))];
      });
    const restored = store.restoreTransientBlockedContacts(lists);
    if (restored > 0) {
      console.log(`[${accountId}] Restored ${restored.toLocaleString()} contacts blocked by temporary SMTP/network errors`);
    }
    const requeued = store.requeueFailedActiveForAccount(accountId, { includeLookupFailures: true });
    if (requeued > 0) {
      pending = store.getPendingCount(accountId);
      console.log(`[${accountId}] Force start — requeued ${requeued.toLocaleString()} failed/skipped contact(s)`);
    }
    // Also queue any remaining eligible contacts into this account's campaigns
    for (const camp of store.getCampaigns().filter(c => (c.smtp_account_id || 'account1') === accountId)) {
      const ids = store.getEligibleContactIds(camp.list_id || 'list1', {
        skipAlreadySent: true,
        emailAllowlist: isWarmupSeedOnly(accountId) ? getWarmupSeedEmails() : null,
      });
      if (ids.length === 0) continue;
      const queued = store.queueCampaign(camp.id, ids);
      if (queued > 0) {
        store.setCampaignStatus(camp.id, 'sending');
        console.log(`[${accountId}] Queued ${queued.toLocaleString()} remaining contacts for campaign #${camp.id}`);
      }
    }
    pending = store.getPendingCount(accountId);
  }
  if (pending > 0 && accountCanSend(accountId)) {
    scheduleAccountSender(accountId);
    store.resumeSendingCampaigns();
    store.setMeta({ userStoppedSender: false });
    console.log(`[${accountId}] Sender started (${pending.toLocaleString()} pending)`);
    return { started: true, pending };
  }

  if (pending === 0) {
    console.log(`[${accountId}] No pending emails in queue`);
  } else {
    console.log(`[${accountId}] Cannot start — daily limit reached`);
  }
  return { started: false, pending };
}

function stopAccountSenderById(accountId, userInitiated = true) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('Account not found');
  stopAccountSender(accountId);
  if (userInitiated) {
    console.log(`[${accountId}] Sender stopped by user`);
  }
  return { stopped: true };
}

function startSender() {
  const accounts = getAccounts();
  let started = false;

  const dupesSkipped = store.purgeDuplicatePendingQueue();
  if (dupesSkipped > 0) {
    console.log(`Skipped ${dupesSkipped.toLocaleString()} duplicate queue item(s) — already emailed`);
  }

  const released = store.releaseSendingItems();
  if (released > 0) {
    console.log(`Reclaimed ${released.toLocaleString()} in-flight queue item(s) after restart`);
  }

  for (const acc of accounts) {
    clearAccountPause(acc.id);
    const state = initAccountState(acc.id);
    state.blockedUntil = null;
    state.pauseReason = null;
    state.consecutiveRateLimits = 0;
    if (!accountTimers[acc.id]) {
      state.inFlight = 0;
      state.isSending = false;
    }

    const deferred = store.deferBlockedQueueItems(acc.id);
    if (deferred > 0) {
      console.log(`[${acc.id}] Deferred ${deferred} stuck queue item(s) until tomorrow`);
    }
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
  resetAccountsCache();
  for (const acc of getAccounts()) {
    const state = initAccountState(acc.id);
    state.dailyQuotaHit = false;
    state.quotaHitDate = null;
    state.blockedUntil = null;
    state.pausedUntil = null;
    state.pauseReason = null;
    state.consecutiveRateLimits = 0;
    state.isSending = false;
    state.inFlight = 0;
    store.setAccountQuotaState(acc.id, { dailyQuotaHit: false, quotaHitDate: null });
  }
  store.setMeta({ userStoppedSender: false, lastDailyLimitAt: null, accountQuotas: {} });
}

function getAccountStatuses() {
  return getAccounts().map(acc => {
    const state = initAccountState(acc.id);
    const todaySent = store.getTodaySentCount(acc.id);
    const remaining = Math.max(0, acc.dailyLimit - todaySent);
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
      isSending: (state.inFlight || 0) > 0 || !!state.isSending,
      paused,
      pauseReason: paused ? state.pauseReason : null,
      pausedUntil: paused && state.pausedUntil ? new Date(state.pausedUntil).toISOString() : null,
      pendingQueue: store.getPendingCount(acc.id),
      lastError: senderState.lastError?.accountId === acc.id ? senderState.lastError : null,
      warmup: getWarmupPlan(acc.id) || acc.warmup || null,
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

function createCustomTransporter(cfg) {
  return nodemailer.createTransport(smtpTransportOptions({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.email || cfg.user,
    pass: cfg.pass,
  }));
}

async function verifyCustomSmtp(cfg) {
  if (hostingerMailApi.isConfigured('account1') && String(cfg.host || '').includes('hostinger')) {
    try {
      await hostingerMailApi.verifyMailApi('account1');
      return { ok: true, via: 'hostinger-mail-api' };
    } catch (err) {
      console.warn(`Hostinger Mail API custom verify failed, trying SMTP: ${err.message}`);
    }
  }
  const t = createCustomTransporter(cfg);
  try {
    await t.verify();
    return { ok: true, via: 'smtp' };
  } catch (err) {
    if ((cfg.host || '').includes('hostinger') && isTimeoutError(err) && parseInt(cfg.port, 10) === 465) {
      const fallback = createCustomTransporter({ ...cfg, port: 587, secure: false });
      await fallback.verify();
      return { ok: true, via: 'smtp' };
    }
    throw err;
  }
}

async function sendTestWithCustomConfig(cfg, testTo) {
  const t = createCustomTransporter(cfg);
  const fromName = cfg.fromName || cfg.email?.split('@')[0] || 'Test';
  const fromEmail = cfg.email || cfg.user;
  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: testTo,
    subject: 'Reachly — SMTP connection test',
    text: `This is a test email from Reachly.\n\nAccount: ${fromEmail}\nHost: ${cfg.host}:${cfg.port || 587}\n\nIf you received this, your SMTP configuration is working.`,
    html: `<p>This is a test email from <strong>Reachly</strong>.</p><p>Account: ${fromEmail}<br>Host: ${cfg.host}:${cfg.port || 587}</p><p>If you received this, your SMTP configuration is working.</p>`,
  };
  await t.sendMail(mailOptions);
  return { sentTo: testTo };
}

module.exports = {
  getSmtpConfig,
  verifySmtp,
  verifyCustomSmtp,
  sendTestWithCustomConfig,
  resetTransporter,
  startSender,
  startAccountSender,
  stopSender,
  stopAccountSenderById,
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
