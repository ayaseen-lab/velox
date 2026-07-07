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
}) {
  if (!email || !pass) return null;
  return {
    id,
    listId,
    label,
    listLabel,
    host: HOST,
    port: PORT,
    secure: SECURE,
    email: email.trim(),
    pass: pass.replace(/\s/g, ''),
    from: email.trim(),
    fromName: fromName || email.split('@')[0],
    dailyLimit,
    sendDelayMs,
    protected: !!isProtected,
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
    fromName: process.env.SMTP_ACCOUNT_1_FROM_NAME || process.env.SMTP_FROM_NAME || 'Ahmad Yaseen',
    dailyLimit: parseInt(process.env.SMTP_ACCOUNT_1_DAILY_LIMIT || process.env.DAILY_LIMIT || '490', 10),
    sendDelayMs: parseInt(process.env.SMTP_ACCOUNT_1_DELAY_MS || process.env.SEND_DELAY_MS || '5000', 10),
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

  return accounts;
}

let cachedAccounts = null;

function getAccounts() {
  if (!cachedAccounts) cachedAccounts = loadAccounts();
  return cachedAccounts;
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
}

module.exports = {
  getAccounts,
  getAccount,
  getAccountByList,
  getDefaultAccount,
  resetAccountsCache,
};
