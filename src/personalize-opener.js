/**
 * Generates unique opening/closing/subject lines per contact.
 * Adapts when company, title, last name, or location are missing.
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

function firstName(contact) {
  const first = clean(contact.first_name) || clean(contact.name).split(' ')[0];
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

function locationLabel(contact) {
  return clean(contact.city) || clean(contact.country) || '';
}

function pickVariant(seed, variants) {
  if (!variants.length) return '';
  return variants[hashCode(seed || 'default') % variants.length];
}

function detectRoleType(title = '') {
  const t = title.toLowerCase();
  if (/\b(founder|co-founder|cofounder|ceo|chief executive)\b/.test(t)) return 'founder';
  if (/\b(cto|chief technology|vp of engineering|vp engineering|head of engineering|director of engineering|engineering director|eng director)\b/.test(t)) return 'eng_leader';
  if (/\b(engineering manager|tech lead|technical lead|staff engineer|principal engineer)\b/.test(t)) return 'eng_manager';
  if (/\b(product|cpo|chief product)\b/.test(t)) return 'product';
  if (/\b(hiring|talent|recruit|hr|people)\b/.test(t)) return 'hiring';
  if (/\b(robot|automation|mechatronic|control systems)\b/.test(t)) return 'robotics';
  if (/\b(embedded|firmware|fpga|rtos|mcu)\b/.test(t)) return 'embedded';
  if (/\b(data engineer|ml engineer|machine learning|ai engineer|computer vision)\b/.test(t)) return 'ai_data';
  if (/\b(frontend|front-end|front end|ui engineer|react|vue|angular)\b/.test(t)) return 'frontend';
  if (/\b(backend|back-end|back end|full.?stack|software engineer|software developer|devops|sre|cloud)\b/.test(t)) return 'software';
  return 'professional';
}

function detectIndustryType(industry = '', companyProfile = '', title = '') {
  const blob = `${industry} ${companyProfile} ${title}`.toLowerCase();
  if (/fintech|finance|bank/.test(blob)) return 'fintech';
  if (/health|medical|biotech/.test(blob)) return 'health';
  if (/iot|hardware|semiconductor|embedded/.test(blob)) return 'hardware';
  if (/robot|automation/.test(blob)) return 'robotics';
  if (/energy|industrial/.test(blob)) return 'industrial';
  if (/saas|software|technology|developer|engineer/.test(blob)) return 'software';
  return 'general';
}

function profileSnippet(profile, max = 100) {
  if (!profile || profile.length < 20) return '';
  const text = clean(profile);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function titlePhrase(contact) {
  if (!hasTitle(contact)) return '';
  return clean(contact.title);
}

function companyPhrase(contact) {
  if (!hasCompany(contact)) return '';
  return clean(contact.company);
}

function generatePersonalizedSubject(contact) {
  const first = firstName(contact);
  const company = companyPhrase(contact);
  const title = titlePhrase(contact);
  const email = contact.email || first;

  if (company) {
    return pickVariant(email + 'subj', [
      `Quick note for ${first} at ${company}`,
      `${first}, a note about engineering work at ${company}`,
      `Reaching out to ${first} — ${company}`,
    ]);
  }

  if (title) {
    return pickVariant(email + 'subj', [
      `Quick note for ${first} — ${title}`,
      `${first}, note about ${title.toLowerCase()} opportunities`,
      `Reaching out, ${first}`,
    ]);
  }

  return pickVariant(email + 'subj', [
    `Quick note for ${first}`,
    `${first}, a short engineering note`,
    `Reaching out, ${first}`,
  ]);
}

function generateLocationLine(contact) {
  const loc = locationLabel(contact);
  if (loc) {
    return `I am looking for a remote engineering role and can align my working hours with your team in ${loc}. Happy to adjust for your timezone so collaboration stays easy.`;
  }
  return 'I am looking for a remote engineering role and can flexibly align with your team\'s timezone so collaboration stays easy.';
}

function generatePersonalizedOpener(contact) {
  const title = titlePhrase(contact);
  const company = companyPhrase(contact);
  const industry = clean(contact.industry);
  const city = clean(contact.city);
  const country = clean(contact.country);
  const email = contact.email || '';
  const role = detectRoleType(title);
  const indBit = industry ? ` in ${industry}` : '';
  const locBit = city ? ` in ${city}` : (country ? ` in ${country}` : '');

  const withCompanyTitle = [];
  const withCompanyOnly = [];
  const withTitleOnly = [];
  const withNeither = [];

  const pushAll = (bucket, lines) => bucket.push(...lines);

  pushAll(withCompanyTitle, [
    `Given your role as ${title} at ${company}${locBit}, I thought a direct note made sense. My background is in making complex systems practical to build, ship, and maintain.`,
    `Your work as ${title} at ${company}${indBit} stood out. I have spent the last several years shipping production software across embedded, AI, and cloud layers.`,
    `As ${title} at ${company}, you are likely balancing delivery speed with long-term reliability. That trade-off has been central to my recent engineering work.`,
  ]);

  pushAll(withCompanyOnly, [
    `I came across ${company}${indBit} and wanted to introduce myself. I am a senior software engineer interested in contributing remotely to teams building serious products.`,
    `What ${company} is building caught my attention. My background covers embedded systems, AI-enabled products, and scalable cloud software.`,
    `I wanted to reach out about engineering work at ${company}. Over the past five years I have helped teams ship reliable systems from device software through cloud services.`,
  ]);

  pushAll(withTitleOnly, [
    `Given your background as ${title}${locBit}, I thought a direct note made sense. I focus on practical engineering across embedded, AI, and full-stack systems.`,
    `Your experience as ${title} stood out, so I wanted to introduce myself. I build production systems that need to work reliably on-device and in the cloud.`,
    `I am reaching out because roles like ${title} often need someone who can move between firmware, AI, and backend work without heavy handoffs — that has been my lane.`,
  ]);

  pushAll(withNeither, [
    `I wanted to introduce myself directly. I am a senior software developer focused on embedded systems, IoT, AI, and full-stack engineering for remote teams.`,
    `I am reaching out about senior engineering opportunities. My work spans firmware, AI/computer vision, and cloud-connected systems that need to ship and stay reliable.`,
    `I came across your profile and thought a short note was worthwhile. I help teams build practical systems across device software, AI pipelines, and scalable backends.`,
  ]);

  // Specialty overlays when title suggests a domain
  if (role === 'robotics') {
    withTitleOnly.unshift(`Your robotics/automation background${company ? ` at ${company}` : ''} caught my eye. I have worked on real-time systems, computer vision, and hardware-in-the-loop flows that need to stay dependable in production.`);
  }
  if (role === 'embedded') {
    withTitleOnly.unshift(`Your embedded/firmware focus${company ? ` at ${company}` : ''} resonated with my work on MCU platforms, RTOS, and device-cloud systems.`);
  }
  if (role === 'ai_data') {
    withTitleOnly.unshift(`Your work around data/AI${company ? ` at ${company}` : ''} stood out. I have built computer-vision and ML-assisted pipelines that feed into reliable product software.`);
  }
  if (role === 'frontend') {
    withTitleOnly.unshift(`Your frontend experience${company ? ` at ${company}` : ''} stood out. Beyond UI work, I also cover APIs, cloud services, and the systems that keep products shipping.`);
  }
  if (role === 'hiring') {
    withCompanyOnly.unshift(`I am reaching out regarding engineering opportunities${company ? ` at ${company}` : ''}. I am a senior engineer across scalable systems and rapid MVP delivery, and I would appreciate being considered.`);
  }

  let variants;
  if (company && title) variants = withCompanyTitle;
  else if (company) variants = withCompanyOnly;
  else if (title) variants = withTitleOnly;
  else variants = withNeither;

  return pickVariant(email, variants);
}

function generatePersonalizedClosing(contact) {
  const company = companyPhrase(contact);
  const title = titlePhrase(contact);
  const industry = clean(contact.industry);
  const profile = contact.company_profile || '';
  const email = contact.email || '';
  const indType = detectIndustryType(industry, profile, title);
  const snippet = profileSnippet(profile);

  if (snippet && company) {
    return pickVariant(email + 'close', [
      `From what I understand about ${company} (${snippet}), I think my background in embedded systems, cloud platforms, and practical AI could map well to your roadmap.`,
      `Given ${company}'s focus on ${snippet.toLowerCase().replace(/\.\.\.$/, '')}, I would welcome a short call to see where my experience might help your team move faster.`,
    ]);
  }

  if (company) {
    const byIndustry = {
      fintech: [
        `With ${company}'s work in financial technology, I believe my experience in secure backends, real-time pipelines, and reliable device-cloud systems could be useful.`,
        `I would be glad to discuss how my background in scalable architecture and production delivery could support ${company}.`,
      ],
      health: [
        `For a company like ${company}${industry ? ` in ${industry}` : ''}, I think my track record with reliable embedded systems and cloud pipelines could add value.`,
        `I would welcome a conversation about how my experience building robust software systems could support what ${company} is building.`,
      ],
      software: [
        `I believe ${company}'s engineering challenges around scalable products and fast iteration align closely with systems I have shipped in production.`,
        `It would be great to connect and explore how my full-stack and cloud background could help ${company} deliver faster without sacrificing quality.`,
      ],
      hardware: [
        `Given ${company}'s focus on hardware and connected products, my firmware, IoT, and cloud integration experience seems like a natural fit.`,
        `I would be happy to talk about how my embedded and device-cloud work could support the products ${company} is bringing to market.`,
      ],
      robotics: [
        `With ${company}'s work in robotics and automation, my background in real-time systems, computer vision, and hardware-in-the-loop testing could be directly relevant.`,
        `I would welcome a brief conversation about how my automation and embedded experience could support ${company}'s roadmap.`,
      ],
      industrial: [
        `For ${company}'s work${industry ? ` in ${industry}` : ''}, my experience with gateways, field protocols, and cloud telemetry pipelines could be a strong match.`,
        `I would be glad to discuss how my industrial IoT and backend experience could help ${company} scale delivery.`,
      ],
      general: [
        `I think my embedded, cloud, and full-stack background could be a practical fit for the engineering work at ${company}.`,
        `I would welcome a short conversation to see whether my experience could be useful to your team at ${company}.`,
        `If ${company} is growing its engineering team, I would be glad to share more about recent projects and see whether there is a fit.`,
      ],
    };
    return pickVariant(email + 'closing', byIndustry[indType] || byIndustry.general);
  }

  if (title) {
    return pickVariant(email + 'closing', [
      `If you are open to it, I would welcome a short conversation about how my experience could support work like yours as ${title}.`,
      `Happy to share a couple of relevant projects if useful — especially around embedded systems, AI pipelines, and cloud-connected products.`,
      `If timing is reasonable, I would like to explore whether my background is a fit for the kind of engineering work you are involved in.`,
    ]);
  }

  return pickVariant(email + 'closing', [
    'If you are open to it, I would welcome a short conversation about senior engineering opportunities on your side.',
    'Happy to share a couple of relevant projects if useful — especially around embedded systems, AI pipelines, and cloud-connected products.',
    'If timing is reasonable, I would like to explore whether my background could be useful to your team.',
  ]);
}

module.exports = {
  generatePersonalizedOpener,
  generatePersonalizedClosing,
  generatePersonalizedSubject,
  generateLocationLine,
  detectRoleType,
  hasCompany,
  hasTitle,
};
