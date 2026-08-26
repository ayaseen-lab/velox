require('dotenv').config();

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

process.on('unhandledRejection', (err) => {
  console.warn('Unhandled promise rejection (non-fatal):', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.warn('Uncaught exception (non-fatal):', err?.message || err);
});
const express = require('express');
const multer = require('multer');
const { parseContactsCsv, parseContactsXlsx } = require('./src/import-contacts');
const { getTemplate, listTemplates } = require('./src/campaign-templates');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const { uploadsDir, attachmentsDir, isServerless } = require('./src/paths');
const store = require('./src/store');
const { getAccounts, getAccount, getAccountByList, updateAccountDailyLimit } = require('./src/accounts');
const { validateCampaign, htmlToPlain } = require('./src/email-utils');
const {
  getSmtpConfig,
  verifySmtp,
  resetTransporter,
  startSender,
  stopSender,
  startAccountSender,
  stopAccountSenderById,
  getSenderStatus,
  getAccountStatuses,
  queueCampaign,
  resetDailyState,
  sendTestEmail,
  renderPreview,
  verifyCustomSmtp,
  sendTestWithCustomConfig,
  DAILY_LIMIT,
} = require('./src/mailer');
const { getProviders, getProvider } = require('./src/email-providers');
const { getLeadProviders, searchLeads } = require('./src/lead-providers');
const { getDataVariables } = require('./src/variables');
const { requireAuth, isAuthenticated, setAuthCookie, clearAuthCookie, verifyPassword } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const upload = multer({ dest: uploadsDir, limits: { fileSize: 50 * 1024 * 1024 } });
const attachmentUpload = multer({ dest: attachmentsDir, limits: { fileSize: 25 * 1024 * 1024 } });

function toHtmlBody(body) {
  if (!body) return '';
  if (/<[a-z][\s\S]*>/i.test(body)) return body;
  return body.split('\n').filter(Boolean).map(line =>
    `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
  ).join('');
}

app.use(express.json({ limit: '5mb' }));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'login.html'));
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  setAuthCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

app.use(requireAuth);

app.post('/api/campaigns/validate', (req, res) => {
  const { subject, body, preheader } = req.body;
  const result = validateCampaign({ subject, bodyHtml: body || '', preheader: preheader || '' });
  res.json(result);
});

app.post('/api/campaigns/preview', (req, res) => {
  const { subject, body, preheader, include_unsubscribe, smtp_account_id, sample_contact } = req.body;
  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required' });
  }
  const accountId = smtp_account_id || getAccounts()[0]?.id || 'account1';
  const preview = renderPreview({
    subject: subject.trim(),
    body_html: toHtmlBody(body),
    body_text: htmlToPlain(toHtmlBody(body)),
    preheader: (preheader || '').trim(),
    include_unsubscribe: include_unsubscribe === true,
  }, sample_contact, accountId);
  res.json(preview);
});

app.get('/api/accounts', (req, res) => {
  const accounts = getAccountStatuses();
  const lists = store.getAllListCounts();
  res.json({ accounts, lists });
});

app.patch('/api/accounts/:id/daily-limit', (req, res) => {
  try {
    const updated = updateAccountDailyLimit(req.params.id, req.body?.dailyLimit);
    const status = getAccountStatuses().find(a => a.id === updated.id);
    res.json({ success: true, account: status || updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({
    sender: getSenderStatus(),
    accounts: getAccountStatuses(),
    lists: store.getAllListCounts(),
    contacts: store.getContactCounts(),
    campaigns: store.getCampaignStatusCounts(),
    recentLogs: store.getRecentLogs(20),
    last7Days: store.getLast7Days(),
    dailyLimit: DAILY_LIMIT,
    progress: store.getQueueProgress(),
    analytics: store.getAnalytics(),
  });
});

app.get('/api/smtp', (req, res) => {
  const accountId = req.query.account || getAccounts()[0]?.id;
  const cfg = getSmtpConfig(accountId);
  res.json({
    accountId,
    host: cfg.host || '',
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user || '',
    from: cfg.from || '',
    fromName: cfg.fromName || '',
    dailyLimit: cfg.dailyLimit,
    protected: cfg.protected,
    configured: !!(cfg.user && cfg.pass),
  });
});

app.post('/api/smtp/test', async (req, res) => {
  const accountId = req.body?.account || req.query?.account || getAccounts()[0]?.id;
  try {
    resetTransporter(accountId);
    await verifySmtp(accountId);
    const acc = getAccount(accountId);
    res.json({ success: true, message: `SMTP verified for ${acc?.email || accountId}` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/contacts', (req, res) => {
  const { search, page = 1, limit = 10000, list_id } = req.query;
  res.json(store.getContacts({
    search,
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 10000,
    list_id: list_id || undefined,
  }));
});

app.post('/api/contacts', (req, res) => {
  const { email, name, first_name, last_name, company, title, website, linkedin, list_id } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const listId = list_id || 'list1';

  try {
    const contact = store.addContact(email, { name, first_name, last_name, company, title, website, linkedin }, listId);
    res.json(contact);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already exists in this list' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const listId = req.body.list_id || 'list1';

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows;

    if (ext === '.xlsx' || ext === '.xls') {
      const buffer = fs.readFileSync(req.file.path);
      rows = parseContactsXlsx(buffer);
    } else {
      const content = fs.readFileSync(req.file.path, 'utf-8');
      rows = parseContactsCsv(content);
    }

    fs.unlinkSync(req.file.path);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found in file' });
    }

    const result = store.addContactsBulk(rows, listId);
    const acc = getAccountByList(listId);
    res.json({
      ...result,
      total: rows.length,
      listId,
      listLabel: acc?.listLabel || listId,
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ error: 'Failed to parse file: ' + err.message });
  }
});

app.delete('/api/contacts/:id', (req, res) => {
  store.deleteContact(parseInt(req.params.id));
  res.json({ success: true });
});

app.delete('/api/contacts', (req, res) => {
  const listId = req.query.list_id || null;
  store.deleteAllContacts(listId);
  res.json({ success: true, list_id: listId });
});

app.get('/api/campaigns/templates', (req, res) => {
  res.json(listTemplates());
});

app.get('/api/campaigns/templates/:id', (req, res) => {
  const template = getTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

app.post('/api/campaigns/test-email', attachmentUpload.single('attachment'), async (req, res) => {
  const { subject, body, preheader, include_unsubscribe, smtp_account_id, sample_contact, test_to } = req.body;
  const bodyContent = (body || '').trim();
  const accountId = smtp_account_id || 'account2';

  if (!subject || !bodyContent) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Subject and body are required' });
  }

  const cfg = getSmtpConfig(accountId);
  if (!cfg.user || !cfg.pass) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'SMTP not configured for selected account' });
  }

  let attachment = null;
  if (req.file) {
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(attachmentsDir, `test-${Date.now()}-${safeName}`);
    fs.renameSync(req.file.path, dest);
    attachment = { filename: req.file.originalname, path: dest };
  }

  const template = getTemplate('default');
  const testTo = (test_to || '').trim() || process.env.TEST_EMAIL || template.test_email || 'ahmadjutt463@gmail.com';

  let sample = template.sample_contact;
  if (sample_contact) {
    try {
      sample = typeof sample_contact === 'string' ? JSON.parse(sample_contact) : sample_contact;
    } catch {
      return res.status(400).json({ error: 'Invalid sample_contact JSON' });
    }
  }

  if (!sample.first_name || !sample.company || !sample.title) {
    return res.status(400).json({ error: 'Manual test requires first name, job title, and company' });
  }

  const first = sample.first_name;
  const last = sample.last_name || '';
  sample.name = sample.name || [first, last].filter(Boolean).join(' ');
  sample.email = sample.email || testTo;

  try {
    resetTransporter(accountId);
    await sendTestEmail({
      subject: subject.trim(),
      body_html: toHtmlBody(bodyContent),
      body_text: htmlToPlain(toHtmlBody(bodyContent)),
      preheader: (preheader || '').trim(),
      include_unsubscribe: include_unsubscribe === true,
      attachment,
    }, testTo, sample, accountId);

    res.json({
      success: true,
      message: `Test sent from ${cfg.from} to ${testTo} as ${first} at ${sample.company}`,
      sentTo: testTo,
      accountId,
      personalizedAs: `${first}, ${sample.title} at ${sample.company}`,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/campaigns', (req, res) => {
  res.json(store.getCampaigns());
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = store.getCampaign(parseInt(req.params.id));
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

app.post('/api/campaigns', attachmentUpload.single('attachment'), (req, res) => {
  const { name, subject, body, preheader, include_unsubscribe, smtp_account_id, list_id } = req.body;
  const bodyContent = (body || '').trim();
  const accountId = smtp_account_id || getAccounts()[0]?.id || 'account1';
  const acc = getAccount(accountId);
  const listId = list_id || acc?.listId || 'list1';

  if (!name || !subject || !bodyContent) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  const validation = validateCampaign({
    subject: subject.trim(),
    bodyHtml: bodyContent,
    preheader: (preheader || '').trim(),
  });
  if (!validation.valid) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: validation.errors.join('. '), validation });
  }

  let attachment = null;
  if (req.file) {
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(attachmentsDir, `${Date.now()}-${safeName}`);
    fs.renameSync(req.file.path, dest);
    attachment = { filename: req.file.originalname, path: dest };
  }

  const body_html = toHtmlBody(bodyContent);
  const campaign = store.createCampaign({
    name: name.trim(),
    subject: subject.trim(),
    body_html,
    body_text: htmlToPlain(body_html),
    preheader: (preheader || '').trim(),
    include_unsubscribe: include_unsubscribe === true,
    smtp_account_id: accountId,
    list_id: listId,
    attachment,
  });

  res.json({
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    smtp_account_id: accountId,
    list_id: listId,
    hasAttachment: !!attachment,
    validation,
  });
});

app.put('/api/campaigns/:id', attachmentUpload.single('attachment'), (req, res) => {
  const id = parseInt(req.params.id);
  const campaign = store.getCampaign(id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!['draft', 'paused'].includes(campaign.status)) {
    return res.status(400).json({ error: 'Pause the campaign before editing' });
  }

  const { name, subject, body, body_html, preheader, include_unsubscribe } = req.body;
  const bodyContent = (body || body_html || '').trim();

  if (subject && !bodyContent && !campaign.body_html) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Email body is required' });
  }

  let attachment = campaign.attachment || null;
  if (req.file) {
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = path.join(attachmentsDir, `${Date.now()}-${safeName}`);
    fs.renameSync(req.file.path, dest);
    attachment = { filename: req.file.originalname, path: dest };
  }

  const html = bodyContent ? toHtmlBody(bodyContent) : campaign.body_html;
  store.updateCampaign(id, {
    name: (name || campaign.name).trim(),
    subject: (subject || campaign.subject).trim(),
    body_html: html,
    body_text: htmlToPlain(html),
    preheader: preheader !== undefined ? String(preheader).trim() : campaign.preheader,
    include_unsubscribe: include_unsubscribe === true,
    attachment,
    updated_at: new Date().toISOString(),
  });

  res.json({
    success: true,
    id,
    message: campaign.status === 'paused'
      ? 'Campaign updated. Click Resume to continue sending with the new content.'
      : 'Campaign updated',
  });
});

app.post('/api/campaigns/:id/send', (req, res) => {
  const id = parseInt(req.params.id);
  const campaign = store.getCampaign(id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'draft') {
    return res.status(400).json({ error: 'Campaign already sent or in progress' });
  }

  const accountId = campaign.smtp_account_id || 'account1';
  const listId = campaign.list_id || 'list1';
  const acc = getAccount(accountId);
  const cfg = getSmtpConfig(accountId);

  if (!cfg.user || !cfg.pass) {
    return res.status(400).json({ error: 'SMTP not configured for selected account' });
  }

  const isFollowUp = campaign.campaign_type === 'follow_up';
  const contactIds = isFollowUp
    ? store.getSuccessfulContactIds(campaign.parent_campaign_id)
    : store.getEligibleContactIds(listId, { skipAlreadySent: true });

  if (contactIds.length === 0) {
    return res.status(400).json({
      error: isFollowUp
        ? 'No successful recipients found for follow-up'
        : 'No eligible contacts in selected list (all sent, bounced, or blocked)',
    });
  }

  const queued = queueCampaign(id, contactIds, { allowResend: isFollowUp });
  const remaining = store.getRemainingToday(acc.dailyLimit, accountId);
  const daysNeeded = Math.ceil(queued / acc.dailyLimit);
  startSender();

  const otherActive = store.getCampaigns().filter(c =>
    c.id !== id && ['sending', 'queued'].includes(c.status)
  ).length;

  let message;
  if (queued <= remaining) {
    message = otherActive > 0
      ? `Queued ${queued.toLocaleString()} emails via ${acc.email}. Sending in parallel with other active campaign(s).`
      : `Queued ${queued.toLocaleString()} emails via ${acc.email}. Sending now...`;
  } else {
    message = otherActive > 0
      ? `Queued ${queued.toLocaleString()} emails via ${acc.email}. Sending ${remaining} today in parallel with other campaign(s), ~${daysNeeded} days at ${acc.dailyLimit}/day on this account.`
      : `Queued ${queued.toLocaleString()} emails via ${acc.email}. Sending ${remaining} today, ~${daysNeeded} days at ${acc.dailyLimit}/day. Duplicates & bounced addresses skipped.`;
  }

  res.json({
    success: true,
    queued,
    remainingToday: remaining,
    daysNeeded,
    accountId,
    listId,
    message,
  });
});

app.post('/api/campaigns/:id/pause', (req, res) => {
  const id = parseInt(req.params.id);
  const campaign = store.getCampaign(id);
  if (campaign && ['sending', 'queued'].includes(campaign.status)) {
    store.setCampaignStatus(id, 'paused');
    res.json({ success: true, message: 'Campaign paused. You can edit it now, then resume.' });
  } else {
    res.json({ success: true, message: 'Campaign is not running' });
  }
});

app.post('/api/campaigns/:id/resume', (req, res) => {
  const id = parseInt(req.params.id);
  const campaign = store.getCampaign(id);
  if (campaign && campaign.status === 'paused') {
    store.setCampaignStatus(id, 'queued');
    startSender();
  }
  res.json({ success: true });
});

app.post('/api/campaigns/:id/follow-up', (req, res) => {
  const parentId = parseInt(req.params.id);
  const parent = store.getCampaign(parentId);
  if (!parent) return res.status(404).json({ error: 'Campaign not found' });

  const contactIds = store.getSuccessfulContactIds(parentId);
  if (contactIds.length === 0) {
    return res.status(400).json({
      error: 'No successful sends yet — wait until some emails are delivered, then create a follow-up.',
    });
  }

  const { subject, body, preheader, delay_days, send_now } = req.body || {};
  const followTpl = getTemplate('follow-up');
  const bodyContent = (body || followTpl.body_html).trim();
  const body_html = toHtmlBody(bodyContent);

  const campaign = store.createCampaign({
    name: `Follow-up: ${parent.name}`.slice(0, 120),
    subject: (subject || followTpl.subject).trim(),
    body_html,
    body_text: htmlToPlain(body_html),
    preheader: (preheader || '').trim(),
    include_unsubscribe: false,
    smtp_account_id: parent.smtp_account_id,
    list_id: parent.list_id,
    attachment: parent.attachment || null,
    parent_campaign_id: parentId,
    campaign_type: 'follow_up',
    delay_days: parseInt(delay_days, 10) || 0,
  });

  const shouldSend = send_now !== false;
  let queued = 0;
  if (shouldSend) {
    queued = queueCampaign(campaign.id, contactIds, { allowResend: true });
    startSender();
  }

  res.json({
    success: true,
    campaign,
    queued,
    recipients: contactIds.length,
    message: shouldSend
      ? `Follow-up campaign created and queued to ${queued.toLocaleString()} successful recipients from campaign #${parentId}.`
      : `Follow-up draft created for ${contactIds.length.toLocaleString()} successful recipients. Open Campaigns to send.`,
  });
});

app.get('/api/campaigns/:id/follow-up-preview', (req, res) => {
  const parentId = parseInt(req.params.id);
  const parent = store.getCampaign(parentId);
  if (!parent) return res.status(404).json({ error: 'Campaign not found' });
  const contactIds = store.getSuccessfulContactIds(parentId);
  const tpl = getTemplate('follow-up');
  res.json({
    parent: { id: parent.id, name: parent.name, sent_count: parent.sent_count, status: parent.status },
    eligible: contactIds.length,
    template: { subject: tpl.subject, body_html: tpl.body_html },
  });
});

app.get('/api/demo/data', (req, res) => {
  res.json({
    demoEmails: [
      { id: 'demo1', first_name: 'Ahmad', email: 'ahmad.yaseen@gmail.com', label: 'Ahmad — Gmail Primary', provider: 'gmail', fromName: 'Ahmad Yaseen' },
      { id: 'demo2', first_name: 'Ahmad', email: 'ahmad.randhawa@outlook.com', label: 'Ahmad — Outlook', provider: 'outlook', fromName: 'Ahmad Randhawa' },
      { id: 'demo3', first_name: 'Ahmad', email: 'ahmad.demo@yahoo.com', label: 'Ahmad — Yahoo Demo', provider: 'yahoo', fromName: 'Ahmad Demo' },
      { id: 'demo4', first_name: 'Ahmad', email: 'ahmad@customsmtp.demo', label: 'Ahmad — Custom SMTP', provider: 'custom', fromName: 'Ahmad Yaseen' },
    ],
    features: [
      'Multi-account SMTP (Gmail, Outlook, Yahoo, Custom)',
      'Follow-up campaigns to successful recipients',
      'Lead research with Apollo, FindyMail, Hunter, Snov, Lusha, Clearbit',
      'Variable builder with static + data tokens',
      'Parallel sending across accounts',
    ],
  });
});

app.post('/api/replies', (req, res) => {
  const { email, subject, snippet } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  store.markReply(email, subject, snippet);
  res.json({ success: true });
});

app.post('/api/bounces', (req, res) => {
  const { email, reason } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  store.markBounce(email, reason || 'Address not found / domain invalid');
  res.json({ success: true, message: `${email} marked as bounced and suppressed` });
});

app.get('/api/sender/status', (req, res) => {
  res.json(getSenderStatus());
});

app.post('/api/sender/start', (req, res) => {
  startSender();
  res.json(getSenderStatus());
});

app.post('/api/sender/stop', (req, res) => {
  stopSender();
  res.json(getSenderStatus());
});

app.post('/api/sender/accounts/:accountId/start', (req, res) => {
  try {
    startAccountSender(req.params.accountId);
    res.json(getSenderStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sender/accounts/:accountId/stop', (req, res) => {
  try {
    stopAccountSenderById(req.params.accountId);
    res.json(getSenderStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Email configuration ---

app.get('/api/email-providers', (req, res) => {
  res.json(getProviders());
});

app.get('/api/email-config/accounts', (req, res) => {
  const envAccounts = getAccounts().map(a => ({
    id: a.id,
    provider: a.email?.includes('gmail') ? 'gmail' : a.host?.includes('hostinger') ? 'hostinger' : 'custom',
    label: a.label,
    email: a.email,
    host: a.host,
    port: a.port,
    secure: a.secure,
    fromName: a.fromName,
    listId: a.listId,
    listLabel: a.listLabel,
    dailyLimit: a.dailyLimit,
    sendDelayMs: a.sendDelayMs,
    protected: a.protected,
    source: 'env',
    configured: true,
  }));
  const saved = store.getSavedSmtpAccounts();
  const demoAccounts = [
    {
      id: 'demo_gmail_ahmad',
      provider: 'gmail',
      label: 'Ahmad — Gmail Demo',
      email: 'ahmad.yaseen@gmail.com',
      fromName: 'Ahmad Yaseen',
      host: 'smtp.gmail.com',
      port: 587,
      dailyLimit: 490,
      source: 'demo',
      configured: true,
      first_name: 'Ahmad',
    },
    {
      id: 'demo_outlook_ahmad',
      provider: 'outlook',
      label: 'Ahmad — Outlook Demo',
      email: 'ahmad.randhawa@outlook.com',
      fromName: 'Ahmad Randhawa',
      host: 'smtp-mail.outlook.com',
      port: 587,
      dailyLimit: 300,
      source: 'demo',
      configured: true,
      first_name: 'Ahmad',
    },
    {
      id: 'demo_yahoo_ahmad',
      provider: 'yahoo',
      label: 'Ahmad — Yahoo Demo',
      email: 'ahmad.demo@yahoo.com',
      fromName: 'Ahmad Demo',
      host: 'smtp.mail.yahoo.com',
      port: 587,
      dailyLimit: 200,
      source: 'demo',
      configured: true,
      first_name: 'Ahmad',
    },
  ];
  res.json({ envAccounts, savedAccounts: saved, demoAccounts });
});

app.post('/api/email-config/accounts', (req, res) => {
  try {
    const saved = store.saveSmtpAccount(req.body);
    res.json({ success: true, account: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/email-config/accounts/:id', (req, res) => {
  store.deleteSavedSmtpAccount(req.params.id);
  res.json({ success: true });
});

app.post('/api/email-config/test', async (req, res) => {
  const { account, host, port, secure, email, pass, fromName } = req.body;
  try {
    let cfg;
    if (account && getAccount(account)) {
      resetTransporter(account);
      await verifySmtp(account);
      const acc = getAccount(account);
      return res.json({ success: true, message: `SMTP verified for ${acc.email}` });
    }
    if (!host || !email || !pass) {
      return res.status(400).json({ error: 'Host, email, and password are required' });
    }
    cfg = { host, port: parseInt(port, 10) || 587, secure: !!secure, email, pass, fromName };
    await verifyCustomSmtp(cfg);
    res.json({ success: true, message: `SMTP verified for ${email}` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/email-config/test-send', async (req, res) => {
  const { host, port, secure, email, pass, fromName, test_to, account } = req.body;
  const testTo = test_to || email;
  if (!testTo) return res.status(400).json({ error: 'Test recipient email required' });
  try {
    if (account && getAccount(account)) {
      const result = await sendTestEmail({
        subject: 'Reachly — SMTP test',
        body_html: '<p>SMTP test successful from Hostinger (<strong>marcus.laneforge@xynovix.com</strong>).</p><p>If you received this, the mailbox is sending correctly.</p>',
        body_text: 'SMTP test successful from Hostinger (marcus.laneforge@xynovix.com).',
      }, testTo, { first_name: 'Ahmad', email: testTo, company: 'Test Co', title: 'Tester' }, account);
      return res.json({
        success: true,
        message: result.savedToSent
          ? `Test email sent to ${testTo} and copied to the Hostinger Sent folder`
          : `Test email sent to ${testTo}. Could not copy to Sent folder — check IMAP settings.`,
        savedToSent: !!result.savedToSent,
      });
    }
    const cfg = { host, port: parseInt(port, 10) || 587, secure: !!secure, email, pass, fromName };
    await sendTestWithCustomConfig(cfg, testTo);
    res.json({ success: true, message: `Test email sent to ${testTo}` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// --- Lead research ---

app.get('/api/lead-providers', (req, res) => {
  res.json({ providers: getLeadProviders(), keys: store.getLeadProviderKeys() });
});

app.post('/api/lead-providers/:id/key', (req, res) => {
  store.setLeadProviderKey(req.params.id, req.body.apiKey || '');
  res.json({ success: true });
});

app.post('/api/lead-research/search', async (req, res) => {
  const { provider, query } = req.body;
  if (!provider) return res.status(400).json({ error: 'Provider required' });
  const apiKey = store.getLeadProviderKey(provider);
  try {
    const result = await searchLeads(provider, query || {}, apiKey);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/lead-research/import', (req, res) => {
  const { leads, list_id } = req.body;
  if (!Array.isArray(leads) || !leads.length) {
    return res.status(400).json({ error: 'No leads to import' });
  }
  const listId = list_id || 'list1';
  let added = 0;
  let skipped = 0;
  for (const lead of leads) {
    if (!lead.email) { skipped++; continue; }
    try {
      store.addContact(lead.email, {
        name: lead.name,
        first_name: lead.first_name,
        last_name: lead.last_name,
        company: lead.company,
        title: lead.title,
        city: lead.city,
        industry: lead.industry,
        linkedin: lead.linkedin,
        company_profile: lead.company_profile,
      }, listId);
      added++;
    } catch {
      skipped++;
    }
  }
  res.json({ success: true, added, skipped, listId });
});

// --- Variables ---

app.get('/api/variables', (req, res) => {
  res.json({
    data: getDataVariables(),
    custom: store.getCustomVariables(),
  });
});

app.post('/api/variables/custom', (req, res) => {
  try {
    const item = store.addCustomVariable(req.body);
    res.json({ success: true, variable: item });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/variables/custom/:id', (req, res) => {
  store.deleteCustomVariable(parseInt(req.params.id, 10));
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, 'static'), { etag: true, lastModified: true, maxAge: 0 }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Request error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

function startBackgroundJobs() {
  if (store.getPendingCount() > 0) {
    const hasQuota = getAccounts().some(a => store.getRemainingToday(a.dailyLimit, a.id) > 0);
    if (hasQuota) {
      store.setMeta({ userStoppedSender: false });
      startSender();
    } else {
      const p = store.getQueueProgress();
      console.log(`Queue: ${p.pending.toLocaleString()} pending. Daily limits reached — resumes tomorrow.`);
    }
  }

  cron.schedule('0 0 * * *', () => {
    resetDailyState();
    store.setMeta({ userStoppedSender: false });
    const pending = store.getPendingCount();
    console.log(`New day — limits reset. ${pending.toLocaleString()} emails in queue.`);
    if (pending > 0) startSender();
  });
}

if (!isServerless) {
  startBackgroundJobs();
  app.listen(PORT, () => {
    const accounts = getAccountStatuses();
    console.log(`Reachly running at http://localhost:${PORT}`);
    for (const a of accounts) {
      const warmup = a.warmup ? ` | warmup day ${a.warmup.day}/${a.warmup.totalDays}` : '';
      console.log(`  ${a.label}: ${a.email} | ${a.todaySent}/${a.dailyLimit} today${warmup} | ${a.protected ? 'PROTECTED' : 'standard'}`);
    }
  });
} else {
  console.log('Reachly running in serverless mode (background sender disabled)');
}

module.exports = app;
