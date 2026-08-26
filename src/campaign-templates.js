const DEFAULT_EMAIL = {
  id: 'default',
  version: 14,
  name: 'LaneForge Dispatch — Marcus Hale (Carrier Outreach)',
  subject: 'More Revenue, Less Deadhead & Real Home Time with LaneForge Dispatch',
  preheader: '',
  body_html: `<p>Hi {{first_name}},</p>

<p>{{personalized_opener}}</p>

<p>I’m <strong>Marcus Hale</strong> from <strong>LaneForge Dispatch</strong>. We help owner-operators and carriers find better freight opportunities, reduce empty miles, save time, and keep their trucks moving efficiently.</p>

<p>At LaneForge, we don’t believe dispatching should simply mean sending random loads from one state to another. Our approach is to understand your truck, equipment, home base, preferred lanes, and business goals—then build a dispatch strategy around you.</p>

<p style="margin:22px 0 8px;font-size:16px;font-weight:600;">What Makes LaneForge Different?</p>

<p style="margin:18px 0 6px;font-weight:600;">Higher-Paying Loads &amp; Better Efficiency</p>
<p>Our dispatch team works to maximize the value of every week by focusing on:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>Negotiating competitive rates</li>
<li>Finding stronger-paying freight opportunities</li>
<li>Minimizing unnecessary deadhead</li>
<li>Stacking reloads where possible</li>
<li>Using strong broker relationships and load networks</li>
<li>Planning routes for better efficiency</li>
<li>Reducing unnecessary waiting and downtime</li>
</ul>
<p>Depending on your equipment, market conditions, lanes, and availability, better planning and reduced empty miles can make a meaningful difference in your weekly revenue and overall profitability.</p>

<p style="margin:18px 0 6px;font-weight:600;">Friday Home Loads — Real Home Time</p>
<p>Your home time is planned, not treated as an afterthought.</p>
<p>We plan your week <strong>backward from your desired home time</strong>. By Wednesday or Thursday, we are already working to position your truck for a Friday delivery close to home—or a short paid leg that brings you back.</p>
<p>Our goal is to help you get:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>Real weekends at home</li>
<li>Less time spending your reset at a truck stop</li>
<li>Better planning around family and personal commitments</li>
<li>A clear weekly route strategy</li>
<li>Loads positioned around your home schedule</li>
</ul>
<p>We work hard to honor the home-time commitments and planning agreed with you.</p>

<p style="margin:18px 0 6px;font-weight:600;">Save Valuable Time</p>
<p>Driving a truck is already a full-time job. You shouldn’t have to spend hours searching load boards and calling brokers while also managing your business.</p>
<p>We can assist with:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>Searching for freight opportunities</li>
<li>Monitoring load boards</li>
<li>Calling and communicating with brokers</li>
<li>Negotiating rates</li>
<li>Managing rate confirmations</li>
<li>Load setup and dispatch coordination</li>
<li>Basic paperwork coordination</li>
<li>Invoices and factoring-related documentation</li>
<li>Insurance certificate requests</li>
<li>Detention claims</li>
<li>Layover requests</li>
<li>TONU claims</li>
<li>Other dispatch-related coordination</li>
</ul>
<p>This can save you valuable hours of administrative work, allowing you to focus on driving and running your business.</p>

<p style="margin:18px 0 6px;font-weight:600;">Dedicated Support &amp; Full Control</p>
<p>When you work with LaneForge, you remain in control of your truck and your business.</p>
<p>You get:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>A dedicated point of contact</li>
<li>Support for dispatch-related issues</li>
<li>Assistance with load status and coordination</li>
<li>No forced dispatch</li>
<li>You approve every load before accepting it</li>
<li>Your preferred lanes and operating preferences are considered</li>
</ul>
<p><strong>You always have the final decision.</strong></p>

<p style="margin:18px 0 6px;font-weight:600;">Core Lanes That Actually Work</p>
<p>{{location_line}}</p>
<p>Instead of chasing random loads all over the country, we help build and maintain <strong>2–3 core lanes</strong> around your home base and equipment.</p>
<p>We focus on lanes with:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>Strong outbound rates</li>
<li>Fast and reliable reload opportunities</li>
<li>Low deadhead miles</li>
<li>Consistent freight volume</li>
<li>Familiar operating areas</li>
<li>Better weekly planning</li>
</ul>
<p>The objective is simple: <strong>keep your truck loaded, reduce empty miles, and improve overall RPM and efficiency.</strong></p>

<p style="margin:18px 0 6px;font-weight:600;">Flexible &amp; Simple</p>
<p>We believe trust is earned through results.</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>No forced long-term commitment</li>
<li>Flexible working arrangement</li>
<li>No unnecessary restrictions</li>
<li>Clear and transparent communication</li>
<li>Easy onboarding process</li>
</ul>

<p style="margin:18px 0 6px;font-weight:600;">Equipment We Support</p>
<p>We work with carriers operating:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>Dry Vans</li>
<li>Reefers</li>
<li>Flatbeds</li>
<li>Step Decks</li>
<li>Power Only</li>
<li>Box Trucks</li>
<li>Hotshots</li>
<li>Cargo Vans</li>
<li>Sprinter Vans</li>
</ul>
<p>We can help identify freight opportunities based on your equipment, location, preferred lanes, and availability.</p>

<p style="margin:18px 0 6px;font-weight:600;">Documents Needed to Get Started</p>
<p>To complete carrier onboarding and prepare for dispatch operations, we typically require:</p>
<ul style="margin:0 0 14px;padding-left:22px;">
<li>MC Authority</li>
<li>W-9 Form</li>
<li>Certificate of Insurance</li>
<li>Notice of Assignment (if using a factoring company)</li>
<li>Voided Check, where applicable</li>
</ul>
<p>These documents are used for carrier onboarding, broker/load setup, and required verification processes.</p>

<p style="margin:18px 0 6px;font-weight:600;">Why LaneForge?</p>
<p><strong>Better freight opportunities. Lower deadhead. Stronger lane planning. More time saved. Better home-time planning.</strong></p>
<p>You shouldn’t have to choose between making money and having a life outside the truck.</p>
<p>At <strong>LaneForge Dispatch</strong>, our goal is to help you work toward both.</p>

<p>{{personalized_closing}}</p>

<p>We look forward to working with you.</p>

<p>Best regards,</p>`,
  test_email: 'ahmadjutt463@gmail.com',
  sample_contact: {
    first_name: 'Sherika',
    last_name: 'Rogers',
    name: 'Sherika Rogers',
    title: 'Owner',
    company: 'Inna Gee 365 LLC',
    city: 'Portsmouth',
    country: 'VA',
    industry: 'Motor Carrier of Property',
    company_profile: 'Owner-operator trucking company focused on dry van freight.',
    website: '',
    linkedin: '',
    email: 'innagee365@outlook.com',
    dot: '1234567',
  },
};

const FOLLOW_UP_EMAIL = {
  id: 'follow-up',
  version: 3,
  name: 'LaneForge Follow-up — gentle nudge',
  subject: '{{first_name}}, quick follow-up from LaneForge Dispatch',
  preheader: '',
  body_html: `<p>Hi {{first_name}},</p>

<p>I wanted to follow up briefly on my earlier note about LaneForge Dispatch — better-paying freight, less deadhead, and planned Friday home time.</p>

<p>{{personalized_closing}}</p>

<p>Best regards,</p>`,
};

const TEMPLATES = { default: DEFAULT_EMAIL, 'job-outreach': DEFAULT_EMAIL, 'follow-up': FOLLOW_UP_EMAIL };

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.default;
}

function listTemplates() {
  return [
    { id: 'default', name: DEFAULT_EMAIL.name, subject: DEFAULT_EMAIL.subject },
    { id: 'follow-up', name: FOLLOW_UP_EMAIL.name, subject: FOLLOW_UP_EMAIL.subject },
  ];
}

module.exports = { getTemplate, listTemplates, DEFAULT_EMAIL, FOLLOW_UP_EMAIL };
