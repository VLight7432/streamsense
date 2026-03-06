const { getSupabaseClient } = require('../connectors/supabaseClient');

async function listStreams() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('streams')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[StreamSense] Erreur Supabase (streams):', error);
    return [];
  }

  // Adapter au format interne si besoin
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  }));
}

module.exports = {
  listStreams,
};
