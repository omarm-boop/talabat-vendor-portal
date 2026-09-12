const crypto = require('crypto');

function signToken(email, role, ts) {
  const secret = process.env.PORTAL_SECRET;
  if (!secret) throw new Error('PORTAL_SECRET env var is not set — add it in Vercel settings');
  return crypto.createHmac('sha256', secret)
    .update(`${email}:${role}:${ts}`)
    .digest('hex');
}

function verifyRequest(req) {
  const email = (req.headers['x-portal-email'] || '').toLowerCase().trim();
  const role  = (req.headers['x-portal-role']  || '').toLowerCase().trim();
  const ts    = (req.headers['x-portal-ts']    || '');
  const sig   = (req.headers['x-portal-token'] || '');
  if (!email || !role || !ts || !sig) return null;
  try {
    const expected = signToken(email, role, ts);
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch (_) { return null; }
  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > 8 * 3600 * 1000) return null;
  return { email, role };
}

module.exports = { signToken, verifyRequest };
