const { Ratelimit } = require('@upstash/ratelimit');
const { Redis }     = require('@upstash/redis');

let ipLimiter = null;
let idLimiter = null;

function getLimiters() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!ipLimiter) {
    const redis = new Redis({ url, token });
    // 10 login attempts per IP per 15 minutes
    ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: 'rl:ip' });
    // 5 login attempts per identifier (email/chain-id) per 15 minutes
    idLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'),  prefix: 'rl:id' });
  }
  return { ipLimiter, idLimiter };
}

// Returns true if the request is allowed, false (and writes 429) if blocked.
// identifier = the login key being attempted (email or chain ID).
async function checkLoginLimit(req, res, identifier) {
  const limiters = getLimiters();
  if (!limiters) return true; // Upstash not configured — degrade gracefully

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';

  const [ipResult, idResult] = await Promise.all([
    limiters.ipLimiter.limit(`ip:${ip}`),
    limiters.idLimiter.limit(`id:${String(identifier).toLowerCase().trim()}`),
  ]);

  if (!ipResult.success || !idResult.success) {
    const retryAfterMs = Math.max(
      ipResult.success ? 0 : ipResult.reset - Date.now(),
      idResult.success ? 0 : idResult.reset - Date.now(),
    );
    res.setHeader('Retry-After', Math.max(1, Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
    return false;
  }
  return true;
}

// Looser limit for registration: 5 per IP per hour.
async function checkRegisterLimit(req, res) {
  const limiters = getLimiters();
  if (!limiters) return true;

  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  const limiter = new Ratelimit({
    redis: limiters.ipLimiter.redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'rl:reg',
  });

  const result = await limiter.limit(`reg:${ip}`);
  if (!result.success) {
    const retryAfterMs = result.reset - Date.now();
    res.setHeader('Retry-After', Math.max(1, Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
    return false;
  }
  return true;
}

module.exports = { checkLoginLimit, checkRegisterLimit };
