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
  const company = companyPhrase(contact);
  const dot = dotPhrase(contact);
  const mc = mcPhrase(contact);
  const email = contact.email || first;

  if (company && (dot || mc)) {
    return pickVariant(email + 'subj', [
      `${first} at ${company} — more revenue, less deadhead`,
      `${dot ? `DOT ${dot}` : mc}: real home time for ${company}`,
      `${company} — better lanes and Friday home loads`,
    ]);
  }

  if (company) {
    return pickVariant(email + 'subj', [
      `${first} at ${company} — more revenue, less deadhead`,
      `Real home time and stronger lanes for ${company}`,
      `${company}: less deadhead, better weekly planning`,
    ]);
  }

  if (dot) {
    return pickVariant(email + 'subj', [
      `DOT ${dot} — more revenue, less deadhead`,
      `${first}, real home time with LaneForge Dispatch`,
      `${first}: better lanes and Friday home loads`,
    ]);
  }

  return pickVariant(email + 'subj', [
    `${first} — more revenue, less deadhead & real home time`,
    `More revenue, less deadhead & real home time`,
    `${first}, a note from LaneForge Dispatch`,
  ]);
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
  const fleet = fleetPhrase(contact);
  const loc = locationLabel(contact);
  const email = contact.email || '';
  const locBit = loc ? ` out of ${loc}` : '';
  const roleBit = title ? ` as ${title}` : '';
  const companyBit = company ? ` at ${company}` : '';
  const idBits = [dot && `DOT ${dot}`, mc].filter(Boolean).join(', ');
  const idBit = idBits ? ` (${idBits})` : '';
  const fleetBit = fleet ? ` with ${fleet}` : '';

  const withAll = [
    `I came across ${company}${idBit}${locBit}${fleetBit} and wanted to reach out directly. At LaneForge Dispatch we help owner-operators and small carriers cut empty miles, land stronger-paying freight, and plan real Friday home time.`,
    `Your operation${companyBit}${idBit}${locBit}${fleetBit} stood out. I am Marcus Hale with LaneForge Dispatch — we build dispatch around your truck, preferred lanes, and home-time goals instead of random load-board chasing.`,
    `Reaching out${roleBit}${companyBit}${idBit}. If empty miles and weak weekly planning are eating into your RPM, LaneForge can help stack better freight and position the truck for home by Friday.`,
  ];

  const withCompany = [
    `I wanted to introduce LaneForge Dispatch to ${company}${locBit}. We help carriers negotiate stronger rates, reduce deadhead, and keep the truck moving on lanes that actually fit the business.`,
    `What ${company} is running${locBit} looked like a strong fit for how we dispatch — core lanes, better reloads, and planned home time instead of last-minute scramble.`,
    `I am reaching out about dispatch support for ${company}. Our focus is higher-paying freight, lower empty miles, and a weekly plan that protects weekends at home.`,
  ];

  const withDot = [
    `I saw ${idBits || 'your authority'}${companyBit}${locBit}${fleetBit} and thought a direct note made sense. LaneForge Dispatch helps carriers improve weekly revenue by cutting deadhead and planning lanes around home time.`,
    `${idBits || 'Your authority'} caught my attention${locBit}. We work with owner-operators and small fleets to build 2–3 reliable core lanes and keep the truck loaded with less downtime.`,
  ];

  const withTitle = [
    `Given your role${roleBit}${locBit}, I wanted to share how LaneForge Dispatch supports owner-operators and carriers who want better freight and real home time.`,
    `As ${title}, you already know random load-board freight burns time and miles. We build a dispatch plan around equipment, preferred lanes, and Friday home goals.`,
  ];

  const withNeither = [
    `I am Marcus Hale with LaneForge Dispatch. We help owner-operators and carriers find stronger freight, reduce empty miles, and plan real weekends at home.`,
    `Quick note from LaneForge Dispatch — we build lane strategy around your truck and home base so every week is more efficient and less deadhead-heavy.`,
    `I wanted to introduce LaneForge. Our dispatch approach is simple: better-paying loads, less empty miles, and home time that is planned from the start of the week.`,
  ];

  let variants;
  if (company && (dot || mc || title || loc || fleet)) variants = withAll;
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
  const dot = dotPhrase(contact);
  const mc = mcPhrase(contact);
  const email = contact.email || '';

  if (company && loc) {
    return pickVariant(email + 'close', [
      `If ${company} is open to it, reply with equipment type, current location, preferred lanes, and availability — we can map a practical plan around ${loc}.`,
      `${first}, if better RPM and Friday home loads would help ${company}, reply with your equipment and preferred lanes and we will take it from there.`,
    ]);
  }

  if (company) {
    return pickVariant(email + 'close', [
      `If this sounds useful for ${company}, reply with equipment type, current location, preferred lanes, and availability and we can talk through next steps.`,
      `Happy to walk ${company} through how we would build core lanes and Friday home positioning — just reply with equipment and availability.`,
    ]);
  }

  if (dot || mc) {
    const idLabel = [dot && `DOT ${dot}`, mc].filter(Boolean).join(' / ');
    return pickVariant(email + 'close', [
      `For ${idLabel}, reply with equipment type, current location, preferred lanes, and availability if you want to see how LaneForge would support the operation.`,
      `If you want a dispatch plan built around ${idLabel}, reply with equipment and preferred lanes and I will follow up personally.`,
    ]);
  }

  return pickVariant(email + 'close', [
    'If you are interested, reply with your equipment type, current location, preferred lanes, and availability and we can discuss how LaneForge can support your operation.',
    'Reply with equipment, location, preferred lanes, and availability whenever you want to talk through a better weekly plan.',
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
