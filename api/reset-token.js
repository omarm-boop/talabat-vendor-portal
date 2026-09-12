const crypto  = require('crypto');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { Redis }   = require('@upstash/redis');

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sess = await verifyRequest(req);
  if (!sess || sess.role !== 'monitor') return res.status(403).json({ error: 'Monitor access required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { vendorId } = body || {};
  if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

  const token = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6-char hex code
  const key   = String(vendorId).toLowerCase().trim();

  try {
    await getRedis().set(`reset:${key}`, token, { ex: 3600 }); // 1 hour TTL
    return res.json({ token });
  } catch (err) {
    console.error('reset-token error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
