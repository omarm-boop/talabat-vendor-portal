const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB_NAME = 'Sheet1';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: TAB_NAME,
    });

    const values = response.data.values || [];
    if (values.length < 2) return res.json({ data: [] });

    const headers = values[0].map(h => String(h).trim());
    const dataRows = values.slice(1);

    let rows = dataRows.map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });

    const email = (req.query.email || '').toLowerCase().trim();
    if (email) {
      rows = rows.filter(r =>
        String(r['Email Address'] || '').toLowerCase().trim() === email
      );
    }

    return res.json({ data: rows });

  } catch (err) {
    console.error('requests.js error:', err.message);
    return res.status(500).json({ error: err.message, data: [] });
  }
};
