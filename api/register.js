const { google } = require('googleapis');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDENTIALS_TAB   = 'Credentials';

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

    const isTeam = String(vendorId).toLowerCase().trim().endsWith('@talabat.com');
    const id     = isTeam ? String(vendorId).toLowerCase().trim() : String(vendorId).trim();

    // Check not already registered
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!A:A`,
    });
    const existingIds = (existing.data.values || []).flat().map(v => String(v).toLowerCase().trim());
    if (existingIds.includes(id.toLowerCase())) {
      return res.status(409).json({
        error: isTeam
          ? 'This email is already registered. Please log in instead.'
          : 'This Vendor ID is already registered. Please log in instead.',
      });
    }

    const now = new Date().toISOString();

    if (isTeam) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: TRACKING_SHEET_ID,
        range: `${CREDENTIALS_TAB}!A:F`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[id, password, '0', 'Talabat', 'agent', now]] },
      });
      return res.json({
        success: true,
        vendor: { vendorId: id, name: id, role: 'agent', chainId: '0', chainName: 'Talabat', branchName: 'Admin Panel' },
      });
    }

    // Vendor: save with empty chain/branch info (filled later from vendor DB if needed)
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[id, password, '', '', '', now]] },
    });

    return res.json({
      success: true,
      vendor: { vendorId: id, chainId: '', chainName: '', branchName: '' },
    });

  } catch (err) {
    console.error('register.js error:', err.message);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
