const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { signToken } = require('../lib/verify');

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
  const { vendorId, chainName, password } = body || {};
  const chainId = vendorId; // frontend sends Chain ID in the vendorId field

  if (!chainId || !password)
    return res.status(400).json({ error: 'Chain ID and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const isTeam = String(chainId).toLowerCase().trim().endsWith('@talabat.com');
    const id     = isTeam ? String(chainId).toLowerCase().trim() : String(chainId).trim();

    // Check not already registered (col A and col C)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!A:C`,
    });
    const existingRows = existing.data.values || [];
    const alreadyExists = existingRows.slice(1).some(row => {
      const colA = String(row[0] || '').toLowerCase().trim();
      const colC = String(row[2] || '').toLowerCase().trim();
      return colA === id.toLowerCase() || (colC && colC === id.toLowerCase());
    });
    if (alreadyExists) {
      return res.status(409).json({
        error: isTeam
          ? 'This email is already registered. Please log in instead.'
          : 'This Chain ID is already registered. Please log in instead.',
      });
    }

    const now    = new Date().toISOString();
    const hashed = await bcrypt.hash(password, 10);

    if (isTeam) {
      const displayName = (chainName && chainName.trim()) ? chainName.trim() : id;
      await sheets.spreadsheets.values.append({
        spreadsheetId: TRACKING_SHEET_ID,
        range: `${CREDENTIALS_TAB}!A:F`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[id, hashed, '0', displayName, 'agent', now]] },
      });
      const ts = Date.now();
      return res.json({
        success: true,
        sessionToken: signToken(id, 'agent', ts),
        sessionTs: ts,
        vendor: { vendorId: id, name: displayName, role: 'agent', chainId: '0', chainName: 'Talabat', branchName: 'Admin Panel' },
      });
    }

    // Vendor: store Chain ID in both col A and col C for consistent lookup
    await sheets.spreadsheets.values.append({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[id, hashed, id, chainName || '', '', now]] },
    });

    const ts = Date.now();
    return res.json({
      success: true,
      sessionToken: signToken(id, 'vendor', ts),
      sessionTs: ts,
      vendor: { vendorId: id, chainId: id, chainName: chainName || '', branchName: '' },
    });

  } catch (err) {
    console.error('register.js error:', err.message);
    let saEmail = '';
    try { saEmail = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}').client_email || ''; } catch(_) {}
    return res.status(500).json({ error: 'Server error: ' + err.message, serviceAccount: saEmail });
  }
};
