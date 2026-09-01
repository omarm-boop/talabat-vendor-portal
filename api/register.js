const { google } = require('googleapis');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const VENDOR_DB_SHEET_ID = '1bhCkMlLw4vJM23NBe8jNkNcatL3RAbj9qLh0b04S6ps';
const CREDENTIALS_TAB    = 'Credentials';
const VENDOR_DB_TAB      = 'Restaurants Management Link';

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
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── @talabat.com: internal team self-registration ─────────────────────────
    if (String(vendorId).toLowerCase().trim().endsWith('@talabat.com')) {
      const email = String(vendorId).toLowerCase().trim();

      // Check not already registered
      const existingResp = await sheets.spreadsheets.values.get({
        spreadsheetId: TRACKING_SHEET_ID,
        range: `${CREDENTIALS_TAB}!A:A`,
      });
      const existingIds = (existingResp.data.values || []).flat().map(v => String(v).toLowerCase().trim());
      if (existingIds.includes(email))
        return res.status(409).json({ error: 'This email is already registered. Please log in instead.' });

      const now = new Date().toISOString();
      await sheets.spreadsheets.values.append({
        spreadsheetId: TRACKING_SHEET_ID,
        range: `${CREDENTIALS_TAB}!A:F`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[email, password, '0', 'Talabat', 'agent', now]] },
      });

      return res.json({
        success: true,
        vendor: { vendorId: email, name: email, role: 'agent', chainId: '0', chainName: 'Talabat', branchName: 'Admin Panel' },
      });
    }

    // 1. Validate Vendor ID exists in the vendor DB
    const dbResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: VENDOR_DB_SHEET_ID,
      range: VENDOR_DB_TAB,
    });

    const dbValues = dbResponse.data.values || [];
    if (dbValues.length < 2)
      return res.status(500).json({ error: 'Vendor database unavailable. Contact support.' });

    const dbHeaders = dbValues[0];
    const dbRows    = dbValues.slice(1);

    let vendorInfo = null;
    for (const row of dbRows) {
      const obj = {};
      dbHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      if (String(obj['Vendor Id']).trim() === String(vendorId).trim()) {
        vendorInfo = obj;
        break;
      }
    }

    if (!vendorInfo)
      return res.status(404).json({ error: 'Vendor ID not found. Please check your Branch ID and try again.' });

    // 2. Check not already registered
    const credsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: TRACKING_SHEET_ID,
      range: CREDENTIALS_TAB,
    });

    const credsValues = credsResponse.data.values || [];
    if (credsValues.length > 1) {
      const credsHeaders = credsValues[0];
      const credsRows    = credsValues.slice(1);
      const exists = credsRows.some(row => {
        const obj = {};
        credsHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
        return String(obj['Vendor ID']).trim() === String(vendorId).trim();
      });
      if (exists)
        return res.status(409).json({ error: 'This Vendor ID is already registered. Please log in instead.' });
    }

    // 3. Save new credentials
    const now = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          String(vendorId).trim(),
          password,
          vendorInfo['Chain ID'],
          vendorInfo['Chain Name'],
          vendorInfo['Vendor Name (English)'],
          now,
        ]],
      },
    });

    return res.json({
      success: true,
      vendor: {
        vendorId:   String(vendorId).trim(),
        chainId:    vendorInfo['Chain ID'],
        chainName:  vendorInfo['Chain Name'],
        branchName: vendorInfo['Vendor Name (English)'],
      },
    });

  } catch (err) {
    console.error('register.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
