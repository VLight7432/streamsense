const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

let supabase = null;

function getSupabaseClient() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.warn('[StreamSense] Supabase non configuré (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants)');
    return null;
  }

  supabase = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabase;
}

module.exports = {
  getSupabaseClient,
};
