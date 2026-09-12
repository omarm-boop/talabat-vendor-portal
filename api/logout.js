const { revokeToken } = require('../lib/revoke');
const { setCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = (req.headers['x-portal-token'] || '').trim();
  if (sig) await revokeToken(sig);

  return res.json({ success: true });
};
