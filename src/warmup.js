const SCHEDULE = [
  { day: 1, limit: 15, delayMs: 240000 },
  { day: 2, limit: 25, delayMs: 210000 },
  { day: 3, limit: 35, delayMs: 180000 },
  { day: 4, limit: 50, delayMs: 150000 },
  { day: 5, limit: 70, delayMs: 120000 },
  { day: 6, limit: 90, delayMs: 100000 },
  { day: 7, limit: 120, delayMs: 90000 },
  { day: 8, limit: 150, delayMs: 75000 },
  { day: 9, limit: 180, delayMs: 70000 },
  { day: 10, limit: 220, delayMs: 60000 },
  { day: 11, limit: 260, delayMs: 50000 },
  { day: 12, limit: 300, delayMs: 45000 },
  { day: 13, limit: 340, delayMs: 40000 },
  { day: 14, limit: 380, delayMs: 35000 },
  { day: 15, limit: 420, delayMs: 30000 },
  { day: 16, limit: 450, delayMs: 25000 },
  { day: 17, limit: 480, delayMs: 20000 },
  { day: 18, limit: 490, delayMs: 20000 },
  { day: 19, limit: 490, delayMs: 20000 },
  { day: 20, limit: 490, delayMs: 15000 },
  { day: 21, limit: 490, delayMs: 15000 },
];

const DEFAULT_TZ = 'Asia/Karachi';
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 18;

function accountNum(accountId) {
  return String(accountId || '').replace('account', '');
}

function envFlag(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
}

function todayInZone(timeZone) {
  const p = zonedParts(new Date(), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function dayDiff(startDate, todayDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${todayDate}T00:00:00`);
  return Math.floor((today - start) / 86400000) + 1;
}

function jitterDelay(baseMs, { warmup = false } = {}) {
  const parsed = Number(baseMs);
  const delay = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  if (!warmup) {
    if (delay <= 0) return 0;
    const spread = Math.min(Math.max(delay * 0.15, 0), 40);
    return Math.max(0, Math.round(delay + (Math.random() * 2 - 1) * spread));
  }
  const spread = Math.max(delay * 0.25, 8000);
  const delta = (Math.random() * 2 - 1) * spread;
  return Math.max(15000, Math.round(delay + delta));
}

function msUntilSendWindow(timeZone, startHour, endHour) {
  const now = new Date();
  const p = zonedParts(now, timeZone);
  const hour = parseInt(p.hour, 10);
  const minute = parseInt(p.minute, 10);
  const second = parseInt(p.second, 10);
  if (hour >= startHour && hour < endHour) return 0;

  let hoursUntil;
  if (hour < startHour) hoursUntil = startHour - hour;
  else hoursUntil = (24 - hour) + startHour;

  return Math.max(((hoursUntil * 60) - minute) * 60 * 1000 - second * 1000, 1000);
}

function getWarmupPlan(accountId) {
  const num = accountNum(accountId);
  if (!num) return null;
  const enabled = envFlag(`SMTP_ACCOUNT_${num}_WARMUP`) || (num === '1' && envFlag('SMTP_WARMUP'));
  if (!enabled) return null;

  const timeZone = process.env.WARMUP_TZ || process.env.TZ || DEFAULT_TZ;
  const startHour = parseInt(process.env.WARMUP_START_HOUR || String(DEFAULT_START_HOUR), 10);
  const endHour = parseInt(process.env.WARMUP_END_HOUR || String(DEFAULT_END_HOUR), 10);
  const start = process.env[`SMTP_ACCOUNT_${num}_WARMUP_START`] || process.env.WARMUP_START || todayInZone(timeZone);
  const today = todayInZone(timeZone);
  const day = Math.max(1, dayDiff(start, today));

  if (day > SCHEDULE.length) return null;

  const step = SCHEDULE[day - 1] || SCHEDULE[SCHEDULE.length - 1];
  const waitMs = msUntilSendWindow(timeZone, startHour, endHour);

  return {
    enabled: true,
    day,
    totalDays: SCHEDULE.length,
    dailyLimit: step.limit,
    delayMs: step.delayMs,
    timeZone,
    startHour,
    endHour,
    startDate: start,
    inSendWindow: waitMs === 0,
    waitMs,
    windowLabel: `${String(startHour).padStart(2, '0')}:00–${String(endHour).padStart(2, '0')}:00 ${timeZone}`,
  };
}

function getWarmupSeedEmails() {
  const raw = process.env.WARMUP_SEED_EMAILS || '';
  return [...new Set(
    raw.split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')),
  )];
}

function getWarmupSeedDays() {
  const n = parseInt(process.env.WARMUP_SEED_DAYS || '14', 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

function isWarmupSeedOnly(accountId) {
  const plan = getWarmupPlan(accountId);
  if (!plan) return false;
  return plan.day <= getWarmupSeedDays();
}

function warmupAllowsRecipient(accountId, email) {
  if (!isWarmupSeedOnly(accountId)) return true;
  const seeds = getWarmupSeedEmails();
  if (!seeds.length) return false;
  return seeds.includes(String(email || '').trim().toLowerCase());
}

module.exports = {
  SCHEDULE,
  getWarmupPlan,
  jitterDelay,
  todayInZone,
  getWarmupSeedEmails,
  getWarmupSeedDays,
  isWarmupSeedOnly,
  warmupAllowsRecipient,
};
