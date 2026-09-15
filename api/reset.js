const crypto  = require('crypto');
const { google }  = require('googleapis');
const bcrypt      = require('bcryptjs');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { Redis }   = require('@upstash/redis');
const { sendEmail } = require('../lib/email');

const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDS_TAB = 'Credentials';

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { vendorId, token, newPassword } = body || {};

  // ── RESET PASSWORD (public: vendorId + token + newPassword) ──────────────
  if (token && newPassword) {
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const key = String(vendorId).toLowerCase().trim();
    try {
      const stored = await getRedis().get(`reset:${key}`);
      if (!stored || String(stored).toUpperCase() !== token.toUpperCase().trim()) {
        return res.status(400).json({ error: 'Invalid or expired reset code. Ask your admin for a new one.' });
      }

      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const sheets = google.sheets({ version: 'v4', auth });

      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CREDS_TAB}!A:C` });
      const rows = resp.data.values || [];
      let rowNum = -1;
      for (let i = 1; i < rows.length; i++) {
        const colA = String(rows[i][0] || '').toLowerCase().trim();
        const colC = String(rows[i][2] || '').toLowerCase().trim();
        if (colA === key || colC === key) { rowNum = i + 1; break; }
      }
      if (rowNum === -1) return res.status(404).json({ error: 'Vendor not found. Check your Chain ID.' });

      const hashed = await bcrypt.hash(newPassword, 10);
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${CREDS_TAB}!B${rowNum}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[hashed]] },
      });

      await getRedis().del(`reset:${key}`);
      return res.json({ success: true });
    } catch (err) {
      console.error('reset password error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // ── GENERATE TOKEN (monitor-only: vendorId only) ──────────────────────────
  if (!vendorId) return res.status(400).json({ error: 'vendorId required' });

  const sess = await verifyRequest(req);
  if (!sess || sess.role !== 'monitor') return res.status(403).json({ error: 'Monitor access required' });

  const resetToken = crypto.randomBytes(3).toString('hex').toUpperCase();
  const key = String(vendorId).toLowerCase().trim();

  try {
    await getRedis().set(`reset:${key}`, resetToken, { ex: 3600 });

    let emailSent = false;
    try { emailSent = await sendResetEmail(key, resetToken); } catch(e) {
      console.error('reset email error (non-fatal):', e.message);
    }

    return res.json({ token: resetToken, emailSent });
  } catch (err) {
    console.error('reset-token error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

async function sendResetEmail(vendorKey, token) {
  if (!process.env.RESEND_API_KEY || !process.env.GOOGLE_SERVICE_ACCOUNT) return false;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CREDS_TAB}!A:C` });
  const rows = (resp.data.values || []).slice(1);
  const row  = rows.find(r =>
    String(r[0] || '').toLowerCase().trim() === vendorKey ||
    String(r[2] || '').toLowerCase().trim() === vendorKey
  );
  const email = row ? String(row[2] || '').trim() : '';
  if (!email || !email.includes('@')) return false;

  return sendEmail(
    email,
    'Your password reset code',
    `<p>Your one-time password reset code is:</p>
     <p style="font-size:32px;font-weight:900;letter-spacing:8px;color:#FF5900">${token}</p>
     <p>This code expires in <strong>1 hour</strong> and can only be used once.</p>
     <p style="color:#888;font-size:12px">If you did not request this, ignore this email.</p>`
  );
}
