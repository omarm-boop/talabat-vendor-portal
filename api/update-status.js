const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

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

    // Column M = Status, Column N = Rejection Reason
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!M${rowIndex}:N${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status, rejectionReason || '']] },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('update-status.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
