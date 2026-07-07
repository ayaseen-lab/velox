/**
 * Generates unique opening and closing paragraphs per contact.
 */

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function detectRoleType(title = '') {
  const t = title.toLowerCase();
  if (/\b(founder|co-founder|cofounder|ceo|chief executive)\b/.test(t)) return 'founder';
  if (/\b(cto|chief technology|vp of engineering|vp engineering|head of engineering|director of engineering|engineering director|eng director)\b/.test(t)) return 'eng_leader';
  if (/\b(engineering manager|tech lead|technical lead|staff engineer|principal engineer)\b/.test(t)) return 'eng_manager';
  if (/\b(product|cpo|chief product)\b/.test(t)) return 'product';
  if (/\b(hiring|talent|recruit|hr|people)\b/.test(t)) return 'hiring';
  return 'professional';
}

function detectIndustryType(industry = '') {
  const ind = industry.toLowerCase();
  if (ind.includes('fintech') || ind.includes('finance') || ind.includes('bank')) return 'fintech';
  if (ind.includes('health') || ind.includes('medical') || ind.includes('biotech')) return 'health';
  if (ind.includes('saas') || ind.includes('software') || ind.includes('technology')) return 'software';
  if (ind.includes('iot') || ind.includes('hardware') || ind.includes('semiconductor')) return 'hardware';
  if (ind.includes('robot') || ind.includes('automation')) return 'robotics';
  if (ind.includes('energy') || ind.includes('industrial')) return 'industrial';
  return 'general';
}

function industryPhrase(industry) {
  if (!industry) return '';
  const ind = industry.toLowerCase();
  if (ind.includes('software') || ind.includes('technology') || ind.includes('saas')) {
    return ` in the ${industry} space`;
  }
  return ` in ${industry}`;
}

function cityPhrase(city) {
  return city ? ` in ${city}` : '';
}

function pickVariant(email, variants) {
  const idx = hashCode(email || 'default') % variants.length;
  return variants[idx];
}

function profileSnippet(profile, max = 100) {
  if (!profile || profile.length < 20) return '';
  const clean = profile.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + '...';
}

function generatePersonalizedOpener(contact) {
  const first = contact.first_name || (contact.name || '').split(' ')[0] || 'there';
  const title = contact.title || 'your role';
  const company = contact.company || 'your organization';
  const industry = contact.industry || '';
  const city = contact.city || '';
  const email = contact.email || '';
  const role = detectRoleType(title);
  const indPhrase = industryPhrase(industry);
  const locPhrase = cityPhrase(city);

  const openers = {
    founder: [
      `Leading ${company}${indPhrase} means balancing speed with reliability. I have worked on that engineering trade-off for years and would like to explore contributing to your team.`,
      `What ${company} is building${indPhrase} caught my attention, especially with you leading as ${title}. I am reaching out because I believe my background could support your engineering goals.`,
      `As ${title} at ${company}, you are likely focused on shipping fast without breaking what already works. That is the kind of challenge I have helped teams solve repeatedly.`,
    ],
    eng_leader: [
      `Your work as ${title} at ${company}${locPhrase} stood out to me. Teams at your stage often need someone who can move from scalable architecture to focused MVP delivery, which has been central to my recent work.`,
      `I came across your profile as ${title} at ${company} and wanted to connect. Over the past five years I have built production systems and helped teams shorten the path from idea to shipped product.`,
      `Given your role leading engineering at ${company}, I thought a direct note made sense. My background is in making complex systems practical to build, ship, and maintain.`,
    ],
    eng_manager: [
      `I noticed you are ${title} at ${company}${indPhrase}. I am looking for a team where hands-on engineering and mentoring both matter, and your work seemed like a strong match.`,
      `As ${title} at ${company}, you likely balance delivery pressure with code quality every week. I have worked in that environment for years and would welcome a conversation about joining your team.`,
      `Your role at ${company} resonated with me. I have led work across backend, cloud, and device software, and I would be glad to bring that experience to your group.`,
    ],
    product: [
      `Building the right product at ${company}${indPhrase} depends on strong engineering partnership. I am reaching out as someone who has worked closely with product leaders to ship MVPs that scale.`,
      `As ${title} at ${company}, you likely care about how quickly engineering can turn ideas into something users can try. That has been the focus of most of my career.`,
    ],
    hiring: [
      `I am reaching out regarding engineering opportunities at ${company}. I am a senior engineer with experience across scalable systems and rapid MVP delivery, and I would appreciate being considered for your team.`,
    ],
    professional: [
      `I came across your work at ${company}${indPhrase} and wanted to introduce myself. I am a senior software engineer interested in contributing to your engineering team remotely.`,
      `Your profile as ${title} at ${company}${locPhrase} caught my eye. I have spent five years building production software and I am looking for a team where I can add value quickly.`,
      `I wanted to reach out after learning about ${company}. My experience spans scalable backend systems and lean MVP delivery, and I think there could be a good fit with your current priorities.`,
    ],
  };

  const variants = openers[role] || openers.professional;
  return pickVariant(email, variants).replace(/\{\{first_name\}\}/g, first);
}

function generatePersonalizedClosing(contact) {
  const company = contact.company || 'your organization';
  const industry = contact.industry || '';
  const profile = contact.company_profile || '';
  const email = contact.email || '';
  const indType = detectIndustryType(industry);
  const snippet = profileSnippet(profile);

  if (snippet) {
    const profileClosings = [
      `From what I understand about ${company} (${snippet}), I think my background in embedded systems, cloud platforms, and MVP delivery could map well to your roadmap.`,
      `Given ${company}'s focus on ${snippet.toLowerCase().replace(/\.\.\.$/, '')}, I would welcome a short call to see where my experience might help your engineering team move faster.`,
    ];
    return pickVariant(email + 'close', profileClosings);
  }

  const closings = {
    fintech: [
      `With ${company}'s work in financial technology, I believe my experience in secure backends, real-time pipelines, and reliable device-cloud systems could be useful to your engineering team.`,
      `I would be glad to discuss how my background in scalable architecture and production-grade delivery could support ${company}'s product goals in fintech.`,
    ],
    health: [
      `For a company like ${company} in ${industry || 'healthcare'}, I think my track record with reliable embedded systems and compliant cloud pipelines could add value to your engineering efforts.`,
      `I would welcome a conversation about how my experience building robust, audit-friendly software systems could support what ${company} is building.`,
    ],
    software: [
      `I believe ${company}'s engineering challenges around scalable products and fast iteration align closely with the systems I have built and shipped in production.`,
      `It would be great to connect and explore how my full-stack and cloud background could help ${company} deliver faster without sacrificing quality.`,
    ],
    hardware: [
      `Given ${company}'s focus on hardware and connected products, my firmware, IoT, and cloud integration experience seems like a natural fit for your engineering team.`,
      `I would be happy to talk about how my embedded and device-cloud work could support the products ${company} is bringing to market.`,
    ],
    robotics: [
      `With ${company}'s work in robotics and automation, I think my background in real-time systems, computer vision, and hardware-in-the-loop testing could be directly relevant.`,
      `I would welcome a brief conversation about how my automation and embedded experience could support ${company}'s engineering roadmap.`,
    ],
    industrial: [
      `For ${company}'s work in ${industry || 'industrial systems'}, my experience with gateways, field protocols, and cloud telemetry pipelines could be a strong match for your team.`,
      `I would be glad to discuss how my industrial IoT and backend experience could help ${company} scale its engineering delivery.`,
    ],
    general: [
      `I think my embedded, cloud, and full-stack background could be a practical fit for the engineering work at ${company}.`,
      `I would welcome a short conversation to see whether my experience could be useful to your team at ${company}.`,
      `If ${company} is growing its engineering team, I would be glad to share more about recent projects and see whether there is a fit.`,
    ],
  };

  const variants = closings[indType] || closings.general;
  return pickVariant(email + 'closing', variants);
}

module.exports = {
  generatePersonalizedOpener,
  generatePersonalizedClosing,
  detectRoleType,
};
