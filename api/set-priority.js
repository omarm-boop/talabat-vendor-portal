const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const sess = verifyRequest(req);
  if (!sess || sess.role !== 'monitor') return res.status(401).json({ error: 'Monitor access required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { rowIndex, priority } = body || {};
  if (!rowIndex) return res.status(400).json({ error: 'rowIndex required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!X${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[priority ? 'high' : '']] },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('set-priority.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
