const { google } = require('googleapis');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDENTIALS_TAB   = 'Credentials';

// Internal team bypass — not visible to vendors
const ADMINS = {
  'admin': { password: 'Admin2024!', chainName: 'Talabat', branchName: 'Admin Panel', chainId: '0' },
};

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
    return res.status(400).json({ error: 'Vendor ID and password are required' });

  // Admin bypass
  const admin = ADMINS[String(vendorId).toLowerCase()];
  if (admin && admin.password === password) {
    return res.json({ success: true, vendor: { vendorId, ...admin } });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

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
