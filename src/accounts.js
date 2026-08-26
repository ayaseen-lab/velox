const store = require('./store');
const { getWarmupPlan } = require('./warmup');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SECURE = process.env.SMTP_SECURE === 'true';

function buildAccount({
  id,
  listId,
  label,
  listLabel,
  email,
  pass,
  fromName,
  dailyLimit,
  sendDelayMs,
  protected: isProtected,
  host,
  port,
  secure,
}) {
  if (!email || !pass) return null;
  return {
    id,
    listId,
    label,
    listLabel,
    host: host || HOST,
    port: port != null ? port : PORT,
    secure: secure != null ? secure : SECURE,
    email: email.trim(),
    pass: pass.replace(/\s/g, ''),
    from: email.trim(),
    fromName: fromName || email.split('@')[0],
    dailyLimit,
    sendDelayMs,
    protected: !!isProtected,
    warmup: null,
  };
}

function loadAccounts() {
  const accounts = [];

  const account1 = buildAccount({
    id: 'account1',
    listId: 'list1',
    label: 'Email 1 — Primary',
    listLabel: 'Data List 1',
    email: process.env.SMTP_ACCOUNT_1_USER || process.env.SMTP_USER,
    pass: process.env.SMTP_ACCOUNT_1_PASS || process.env.SMTP_PASS,
    fromName: process.env.SMTP_ACCOUNT_1_FROM_NAME || process.env.SMTP_FROM_NAME || 'Marcus Hale',
    host: process.env.SMTP_ACCOUNT_1_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_ACCOUNT_1_PORT || process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_ACCOUNT_1_SECURE || process.env.SMTP_SECURE) === 'true',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_1_DAILY_LIMIT || process.env.DAILY_LIMIT || '5000', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_1_DELAY_MS || process.env.SEND_DELAY_MS || '1000', 10),
    protected: false,
  });
  if (account1) accounts.push(account1);

  const account2 = buildAccount({
    id: 'account2',
    listId: 'list2',
    label: 'Email 2 — Protected',
    listLabel: 'Data List 2 (10k)',
    email: process.env.SMTP_ACCOUNT_2_USER,
    pass: process.env.SMTP_ACCOUNT_2_PASS,
    fromName: process.env.SMTP_ACCOUNT_2_FROM_NAME || 'Ahmad Yaseen',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_2_DAILY_LIMIT || '490', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_2_DELAY_MS || '8000', 10),
    protected: true,
  });
  if (account2) accounts.push(account2);

  const account3 = buildAccount({
    id: 'account3',
    listId: 'list3',
    label: 'Email 3 — Hostinger',
    listLabel: 'Data List 3',
    email: process.env.SMTP_ACCOUNT_3_USER,
    pass: process.env.SMTP_ACCOUNT_3_PASS,
    fromName: process.env.SMTP_ACCOUNT_3_FROM_NAME,
    host: process.env.SMTP_ACCOUNT_3_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_ACCOUNT_3_PORT || '465', 10),
    secure: process.env.SMTP_ACCOUNT_3_SECURE !== 'false',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_3_DAILY_LIMIT || '490', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_3_DELAY_MS || '10000', 10),
    protected: false,
  });
  if (account3) accounts.push(account3);

  // account4 removed — same mailbox as account6 (ahmad@xynovix.com); list4 unused

  const account5 = buildAccount({
    id: 'account5',
    listId: 'list5',
    label: 'Email 5 — Hostinger (Outreach)',
    listLabel: 'Data List 5',
    email: process.env.SMTP_ACCOUNT_5_USER,
    pass: process.env.SMTP_ACCOUNT_5_PASS,
    fromName: process.env.SMTP_ACCOUNT_5_FROM_NAME,
    host: process.env.SMTP_ACCOUNT_5_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_ACCOUNT_5_PORT || '465', 10),
    secure: process.env.SMTP_ACCOUNT_5_SECURE !== 'false',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_5_DAILY_LIMIT || '490', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_5_DELAY_MS || '10000', 10),
    protected: false,
  });
  if (account5) accounts.push(account5);

  const account6 = buildAccount({
    id: 'account6',
    listId: 'list5',
    label: 'Email 6 — Hostinger (Ahmad)',
    listLabel: 'Data List 5 + 6',
    email: process.env.SMTP_ACCOUNT_6_USER || process.env.SMTP_ACCOUNT_4_USER,
    pass: process.env.SMTP_ACCOUNT_6_PASS || process.env.SMTP_ACCOUNT_4_PASS,
    fromName: process.env.SMTP_ACCOUNT_6_FROM_NAME || process.env.SMTP_ACCOUNT_4_FROM_NAME || 'Ahmad',
    host: process.env.SMTP_ACCOUNT_6_HOST || process.env.SMTP_ACCOUNT_4_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_ACCOUNT_6_PORT || process.env.SMTP_ACCOUNT_4_PORT || '465', 10),
    secure: (process.env.SMTP_ACCOUNT_6_SECURE || process.env.SMTP_ACCOUNT_4_SECURE) !== 'false',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_6_DAILY_LIMIT || '3000', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_6_DELAY_MS || '500', 10),
    protected: false,
  });
  if (account6) accounts.push(account6);

  const overrides = store.getAccountDailyLimits();
  const delayOverrides = store.getAccountSendDelays();
  for (const acc of accounts) {
    const warmup = getWarmupPlan(acc.id);
    if (warmup) {
      acc.warmup = warmup;
      acc.dailyLimit = Math.min(acc.dailyLimit, warmup.dailyLimit);
      acc.sendDelayMs = Math.max(acc.sendDelayMs, warmup.delayMs);
      acc.protected = true;
    }
    const override = overrides[acc.id];
    if (Number.isFinite(override) && override > 0) {
      acc.dailyLimit = override;
    }
    const delayOverride = delayOverrides[acc.id];
    if (Number.isFinite(delayOverride) && delayOverride >= 0) {
      acc.sendDelayMs = delayOverride;
    }
  }

  return accounts;
}

let cachedAccounts = null;
let cachedAccountsDate = null;

function getAccounts() {
  const today = new Date().toLocaleDateString('en-CA');
  if (!cachedAccounts || cachedAccountsDate !== today) {
    cachedAccounts = loadAccounts();
    cachedAccountsDate = today;
  }
  return cachedAccounts;
}

function updateAccountDailyLimit(accountId, dailyLimit) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('Account not found');
  const limit = store.setAccountDailyLimit(accountId, dailyLimit);
  resetAccountsCache();
  return { ...getAccount(accountId), dailyLimit: limit };
}

function updateAccountSendDelay(accountId, sendDelayMs) {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('Account not found');
  const delay = store.setAccountSendDelay(accountId, sendDelayMs);
  resetAccountsCache();
  return { ...getAccount(accountId), sendDelayMs: delay };
}

function getAccount(id) {
  return getAccounts().find(a => a.id === id) || null;
}

function getAccountByList(listId) {
  return getAccounts().find(a => a.listId === listId) || null;
}

function getDefaultAccount() {
  return getAccounts()[0] || null;
}

function resetAccountsCache() {
  cachedAccounts = null;
  cachedAccountsDate = null;
}

module.exports = {
  getAccounts,
  getAccount,
  getAccountByList,
  getDefaultAccount,
  resetAccountsCache,
  updateAccountDailyLimit,
  updateAccountSendDelay,
};
