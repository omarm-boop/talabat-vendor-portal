const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');

const SHEET_ID     = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB          = 'Sheet1';
const CORS_HEADERS = 'Content-Type, X-Portal-Email, X-Portal-Role, X-Portal-Ts, X-Portal-Token';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyRequest(req))     return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const { rowIndex, status, rejectionReason } = body || {};
  if (!rowIndex || !status)
    return res.status(400).json({ error: 'rowIndex and status are required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Column T = Status, Column V = Reason (T and V are not adjacent so two calls)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!T${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!V${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[rejectionReason || '']] },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('update-status.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
