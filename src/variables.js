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
  { token: '{{dot}}', label: 'DOT / USDOT', source: 'data', field: 'dot' },
  { token: '{{usdot}}', label: 'USDOT (alt)', source: 'data', field: 'dot' },
  { token: '{{mc}}', label: 'MC Number', source: 'data', field: 'mc' },
  { token: '{{zip}}', label: 'ZIP', source: 'data', field: 'zip' },
  { token: '{{address}}', label: 'Address', source: 'data', field: 'address' },
  { token: '{{drivers}}', label: 'Drivers', source: 'data', field: 'drivers' },
  { token: '{{power_units}}', label: 'Power Units', source: 'data', field: 'power_units' },
  { token: '{{phone}}', label: 'Phone', source: 'data', field: 'phone' },
  { token: '{{personalized_opener}}', label: 'Personalized Opener', source: 'generated', field: 'personalized_opener' },
  { token: '{{personalized_closing}}', label: 'Personalized Closing', source: 'generated', field: 'personalized_closing' },
  { token: '{{personalized_subject}}', label: 'Personalized Subject', source: 'generated', field: 'personalized_subject' },
  { token: '{{location_line}}', label: 'Location / Lane Line', source: 'generated', field: 'location_line' },
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
