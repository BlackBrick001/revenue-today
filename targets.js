const { setTargets } = require('../lib/dashboard');
const requirePassword = require('../lib/auth');

// POST /api/targets  { "month": "2026-10", "values": { "Sandton 1": 900000 } }
module.exports = async (req, res) => {
  if (!requirePassword(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { month, values } = req.body || {};
    if (!/^\d{4}-\d{2}$/.test(month || '') || !values || typeof values !== 'object') {
      return res.status(400).json({ error: 'month and values required' });
    }
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' || v === null ? null : Number(v)]));
    res.status(200).json(await setTargets(month, clean));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
