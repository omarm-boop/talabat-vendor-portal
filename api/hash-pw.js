const bcrypt = require('bcryptjs');
const { verifyRequest } = require('../lib/verify');

const CORS_HEADERS = 'Content-Type, X-Portal-Email, X-Portal-Role, X-Portal-Ts, X-Portal-Token';

// TEMPORARY endpoint — delete after updating TEAM_CREDENTIALS in Vercel.
// Requires a valid monitor session token.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const sess = verifyRequest(req);
  if (!sess || sess.role !== 'monitor') return res.status(401).json({ error: 'Monitor access required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { password } = body || {};
  if (!password) return res.status(400).json({ error: 'password required' });

  const hash = await bcrypt.hash(password, 10);
  return res.json({ hash });
};
