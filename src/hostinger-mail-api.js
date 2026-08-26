const fs = require('fs');
const store = require('./store');
const { getAccount } = require('./accounts');

const BASE = process.env.HOSTINGER_MAIL_API_URL || 'https://api.mail.hostinger.com';
const mailboxIdCache = {};
const MAIL_API_TIMEOUT_MS = parseInt(process.env.MAIL_API_TIMEOUT_MS || '20000', 10);

function mailApiError(message, { status, retryable = true, code } = {}) {
  const err = new Error(message);
  err.status = status;
  err.responseCode = status;
  err.retryable = retryable;
  if (code) err.code = code;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function tokenFromEnv(accountId) {
  const num = String(accountId || '').replace('account', '');
  return (
    (num && process.env[`SMTP_ACCOUNT_${num}_MAIL_API_TOKEN`])
    || process.env.HOSTINGER_MAIL_API_TOKEN
    || ''
  ).trim();
}

function getMailApiToken(accountId) {
  return tokenFromEnv(accountId) || String(store.getMeta().hostingerMailApiToken || '').trim();
}

function getStoredMailboxId(accountId) {
  const num = String(accountId || '').replace('account', '');
  const fromEnv = (
    (num && process.env[`SMTP_ACCOUNT_${num}_MAIL_API_MAILBOX_ID`])
    || process.env.HOSTINGER_MAIL_API_MAILBOX_ID
    || ''
  ).trim();
  if (fromEnv) return fromEnv;
  const meta = store.getMeta();
  const map = meta.hostingerMailApiMailboxIds || {};
  return map[accountId] || meta.hostingerMailApiMailboxId || '';
}

function isConfigured(accountId) {
  return !!getMailApiToken(accountId);
}

function saveMailApiSettings({ token, mailboxId, accountId } = {}) {
  const fields = {};
  if (token != null) fields.hostingerMailApiToken = String(token).trim();
  if (mailboxId && accountId) {
    const map = { ...(store.getMeta().hostingerMailApiMailboxIds || {}) };
    map[accountId] = String(mailboxId).trim();
    fields.hostingerMailApiMailboxIds = map;
  } else if (mailboxId) {
    fields.hostingerMailApiMailboxId = String(mailboxId).trim();
  }
  if (Object.keys(fields).length) store.setMeta(fields);
  Object.keys(mailboxIdCache).forEach((k) => delete mailboxIdCache[k]);
  return { configured: isConfigured(accountId || 'account1') };
}

async function mailApiFetch(path, { token, method = 'GET', body, timeoutMs = MAIL_API_TIMEOUT_MS } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw mailApiError(`Hostinger Mail API timed out after ${timeoutMs / 1000}s`, {
        status: 408,
        code: 'ETIMEDOUT',
        retryable: true,
      });
    }
    throw mailApiError(`Hostinger Mail API request failed: ${err.message}`, {
      code: err.code || 'ECONNRESET',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: res.status, ok: res.ok || res.status === 204, text, json };
}

async function getCurrentAccount(token) {
  const result = await mailApiFetch('/api/v1/me', { token });
  if (!result.ok) {
    const msg = result.json?.error || result.text.slice(0, 180) || `HTTP ${result.status}`;
    throw mailApiError(`Hostinger Mail API auth failed: ${msg}`, {
      status: result.status,
      retryable: result.status >= 500 || result.status === 429,
    });
  }
  return result.json?.data || result.json || {};
}

async function resolveMailboxId(accountId) {
  const cached = mailboxIdCache[accountId];
  if (cached) return cached;
  const stored = getStoredMailboxId(accountId);
  const token = getMailApiToken(accountId);
  if (!token) throw new Error('Hostinger Mail API token is not set');

  const acc = getAccount(accountId);
  const email = (acc?.email || '').toLowerCase();
  const me = await getCurrentAccount(token);
  const boxes = Array.isArray(me.mailboxes) ? me.mailboxes : [];
  const match = boxes.find((b) => String(b.address || '').toLowerCase() === email)
    || (stored && boxes.find((b) => b.resourceId === stored))
    || boxes[0];
  if (!match?.resourceId) {
    throw new Error('Hostinger Mail API token has no mailboxes. Recreate it in hPanel ? Agentic Mail ? API access.');
  }
  if (email && String(match.address || '').toLowerCase() !== email && boxes.length > 1) {
    throw new Error(`Hostinger Mail API token does not include ${email}`);
  }
  mailboxIdCache[accountId] = match.resourceId;
  return match.resourceId;
}

async function verifyMailApi(accountId) {
  const token = getMailApiToken(accountId);
  if (!token) throw new Error('Hostinger Mail API token is not set');
  const mailboxId = await resolveMailboxId(accountId);
  const acc = getAccount(accountId);
  return {
    ok: true,
    via: 'hostinger-mail-api',
    mailboxId,
    email: acc?.email || null,
  };
}

function extractEmail(addr) {
  if (!addr) return '';
  const s = String(addr);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

function toAddressList(value) {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const emails = list.map(extractEmail).filter(Boolean);
  return emails.length ? emails : undefined;
}

function buildAttachments(mailOptions) {
  const items = mailOptions.attachments || [];
  if (!items.length) return undefined;
  return items.map((att) => {
    let content = att.content;
    if (!content && att.path && fs.existsSync(att.path)) {
      content = fs.readFileSync(att.path).toString('base64');
    } else if (Buffer.isBuffer(content)) {
      content = content.toString('base64');
    }
    return {
      filename: att.filename || 'attachment',
      content,
      contentType: att.contentType || undefined,
      encoding: 'base64',
    };
  }).filter((a) => a.content);
}

async function sendViaMailApi(accountId, mailOptions) {
  const token = getMailApiToken(accountId);
  if (!token) throw new Error('Hostinger Mail API token is not set');
  const mailboxId = await resolveMailboxId(accountId);
  const acc = getAccount(accountId);
  const to = toAddressList(mailOptions.to);
  if (!to) throw new Error('Hostinger Mail API send requires a To address');

  const body = {
    to,
    cc: toAddressList(mailOptions.cc),
    bcc: toAddressList(mailOptions.bcc),
    subject: mailOptions.subject || '',
    text: mailOptions.text || undefined,
    html: mailOptions.html || undefined,
    displayName: acc?.fromName || undefined,
    attachments: buildAttachments(mailOptions),
  };
  Object.keys(body).forEach((k) => {
    if (body[k] === undefined) delete body[k];
  });

  const result = await mailApiFetch(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/send`, {
    token,
    method: 'POST',
    body,
  });
  if (result.status === 204 || result.ok) {
    return { savedToSent: true, via: 'hostinger-mail-api', mailboxId };
  }
  const msg = result.json?.error || result.text.slice(0, 220) || `HTTP ${result.status}`;
  const retryable = result.status === 429 || result.status === 408 || result.status >= 500;
  throw mailApiError(`Hostinger Mail API send failed: ${msg}`, {
    status: result.status,
    code: result.status === 429 ? 'RATE_LIMIT' : undefined,
    retryable,
  });
}

async function sendViaMailApiWithRetry(accountId, mailOptions, { attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await sendViaMailApi(accountId, mailOptions);
    } catch (err) {
      lastErr = err;
      const retryable = err.retryable !== false && (err.status === 429 || err.status >= 500 || err.status === 408 || err.code === 'ETIMEDOUT' || err.code === 'RATE_LIMIT');
      if (!retryable || i === attempts - 1) throw err;
      const wait = err.status === 429 ? 1500 * (i + 1) : 350 * (i + 1);
      console.warn(`[${accountId}] Mail API retry ${i + 1}/${attempts}: ${err.message}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function diagnoseMailApi(accountId = 'account1') {
  const token = getMailApiToken(accountId);
  if (!token) {
    return { configured: false, message: 'HOSTINGER_MAIL_API_TOKEN is not set' };
  }
  try {
    const me = await getCurrentAccount(token);
    const boxes = (me.mailboxes || []).map((b) => ({
      resourceId: b.resourceId,
      address: b.address,
    }));
    return {
      configured: true,
      ok: true,
      mailboxCount: boxes.length,
      mailboxes: boxes,
      orderResourceId: me.orderResourceId || null,
    };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

module.exports = {
  isConfigured,
  getMailApiToken,
  saveMailApiSettings,
  verifyMailApi,
  sendViaMailApi,
  sendViaMailApiWithRetry,
  diagnoseMailApi,
};
