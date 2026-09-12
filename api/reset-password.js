const { google }  = require('googleapis');
const bcrypt      = require('bcryptjs');
const { setCors } = require('../lib/cors');
const { Redis }   = require('@upstash/redis');

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

  if (!vendorId || !token || !newPassword)
    return res.status(400).json({ error: 'vendorId, token, and newPassword are required' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const key = String(vendorId).toLowerCase().trim();

  try {
    const stored = await getRedis().get(`reset:${key}`);
    if (!stored || String(stored).toUpperCase() !== token.toUpperCase().trim()) {
      return res.status(400).json({ error: 'Invalid or expired reset code. Ask your admin for a new one.' });
    }

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CREDS_TAB}!A:C`,
    });

    const rows = resp.data.values || [];
    let rowNum = -1;
    for (let i = 1; i < rows.length; i++) {
      const colA = String(rows[i][0] || '').toLowerCase().trim();
      const colC = String(rows[i][2] || '').toLowerCase().trim();
      if (colA === key || colC === key) { rowNum = i + 1; break; }
    }

    if (rowNum === -1)
      return res.status(404).json({ error: 'Vendor not found. Check your Chain ID.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range:         `${CREDS_TAB}!B${rowNum}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[hashed]] },
    });

    await getRedis().del(`reset:${key}`); // single-use token
    return res.json({ success: true });
  } catch (err) {
    console.error('reset-password error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
