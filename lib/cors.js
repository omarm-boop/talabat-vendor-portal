const ALLOWED  = (process.env.PORTAL_ORIGIN || '').trim();
const HEADERS  = 'Content-Type, X-Portal-Email, X-Portal-Role, X-Portal-Ts, X-Portal-Token';

function setCors(req, res, methods) {
  const origin = (req.headers.origin || '').trim();
  // If PORTAL_ORIGIN is set, only reflect that exact origin; otherwise fall back to *
  const allow  = ALLOWED ? (origin === ALLOWED ? origin : '') : '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', methods || 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', HEADERS);
  if (ALLOWED) res.setHeader('Vary', 'Origin');
}

module.exports = { setCors };
