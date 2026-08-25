const crypto = require('crypto');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '8888';
const AUTH_SECRET = process.env.AUTH_SECRET || `reachly-${DASHBOARD_PASSWORD}`;
const COOKIE_NAME = 'reachly_auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function isProduction() {
  return Boolean(
    process.env.VERCEL
    || process.env.RAILWAY_ENVIRONMENT
    || process.env.NODE_ENV === 'production'
  );
}

function makeAuthToken() {
  return crypto.createHmac('sha256', AUTH_SECRET).update(DASHBOARD_PASSWORD).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return key ? [key, decodeURIComponent(value.join('='))] : [];
    }).filter(([key]) => key)
  );
}

function isAuthenticated(req) {
  return parseCookies(req)[COOKIE_NAME] === makeAuthToken();
}

function isPublicPath(req) {
  const { path, method } = req;
  if (path === '/login' || path === '/login.html') return true;
  if (path === '/api/auth/login' && method === 'POST') return true;
  if (path === '/api/auth/status' && method === 'GET') return true;
  if (method === 'GET' && path.startsWith('/css/')) return true;
  return false;
}

function requireAuth(req, res, next) {
  if (isPublicPath(req) || isAuthenticated(req)) return next();

  if (pathStartsWithApi(req.path)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return res.redirect('/login');
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

function pathStartsWithApi(path) {
  return path === '/api' || path.startsWith('/api/');
}

function buildCookie(value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

function setAuthCookie(res) {
  res.setHeader('Set-Cookie', buildCookie(makeAuthToken(), Math.floor(COOKIE_MAX_AGE / 1000)));
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', buildCookie('', 0));
}

function verifyPassword(password) {
  return password === DASHBOARD_PASSWORD;
}

module.exports = {
  requireAuth,
  isAuthenticated,
  setAuthCookie,
  clearAuthCookie,
  verifyPassword,
};
