const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT || '';
  if (!raw) return res.json({ step: 'env', ok: false, error: 'GOOGLE_SERVICE_ACCOUNT is not set' });

  let creds;
  try { creds = JSON.parse(raw); } catch(e) {
    return res.json({ step: 'parse', ok: false, error: e.message, envLen: raw.length });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ',
      range: 'Credentials!A1:A1',
    });
    return res.json({ step: 'api', ok: true, value: (resp.data.values || [[]])[0][0] });
  } catch(err) {
    return res.json({
      step: 'api', ok: false,
      error: err.message,
      email: creds.client_email || 'MISSING',
      type: creds.type || 'MISSING',
      envLen: raw.length,
    });
  }
};
