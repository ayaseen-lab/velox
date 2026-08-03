/**
 * Create the Reachly admin user in Supabase Auth.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * Usage: node scripts/setup-supabase-user.js
 */
require('dotenv').config();
const { getSupabaseAdmin } = require('../src/supabase');

const email = process.env.REACHLY_ADMIN_EMAIL || 'reachly@xynovix.com';
const password = process.env.DASHBOARD_PASSWORD || '8888';

async function main() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const { data: existing, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;

  const found = existing.users.find((user) => user.email === email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, {
      password,
      email_confirm: true,
    });
    console.log(`Updated Supabase user: ${email}`);
    return;
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Created Supabase user: ${email}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
