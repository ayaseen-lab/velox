const { createClient } = require('@supabase/supabase-js');

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getSupabaseAnonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const serviceRole = getSupabaseServiceRoleKey();
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getSupabaseAuthClient() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getPublicAuthConfig() {
  if (!isSupabaseConfigured()) return { mode: 'password' };
  return {
    mode: 'supabase',
    supabaseUrl: getSupabaseUrl(),
    supabaseAnonKey: getSupabaseAnonKey(),
    adminEmail: process.env.REACHLY_ADMIN_EMAIL || 'reachly@xynovix.com',
  };
}

async function verifySupabaseAccessToken(accessToken) {
  const client = getSupabaseAuthClient();
  if (!client || !accessToken) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
}

module.exports = {
  isSupabaseConfigured,
  getSupabaseAdmin,
  getSupabaseAuthClient,
  getPublicAuthConfig,
  verifySupabaseAccessToken,
  getSupabaseUrl,
  getSupabaseAnonKey,
};
