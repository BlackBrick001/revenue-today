const { build } = require('../lib/dashboard');

// Called by Vercel Cron every night (see vercel.json) to save the end-of-day OTB snapshot.
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await build(true);
    res.status(200).json({ ok: true, snapshotFor: data.today });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
