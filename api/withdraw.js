const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { Redis } = require('@upstash/redis');

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { rowIndex } = body || {};
  if (!rowIndex) return res.status(400).json({ error: 'rowIndex required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read the row to verify ownership and current status
    const peek = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A${rowIndex}:T${rowIndex}`,
    });
    const row       = (peek.data.values || [[]])[0] || [];
    const rowEmail  = String(row[9]  || '').toLowerCase().trim(); // col J = vendor email
    const rowStatus = String(row[19] || '').toLowerCase().trim(); // col T = status

    // Vendor may only withdraw their own rows
    if (rowEmail !== sess.email.toLowerCase().trim()) {
      return res.status(403).json({ error: 'Forbidden: this request does not belong to your account' });
    }
    // Only Pending requests can be withdrawn
    if (rowStatus !== 'pending' && rowStatus !== '') {
      return res.status(409).json({ error: 'Only Pending requests can be withdrawn' });
    }

    const now = new Date().toISOString();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TAB}!T${rowIndex}`, values: [['Withdrawn']] },
          { range: `${TAB}!Y${rowIndex}`, values: [[`${sess.email} → Withdrawn at ${now}`]] },
        ],
      },
    });

    if (process.env.UPSTASH_REDIS_REST_URL) getRedis().del('sheet:v1:all').catch(() => {});
    return res.json({ success: true });
  } catch (err) {
    console.error('withdraw.js error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
