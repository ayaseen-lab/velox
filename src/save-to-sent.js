const { ImapFlow } = require('imapflow');
const MailComposer = require('nodemailer/lib/mail-composer');
const { getAccount } = require('./accounts');

const SENT_CANDIDATES = [
  'INBOX.Sent',
  'INBOX.Sent Mail',
  'Sent',
  '[Gmail]/Sent Mail',
  'Sent Items',
  'Sent Messages',
];

const IMAP_TIMEOUT_MS = parseInt(process.env.IMAP_TIMEOUT_MS || '8000', 10);
const mailboxQueues = new Map();

function inferImapHost(smtpHost = '') {
  const h = smtpHost.toLowerCase();
  if (h.includes('gmail')) return 'imap.gmail.com';
  if (h.includes('titan')) return 'imap.titan.email';
  if (h.includes('hostinger')) return 'imap.hostinger.com';
  if (h.includes('outlook') || h.includes('office365')) return 'outlook.office365.com';
  if (h.includes('yahoo') || h.includes('titan')) return 'imap.mail.yahoo.com';
  return null;
}

function getImapConfig(accountId) {
  const acc = getAccount(accountId);
  if (!acc?.email || !acc?.pass) return null;

  const num = (accountId || '').replace('account', '');
  const perAccountFlag = num ? process.env[`SMTP_ACCOUNT_${num}_SAVE_TO_SENT`] : null;
  const globalOff = process.env.SAVE_TO_SENT === 'false';
  const enabled = perAccountFlag === 'false' ? false : (perAccountFlag === 'true' || !globalOff);
  if (!enabled) return null;

  const host = (num && process.env[`SMTP_ACCOUNT_${num}_IMAP_HOST`])
    || process.env.IMAP_HOST
    || inferImapHost(acc.host);
  if (!host) return null;

  const port = parseInt(
    (num && process.env[`SMTP_ACCOUNT_${num}_IMAP_PORT`]) || process.env.IMAP_PORT || '993',
    10,
  );

  return {
    host,
    port,
    secure: true,
    auth: { user: acc.email, pass: acc.pass },
  };
}

function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(mailOptions);
    composer.compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

async function resolveSentFolder(client) {
  const mailboxes = await client.list();
  const special = mailboxes.find((m) => m.specialUse === '\\Sent' || (m.specialUseFlags || []).includes('\\Sent'));
  if (special?.path) return special.path;
  const paths = mailboxes.map((m) => m.path);
  for (const name of SENT_CANDIDATES) {
    if (paths.includes(name)) return name;
  }
  const match = mailboxes.find((m) => /\bsent\b/i.test(m.path) && !/draft|trash|junk|deleted/i.test(m.path));
  if (match) return match.path;
  throw new Error('Sent folder not found on mailbox');
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function attachSafeErrorHandler(client) {
  const swallow = (err) => {
    if (err) console.warn(`IMAP connection error (non-fatal): ${err.message || err}`);
  };
  client.on('error', swallow);
  client.on('close', () => {});
}

async function destroyClient(client) {
  if (!client) return;
  try { client.logout().catch(() => {}); } catch { /* ignore */ }
  try { await client.close(); } catch { /* ignore */ }
  try { client.socket?.destroy?.(); } catch { /* ignore */ }
}

function runSerialized(mailboxKey, fn) {
  const prev = mailboxQueues.get(mailboxKey) || Promise.resolve();
  const job = prev.catch(() => {}).then(fn);
  mailboxQueues.set(mailboxKey, job.finally(() => {
    if (mailboxQueues.get(mailboxKey) === job) mailboxQueues.delete(mailboxKey);
  }));
  return job;
}

async function saveCopyToSentInner(accountId, mailOptions, imapConfig) {
  let client;
  try {
    const raw = await buildRawMessage(mailOptions);
    client = new ImapFlow({
      host: imapConfig.host,
      port: imapConfig.port,
      secure: imapConfig.secure,
      auth: imapConfig.auth,
      logger: false,
      emitLogs: false,
      disableAutoIdle: true,
      socketTimeout: IMAP_TIMEOUT_MS,
      greetingTimeout: Math.min(IMAP_TIMEOUT_MS, 8000),
      tls: { rejectUnauthorized: true },
    });
    attachSafeErrorHandler(client);

    await withTimeout((async () => {
      await client.connect();
      const sentFolder = await resolveSentFolder(client);
      await client.append(sentFolder, raw, ['\\Seen'], new Date());
      console.log(`[${accountId}] Saved copy to ${sentFolder}`);
    })(), IMAP_TIMEOUT_MS, 'IMAP save to Sent');

    return true;
  } catch (err) {
    console.warn(`[${accountId}] Could not save copy to Sent folder: ${err.message}`);
    return false;
  } finally {
    await destroyClient(client);
  }
}

async function saveCopyToSent(accountId, mailOptions) {
  try {
    const imapConfig = getImapConfig(accountId);
    if (!imapConfig) return false;
    const mailboxKey = imapConfig.auth.user.toLowerCase();
    return await runSerialized(mailboxKey, () => saveCopyToSentInner(accountId, mailOptions, imapConfig));
  } catch (err) {
    console.warn(`[${accountId}] Could not save copy to Sent folder: ${err.message}`);
    return false;
  }
}

module.exports = {
  saveCopyToSent,
  getImapConfig,
};
