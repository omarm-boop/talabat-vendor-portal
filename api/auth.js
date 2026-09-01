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

    // ── Internal team: @talabat.com emails ───────────────────────────────────
    if (String(vendorId).toLowerCase().trim().endsWith('@talabat.com')) {
      const email = String(vendorId).toLowerCase().trim();

      // 1. Check TEAM_CREDENTIALS env var (pre-configured accounts, e.g. monitor)
      let team = [];
      try { team = JSON.parse(process.env.TEAM_CREDENTIALS || '[]'); } catch(_) {}
      const envMatch = team.find(
        m => String(m.email).toLowerCase().trim() === email && m.password === password
      );
      if (envMatch) {
        return res.json({
          success: true,
          vendor: {
            vendorId:   envMatch.email,
            name:       envMatch.name || envMatch.email,
            role:       (envMatch.role || 'agent').toLowerCase(),
            chainId:    '0',
            chainName:  'Talabat',
            branchName: 'Admin Panel',
          },
        });
      }

      // 2. Check Credentials tab for self-registered agents (chainId = '0')
      const credsResp = await sheets.spreadsheets.values.get({
        spreadsheetId: TRACKING_SHEET_ID,
        range: CREDENTIALS_TAB,
      });
      const credsValues = credsResp.data.values || [];
      if (credsValues.length > 1) {
        const headers = credsValues[0];
        for (const row of credsValues.slice(1)) {
          const obj = {};
          headers.forEach((h, i) => { obj[h] = row[i] || ''; });
          if (String(obj['Vendor ID']).toLowerCase().trim() === email
              && obj['Password'] === password
              && String(obj['Chain ID']).trim() === '0') {
            return res.json({
              success: true,
              vendor: {
                vendorId:   obj['Vendor ID'],
                name:       obj['Vendor ID'],
                role:       obj['Branch Name'] || 'agent',
                chainId:    '0',
                chainName:  'Talabat',
                branchName: 'Admin Panel',
              },
            });
          }
        }
      }

      return res.status(401).json({ error: 'Incorrect email or password.' });
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
