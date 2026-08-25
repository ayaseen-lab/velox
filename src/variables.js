const DATA_VARIABLES = [
  { token: '{{first_name}}', label: 'First Name', source: 'data', field: 'first_name' },
  { token: '{{last_name}}', label: 'Last Name', source: 'data', field: 'last_name' },
  { token: '{{name}}', label: 'Full Name', source: 'data', field: 'name' },
  { token: '{{title}}', label: 'Job Title', source: 'data', field: 'title' },
  { token: '{{job_title}}', label: 'Job Title (alt)', source: 'data', field: 'title' },
  { token: '{{company}}', label: 'Company', source: 'data', field: 'company' },
  { token: '{{email}}', label: 'Email', source: 'data', field: 'email' },
  { token: '{{city}}', label: 'City', source: 'data', field: 'city' },
  { token: '{{country}}', label: 'Country', source: 'data', field: 'country' },
  { token: '{{location}}', label: 'Location (city)', source: 'data', field: 'city' },
  { token: '{{industry}}', label: 'Industry', source: 'data', field: 'industry' },
  { token: '{{website}}', label: 'Website', source: 'data', field: 'website' },
  { token: '{{linkedin}}', label: 'LinkedIn', source: 'data', field: 'linkedin' },
  { token: '{{personalized_opener}}', label: 'AI Opener', source: 'generated', field: 'personalized_opener' },
  { token: '{{personalized_closing}}', label: 'AI Closing', source: 'generated', field: 'personalized_closing' },
  { token: '{{personalized_subject}}', label: 'AI Subject', source: 'generated', field: 'personalized_subject' },
  { token: '{{location_line}}', label: 'AI Location / Timezone Line', source: 'generated', field: 'location_line' },
  { token: '{{portfolio_url}}', label: 'Portfolio URL', source: 'static', field: 'portfolio_url' },
];

function getDataVariables() {
  return DATA_VARIABLES;
}

function normalizeToken(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? `{{${slug}}}` : '';
}

function buildVariableMap(contact, customVariables = []) {
  const map = {};
  for (const v of DATA_VARIABLES) {
    if (v.source === 'generated') continue;
    const key = v.token.replace(/[{}]/g, '').toLowerCase();
    map[v.token] = contact?.[v.field] || contact?.[key] || '';
  }
  for (const cv of customVariables) {
    if (cv.token && cv.value != null) map[cv.token] = cv.value;
  }
  return map;
}

module.exports = {
  getDataVariables,
  normalizeToken,
  buildVariableMap,
  DATA_VARIABLES,
};
