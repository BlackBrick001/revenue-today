const { build } = require('../lib/dashboard');
const requirePassword = require('../lib/auth');

// GET /api/dashboard        -> cached dashboard data (max 10 minutes old)
// GET /api/dashboard?refresh=1 -> fetch fresh from Mews now
module.exports = async (req, res) => {
  if (!requirePassword(req, res)) return;
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await build(req.query.refresh === '1'));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
