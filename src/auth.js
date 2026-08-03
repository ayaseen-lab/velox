const crypto = require('crypto');
const { isSupabaseConfigured, verifySupabaseAccessToken } = require('./supabase');

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '8888';
const AUTH_SECRET = process.env.AUTH_SECRET || `reachly-${DASHBOARD_PASSWORD}`;
const PASSWORD_COOKIE = 'reachly_auth';
const SUPABASE_COOKIE = 'reachly_sb_session';
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

async function isAuthenticated(req) {
  const cookies = parseCookies(req);

  if (cookies[PASSWORD_COOKIE] === makeAuthToken()) {
    return true;
  }

  const supabaseToken = cookies[SUPABASE_COOKIE];
  if (supabaseToken && isSupabaseConfigured()) {
    const user = await verifySupabaseAccessToken(supabaseToken);
    return Boolean(user);
  }

  return false;
}

function isPublicPath(req) {
  const { path, method } = req;
  if (path === '/login' || path === '/login.html') return true;
  if (path === '/api/auth/login' && method === 'POST') return true;
  if (path === '/api/auth/supabase' && method === 'POST') return true;
  if (path === '/api/auth/status' && method === 'GET') return true;
  if (path === '/api/auth/config' && method === 'GET') return true;
  if (method === 'GET' && path.startsWith('/css/')) return true;
  return false;
}

async function requireAuth(req, res, next) {
  try {
    if (isPublicPath(req) || await isAuthenticated(req)) return next();

    if (pathStartsWithApi(req.path)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET') {
      return res.redirect('/login');
    }

    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication check failed' });
  }
}

function pathStartsWithApi(path) {
  return path === '/api' || path.startsWith('/api/');
}

function buildCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

function setPasswordCookie(res) {
  res.setHeader('Set-Cookie', buildCookie(PASSWORD_COOKIE, makeAuthToken(), Math.floor(COOKIE_MAX_AGE / 1000)));
}

function setSupabaseCookie(res, accessToken) {
  res.setHeader('Set-Cookie', [
    buildCookie(SUPABASE_COOKIE, accessToken, Math.floor(COOKIE_MAX_AGE / 1000)),
    buildCookie(PASSWORD_COOKIE, '', 0),
  ]);
}

function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    buildCookie(PASSWORD_COOKIE, '', 0),
    buildCookie(SUPABASE_COOKIE, '', 0),
  ]);
}

function verifyPassword(password) {
  return password === DASHBOARD_PASSWORD;
}

module.exports = {
  requireAuth,
  isAuthenticated,
  setPasswordCookie,
  setSupabaseCookie,
  clearAuthCookies,
  verifyPassword,
};
