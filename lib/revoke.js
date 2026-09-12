const { Redis } = require('@upstash/redis');

let redis = null;

function getRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

async function revokeToken(sig) {
  if (!sig) return;
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`revoked:${sig}`, 1, { ex: 8 * 3600 });
  } catch (err) {
    console.error('revokeToken error:', err.message);
  }
}

// Returns true if the token is in the blocklist.
// Fails open (returns false) if Redis is unavailable — don't block legit users on Redis outage.
async function isRevoked(sig) {
  if (!sig) return false;
  const r = getRedis();
  if (!r) return false;
  try {
    return (await r.get(`revoked:${sig}`)) !== null;
  } catch (err) {
    console.error('isRevoked error:', err.message);
    return false;
  }
}

module.exports = { revokeToken, isRevoked };
