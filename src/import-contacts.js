const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

function pick(row, ...keys) {
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    normalized[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v ?? '').trim();
  }
  for (const key of keys) {
    const nk = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized[nk]) return normalized[nk];
  }
  return '';
}

function normalizeMc(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  if (!first) return '';
  if (/^mc/i.test(first)) return first.toUpperCase().replace(/\s+/g, '');
  const digits = first.replace(/[^0-9]/g, '');
  return digits ? `MC${digits}` : first;
}

function normalizeContact(row) {
  const firstName = pick(row, 'first name', 'firstname', 'first_name', 'first');
  const lastName = pick(row, 'last name', 'lastname', 'last_name', 'last');
  const email = pick(row, 'email address', 'email', 'e-mail', 'mail');
  const company = pick(row, 'company name', 'company', 'legal name', 'organization', 'org');
  const title = pick(row, 'contact title', 'job title', 'title', 'position', 'role');
  const website = pick(row, 'website', 'url', 'company website', 'source url', 'source_url', 'motus url');
  const linkedin = pick(row, 'linkedin profile', 'linkedin', 'linkedin url', 'person linkedin url');
  const city = pick(row, 'city', 'person city', 'phy city');
  const country = pick(row, 'state', 'phy state', 'country', 'person country');
  const zip = pick(row, 'zip', 'zip code', 'postal code', 'phy zip');
  const industry = pick(row, 'authority type', 'industry', 'company industry', 'source');
  const phone = pick(row, 'phone', 'phone number', 'mobile', 'tel');
  const address = pick(row, 'principal address', 'address', 'phy address', 'street');
  const mailingAddress = pick(row, 'mailing address', 'mail address');
  const drivers = pick(row, 'drivers', 'driver count', 'nbr drivers');
  const powerUnits = pick(row, 'power units', 'power unit', 'trucks', 'units');
  const authorityStatus = pick(row, 'authority status', 'auth status');
  const dotStatus = pick(row, 'dot status', 'status');
  const companyProfile = pick(row, 'company profile', 'company about', 'about', 'description', 'company description', 'specialties', 'keywords');
  const dot = pick(row, 'dot', 'dot #', 'usdot', 'dot number', 'dot_number', 'usdot number', 'dot#', 'usdot#', 'docket number');
  const mc = normalizeMc(pick(row, 'mc', 'mc #', 'mc number', 'mc_number', 'census mc', 'docket'));
  const allActiveMcs = pick(row, 'all active mcs', 'active mcs');
  const name = pick(row, 'contact name', 'contact', 'name', 'full name', 'full_name')
    || [firstName, lastName].filter(Boolean).join(' ');
  const nameParts = name.split(/\s+/).filter(Boolean);

  const profileBits = [
    companyProfile,
    industry,
    drivers ? `${drivers} driver${drivers === '1' ? '' : 's'}` : '',
    powerUnits ? `${powerUnits} power unit${powerUnits === '1' ? '' : 's'}` : '',
    city && country ? `based in ${city}, ${country}` : (city || country),
  ].filter(Boolean);

  return {
    email,
    name,
    first_name: firstName || nameParts[0] || '',
    last_name: lastName || nameParts.slice(1).join(' '),
    company,
    title,
    website,
    linkedin,
    city,
    country,
    zip,
    industry,
    phone,
    address,
    mailing_address: mailingAddress,
    drivers,
    power_units: powerUnits,
    authority_status: authorityStatus,
    dot_status: dotStatus,
    company_profile: profileBits.join('. '),
    dot,
    mc,
    all_active_mcs: allActiveMcs,
  };
}

function parseContactsCsv(content) {
  const trimmed = content.trim();
  if (!trimmed) return [];

  try {
    const records = parse(trimmed, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
    if (records.length > 0) {
      return records.map(normalizeContact).filter(c => c.email && c.email.includes('@'));
    }
  } catch { /* fall through */ }

  const lines = parse(trimmed, { columns: false, skip_empty_lines: true, trim: true });
  return lines.map(row => ({
    email: (row[5] || row[0] || '').trim(),
    name: `${(row[2] || '').trim()} ${(row[3] || '').trim()}`.trim(),
    first_name: (row[2] || '').trim(),
    last_name: (row[3] || '').trim(),
    company: (row[0] || '').trim(),
    title: (row[4] || '').trim(),
    website: (row[1] || '').trim(),
    linkedin: (row[6] || '').trim(),
  })).filter(c => c.email && c.email.includes('@'));
}

function parseContactsXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return records.map(normalizeContact).filter(c => c.email && c.email.includes('@'));
}

module.exports = { parseContactsCsv, parseContactsXlsx, normalizeContact };
