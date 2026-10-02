// Key/value store in Supabase (table: dashboard_store) for OTB snapshots, targets and the cached dashboard.
// Uses the Supabase REST API with the service role key, so it only ever runs on the server.
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);
const memory = {}; // fallback when Supabase isn't configured (nothing is kept between visits)

const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

async function get(key) {
  if (!enabled) return memory[key] ?? null;
  const res = await fetch(`${URL_}/rest/v1/dashboard_store?key=eq.${encodeURIComponent(key)}&select=value`, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return rows[0]?.value ?? null;
}

async function set(key, value) {
  if (!enabled) { memory[key] = value; return; }
  const res = await fetch(`${URL_}/rest/v1/dashboard_store?on_conflict=key`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${res.status}): ${await res.text()}`);
}

module.exports = { get, set, enabled };
