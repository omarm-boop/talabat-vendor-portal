const crypto  = require('crypto');
const { google } = require('googleapis');
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

    // Try to email the code to the vendor's real address (non-fatal if it fails)
    let emailSent = false;
    try {
      emailSent = await sendResetEmail(key, token);
    } catch (e) {
      console.error('reset email error (non-fatal):', e.message);
    }

    return res.json({ token, emailSent });
  } catch (err) {
    console.error('reset-token error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

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

};
