// Optional password: set APP_PASSWORD in Vercel to require it (any username).
module.exports = function requirePassword(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const [, b64 = ''] = (req.headers.authorization || '').split(' ');
  const given = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':');
  if (given === pw) return true;
  res.setHeader('WWW-Authenticate', 'Basic realm="Revenue Today"');
  res.status(401).json({ error: 'Password required' });
  return false;
};
