const DEFAULT_EMAIL = {
  id: 'default',
  version: 12,
  name: 'Ahmad Yaseen - Senior Software Developer (IoT, AI, Embedded, Full Stack)',
  subject: 'Quick note for {{first_name}} at {{company}}',
  preheader: '',
  body_html: `<p>Hi {{first_name}},</p>

<p>{{personalized_opener}}</p>

<p>I am reaching out about senior engineering roles focused on embedded systems, IoT, AI, full-stack development, robotics, backend engineering, cloud architecture, and scalable software systems.</p>

<p>I am a Senior Software Developer with 5+ years of experience building production-grade embedded, AI-enabled, cloud-connected, and real-time software systems. I would describe myself as a jack of sundry trades rather than a master of one, which has helped me work across firmware, AI, IoT, backend, and full-stack layers on the same product without waiting on handoffs.</p>

<p>My background covers firmware, hardware automation, IoT platforms, AI and computer vision pipelines, WebRTC, backend services, cloud architecture, and distributed systems. I am especially interested in roles that sit at the intersection of embedded hardware and AI, where software needs to be reliable on the device and useful in the cloud.</p>

<p style="margin:18px 0 6px;">Embedded and firmware</p>
<ul style="margin-top:0;padding-left:22px;">
<li>C++17/20, Embedded C, Python, RTOS, Zephyr, Embedded Linux, ARM Cortex-M, nRF52840, STM32, ESP32, Raspberry Pi</li>
</ul>

<p style="margin:18px 0 6px;">IoT and communication</p>
<ul style="margin-top:0;padding-left:22px;">
<li>BLE, MQTT, MQTT-SN, WebRTC, CAN Bus, Modbus, UART, SPI, I2C, USB HID, HTTP/HTTPS, TCP/IP, WebSockets, GSM/4G</li>
</ul>

<p style="margin:18px 0 6px;">AI, machine vision, and automation</p>
<ul style="margin-top:0;padding-left:22px;">
<li>OpenCV, OCR, template matching, edge inference, image-based analysis, hardware-in-the-loop testing, GPIO control, power cycling, multi-device orchestration, autonomous test flows, computer vision for inspection, rule-based and ML-assisted decision logic, automated fault detection, data pipelines for model-ready datasets, practical AI on constrained devices where latency and reliability matter</li>
</ul>

<p style="margin:18px 0 6px;">Backend, cloud, and DevOps</p>
<ul style="margin-top:0;padding-left:22px;">
<li>AWS, Azure, Oracle Cloud, Docker, Jenkins, GitHub Actions, PostgreSQL, REST APIs, Grafana, scalable backend architecture, real-time telemetry pipelines</li>
</ul>

<p style="margin:18px 0 6px;">Security and system design</p>
<ul style="margin-top:0;padding-left:22px;">
<li>Secure BLE pairing, encrypted communication, OTA updates, geofencing, fault-tolerant firmware, scalable device-cloud architecture</li>
</ul>

<p>Beyond full-time engineering roles, I also help teams with web platforms, APIs, dashboards, or internal tools when build capacity is useful. I keep handoffs simple and pass along full source code and documentation so your team owns what we build.</p>

<p>I am looking for a remote engineering role and can align my working hours with your team in {{location}}. Happy to adjust for your timezone so collaboration stays easy.</p>

<p>{{personalized_closing}}</p>

<p>My resume is attached. If a short call would be useful: calendly.com/ahmadrandhawa01/30min</p>

<p>Thank you for your time, {{first_name}}.</p>

<p>Best regards,<br>
Ahmad Yaseen<br>
Senior Software Developer | IoT, AI, Embedded and Full Stack Engineer<br>
ahmadrandhawa01@gmail.com<br>
linkedin.com/in/ahmadyaseen1</p>`,
  test_email: 'ahmadjutt463@gmail.com',
  sample_contact: {
    first_name: 'Andrew',
    last_name: '',
    name: 'Andrew',
    title: 'Founder',
    company: 'Collier & Associates',
    city: 'Chicago',
    country: 'United States',
    industry: 'Professional Services',
    company_profile: 'Collier & Associates provides professional services and advisory support to growing organizations.',
    website: 'https://collier-example.com',
    linkedin: 'https://linkedin.com/in/andrew-example',
    email: 'andrew@example.com',
  },
};

const TEMPLATES = { default: DEFAULT_EMAIL, 'job-outreach': DEFAULT_EMAIL };

function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.default;
}

function listTemplates() {
  return [{ id: 'default', name: DEFAULT_EMAIL.name, subject: DEFAULT_EMAIL.subject }];
}

module.exports = { getTemplate, listTemplates, DEFAULT_EMAIL };
