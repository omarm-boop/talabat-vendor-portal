const zlib = require('zlib');

// Upstash (Free plan) refuses any single request over 10 MB, and whole Google Sheets cached as JSON can get that big.
// Values are gzipped (stored as base64 with a "gz1:" prefix) and, if still large, split into 4 MB pieces
// (<key>:part:0, :part:1, ...) with a small "gzparts:<n>" marker stored under <key> itself.
const CHUNK = 4 * 1024 * 1024;
const MAX_PARTS = 20; // 80 MB compressed: beyond this the sheet is not cached at all

function pack(value) {
  return 'gz1:' + zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
}

// Reads the gzipped format and also the older plain JSON / object formats.
function unpack(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    if (raw.startsWith('gz1:')) return JSON.parse(zlib.gunzipSync(Buffer.from(raw.slice(4), 'base64')).toString());
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
  return raw;
}

async function setPacked(redis, key, value, opts) {
  const packed = pack(value);
  const parts = Math.ceil(packed.length / CHUNK);
  if (parts > MAX_PARTS) {
    console.warn(`cache: "${key}" is ${(packed.length / 1048576).toFixed(1)} MB even compressed - not cached`);
    return null;
  }
  if (parts <= 1) return redis.set(key, packed, opts);
  await Promise.all(Array.from({ length: parts }, (_, i) =>
    redis.set(`${key}:part:${i}`, packed.slice(i * CHUNK, (i + 1) * CHUNK), opts)));
  return redis.set(key, 'gzparts:' + parts, opts); // marker last, so readers never see it before the parts exist
}

// Returns the cached value, or null when missing, expired or incomplete.
async function getPacked(redis, key) {
  const raw = await redis.get(key);
  if (typeof raw === 'string' && raw.startsWith('gzparts:')) {
    const n = parseInt(raw.slice(8), 10);
    if (!(n > 0 && n <= MAX_PARTS)) return null;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => redis.get(`${key}:part:${i}`)));
    if (parts.some(p => typeof p !== 'string')) return null;
    return unpack(parts.join(''));
  }
  return unpack(raw);
}

module.exports = { pack, unpack, setPacked, getPacked };
