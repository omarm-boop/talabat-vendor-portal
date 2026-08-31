const { google } = require('googleapis');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDENTIALS_TAB   = 'Credentials';
const TEAM_TAB          = 'Team';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { vendorId, password } = body || {};

  if (!vendorId || !password)
    return res.status(400).json({ error: 'Email / Vendor ID and password are required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Internal team: @talabat.com emails → check Team tab ──────────────────
    if (String(vendorId).toLowerCase().trim().endsWith('@talabat.com')) {
      let teamValues = [];
      try {
        const teamResp = await sheets.spreadsheets.values.get({
          spreadsheetId: TRACKING_SHEET_ID,
          range: TEAM_TAB,
        });
        teamValues = teamResp.data.values || [];
      } catch(_) {
        return res.status(500).json({ error: 'Team tab not found in the sheet. Please set it up.' });
      }

      if (teamValues.length < 2)
        return res.status(401).json({ error: 'No team accounts configured yet.' });

      const headers = teamValues[0].map(h => String(h).trim());
      const rows    = teamValues.slice(1);
      let matched   = null;
      for (const row of rows) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        if (String(obj['Email']).toLowerCase().trim() === String(vendorId).toLowerCase().trim() &&
            obj['Password'] === password) {
          matched = obj;
          break;
        }
      }

      if (!matched)
        return res.status(401).json({ error: 'Incorrect email or password.' });

      return res.json({
        success: true,
        vendor: {
          vendorId:   matched['Email'],
          name:       matched['Name']  || matched['Email'],
          role:       (matched['Role'] || 'agent').toLowerCase(),
          chainId:    '0',
          chainName:  'Talabat',
          branchName: 'Admin Panel',
        },
      });
    }

    // ── Regular vendor: check Credentials tab ─────────────────────────────────
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: TRACKING_SHEET_ID,
      range: CREDENTIALS_TAB,
    });

    const values = response.data.values || [];
    if (values.length < 2)
      return res.status(401).json({ error: 'No accounts found. Please sign up first.' });

    const headers = values[0];
    const rows    = values.slice(1);

    let matched = null;
    for (const row of rows) {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      if (String(obj['Vendor ID']).trim() === String(vendorId).trim() &&
          obj['Password'] === password) {
        matched = obj;
        break;
      }
    }

    if (!matched)
      return res.status(401).json({ error: 'Incorrect Vendor ID or password.' });

    return res.json({
      success: true,
      vendor: {
        vendorId:   matched['Vendor ID'],
        chainId:    matched['Chain ID'],
        chainName:  matched['Chain Name'],
        branchName: matched['Branch Name'],
      },
    });

  } catch (err) {
    console.error('auth.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
