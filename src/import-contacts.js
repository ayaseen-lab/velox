const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');

function pick(row, ...keys) {
  const normalized = {};
  for (const [k, v] of Object.entries(row)) {
    normalized[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v || '').trim();
  }
  for (const key of keys) {
    const nk = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized[nk]) return normalized[nk];
  }
  return '';
}

function normalizeContact(row) {
  const firstName = pick(row, 'first name', 'firstname', 'first_name', 'first');
  const lastName = pick(row, 'last name', 'lastname', 'last_name', 'last');
  const email = pick(row, 'email address', 'email', 'e-mail', 'mail');
  const company = pick(row, 'company name', 'company', 'organization', 'org');
  const title = pick(row, 'job title', 'title', 'position', 'role');
  const website = pick(row, 'website', 'url', 'company website');
  const linkedin = pick(row, 'linkedin profile', 'linkedin', 'linkedin url', 'person linkedin url');
  const city = pick(row, 'city', 'person city');
  const country = pick(row, 'country', 'person country');
  const industry = pick(row, 'industry', 'company industry');
  const companyProfile = pick(row, 'company profile', 'company about', 'about', 'description', 'company description', 'specialties', 'keywords');
  const name = pick(row, 'name', 'full name') || [firstName, lastName].filter(Boolean).join(' ');

  return {
    email,
    name: name || [firstName, lastName].filter(Boolean).join(' '),
    first_name: firstName,
    last_name: lastName,
    company,
    title,
    website,
    linkedin,
    city,
    country,
    industry,
    company_profile: companyProfile,
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
