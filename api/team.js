const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');

const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDS_TAB = 'Credentials';

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!await verifyRequest(req)) return res.status(401).json({ error: 'Unauthorized' });

  const names = new Set();

  // From TEAM_CREDENTIALS env var (pre-configured accounts)
  try {
    const team = JSON.parse(process.env.TEAM_CREDENTIALS || '[]');
    team.forEach(m => { if (m.name) names.add(m.name); else if (m.email) names.add(m.email); });
  } catch (_) {}

  // From Credentials sheet — rows where chainId col C = '0'
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CREDS_TAB}!A:F`,
    });
    const rows = resp.data.values || [];
    for (const row of rows.slice(1)) {
      const colC = (row[2] || '').trim();
      if (colC !== '0') continue;
      const colA = (row[0] || '').trim();   // email
      const colD = (row[3] || '').trim();   // display name (stored by register.js)
      const display = (colD && colD !== 'Talabat') ? colD : colA;
      if (display) names.add(display);
    }
  } catch (_) {}

  return res.json({ names: [...names] });
};
