/**
 * Generates unique opening/closing/subject lines per contact.
 * Tuned for LaneForge carrier / owner-operator outreach.
 */

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toDisplayCase(value) {
  const s = clean(value);
  if (!s) return '';
  if (s !== s.toUpperCase() || s.length < 2) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Ltd|Llp|Dba)\b/g, (m) => m.toUpperCase());
}

function firstName(contact) {
  const first = toDisplayCase(contact.first_name) || toDisplayCase(contact.name).split(' ')[0];
  return first || 'there';
}

function hasCompany(contact) {
  return !!clean(contact.company);
}

function hasTitle(contact) {
  const t = clean(contact.title).toLowerCase();
  return !!t && t !== 'your role' && t !== 'n/a' && t !== 'na' && t !== '-';
}

function hasLocation(contact) {
  return !!(clean(contact.city) || clean(contact.country));
}

function hasDot(contact) {
  return !!clean(contact.dot || contact.usdot || contact.dot_number);
}

function locationLabel(contact) {
  const city = toDisplayCase(contact.city);
  const state = clean(contact.country);
  if (city && state) return `${city}, ${state}`;
  return city || state || '';
}

function pickVariant(seed, variants) {
  if (!variants.length) return '';
  return variants[hashCode(seed || 'default') % variants.length];
}

function titlePhrase(contact) {
  if (!hasTitle(contact)) return '';
  return toDisplayCase(contact.title);
}

function companyPhrase(contact) {
  if (!hasCompany(contact)) return '';
  return toDisplayCase(contact.company);
}

function dotPhrase(contact) {
  const raw = clean(contact.dot || contact.usdot || contact.dot_number);
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits || raw;
}

function mcPhrase(contact) {
  const raw = clean(contact.mc || contact.mc_number || contact.all_active_mcs);
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (/^mc/i.test(first)) return first.toUpperCase().replace(/\s+/g, '');
  const digits = first.replace(/[^0-9]/g, '');
  return digits ? `MC${digits}` : first;
}

function fleetPhrase(contact) {
  const drivers = clean(contact.drivers);
  const units = clean(contact.power_units);
  if (drivers && drivers !== '0') {
    return drivers === '1' ? '1 driver' : `${drivers} drivers`;
  }
  if (units && units !== '0') {
    return units === '1' ? '1 truck' : `${units} trucks`;
  }
  return '';
}

function generatePersonalizedSubject(contact) {
  const first = firstName(contact);
  return `${first} — More Revenue, Less Deadhead & Real Home Time with LaneForge Dispatch`;
}

function generateLocationLine(contact) {
  const loc = locationLabel(contact);
  if (loc) {
    return `If you are running around ${loc}, we can build 2–3 core lanes from that home base instead of chasing random freight nationwide.`;
  }
  return 'We build 2–3 core lanes around your home base and equipment so the truck stays loaded with less empty miles.';
}

function generatePersonalizedOpener(contact) {
  const title = titlePhrase(contact);
  const company = companyPhrase(contact);
  const dot = dotPhrase(contact);
  const mc = mcPhrase(contact);
  const loc = locationLabel(contact);
  const email = contact.email || '';
  const locBit = loc ? ` out of ${loc}` : '';
  const roleBit = title ? ` as ${title}` : '';
  const companyBit = company ? ` at ${company}` : '';
  const idBits = [dot && `DOT ${dot}`, mc].filter(Boolean).join(', ');
  const idBit = idBits ? ` (${idBits})` : '';

  const withAll = [
    `I came across ${company}${idBit}${locBit} and wanted to reach out about dispatch that cuts empty miles and plans real Friday home time.`,
    `Your operation${companyBit}${idBit}${locBit} stood out. We build dispatch around your truck, home base, and weekly goals instead of random load-board chasing.`,
    `Reaching out${roleBit}${companyBit}${idBit}. If empty miles and weak weekly planning are eating into your RPM, we can help stack better freight and position the truck for home by Friday.`,
  ];

  const withCompany = [
    `I wanted to reach out about dispatch support for ${company}${locBit} — stronger rates, less deadhead, and a weekly plan that actually fits the operation.`,
    `What ${company} is running${locBit} looked like a strong fit for core lanes, better reloads, and planned home time instead of last-minute scramble.`,
    `I am reaching out about dispatch support for ${company}. The focus is higher-paying freight, lower empty miles, and a weekly plan that protects weekends at home.`,
  ];

  const withDot = [
    `I saw ${idBits || 'your authority'}${companyBit}${locBit} and thought a direct note made sense — better weekly revenue, less deadhead, and home time planned from the start of the week.`,
    `${idBits || 'Your authority'} caught my attention${locBit}. We help owner-operators and small fleets keep the truck loaded with less downtime.`,
  ];

  const withTitle = [
    `Given your role${roleBit}${locBit}, I wanted to share how we support owner-operators and carriers who want better freight and real home time.`,
    `As ${title}, you already know random load-board freight burns time and miles. We build a dispatch plan around equipment, home base, and Friday home goals.`,
  ];

  const withNeither = [
    `I wanted to reach out about dispatch support that cuts empty miles and plans real Friday home time.`,
    `Quick note — we build lane strategy around your truck and home base so every week is more efficient and less deadhead-heavy.`,
    `Our dispatch approach is simple: better-paying loads, less empty miles, and home time that is planned from the start of the week.`,
  ];

  let variants;
  if (company && (dot || mc || title || loc)) variants = withAll;
  else if (company) variants = withCompany;
  else if (dot || mc) variants = withDot;
  else if (title) variants = withTitle;
  else variants = withNeither;

  return pickVariant(email, variants);
}

function generatePersonalizedClosing(contact) {
  const company = companyPhrase(contact);
  const first = firstName(contact);
  const loc = locationLabel(contact);
  const email = contact.email || '';

  if (company) {
    return pickVariant(email + 'close', [
      `${first}, if better RPM and Friday home loads would help ${company}, just reply to this email. We work at a low dispatch rate, pay weekly, and handle everything through invoice.`,
      `If this is useful for ${company}${loc ? ` out of ${loc}` : ''}, reply and we can get started. Pricing stays low, payment is weekly, and billing is done through invoice.`,
    ]);
  }

  return pickVariant(email + 'close', [
    `${first}, if this would help your operation, just reply to this email. We work at a low dispatch rate, pay weekly, and handle everything through invoice.`,
    'Reply if you want to get started — low dispatch rate, weekly payment, and simple invoicing.',
  ]);
}

module.exports = {
  generatePersonalizedOpener,
  generatePersonalizedClosing,
  generatePersonalizedSubject,
  generateLocationLine,
  toDisplayCase,
  firstName,
  hasCompany,
  hasTitle,
  hasDot,
  hasLocation,
  companyPhrase,
  titlePhrase,
  dotPhrase,
  mcPhrase,
  fleetPhrase,
};
