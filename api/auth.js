const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { signToken } = require('../lib/verify');
const { setCors } = require('../lib/cors');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDENTIALS_TAB   = 'Credentials';

const delay2s = () => new Promise(r => setTimeout(r, 2000));

// Verify password and lazily migrate plain-text to bcrypt hash in-place.
// rowNum is the 1-indexed sheet row (header = row 1, so first data row = 2).
async function verifyAndMigrate(stored, candidate, sheets, rowNum) {
  const isHashed = stored.startsWith('$2b$') || stored.startsWith('$2a$');
  if (isHashed) return bcrypt.compare(candidate, stored);
  if (stored !== candidate) return false;
  // Plain-text matched — silently upgrade to bcrypt hash
  try {
    const hashed = await bcrypt.hash(candidate, 10);
    await sheets.spreadsheets.values.update({
      spreadsheetId: TRACKING_SHEET_ID,
      range: `${CREDENTIALS_TAB}!B${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[hashed]] },
    });
  } catch (err) {
    console.error('Password migration failed at row', rowNum, ':', err.message);
  }
  return true;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const { vendorId, password } = body || {};

  if (!vendorId || !password)
    return res.status(400).json({ error: 'Email / Vendor ID and password are required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    // Full scope needed so verifyAndMigrate can write the hashed password back
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key:   credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // ── Internal team: @talabat.com emails ───────────────────────────────────
    if (String(vendorId).toLowerCase().trim().endsWith('@talabat.com')) {
      const email = String(vendorId).toLowerCase().trim();

      // 1. TEAM_CREDENTIALS env var (pre-configured monitor etc.)
      //    Passwords may be plain-text (legacy) or bcrypt hashes (current).
      //    Plain-text still accepted so existing deployments aren't broken.
      let team = [];
      try { team = JSON.parse(process.env.TEAM_CREDENTIALS || '[]'); } catch(_) {}
      let envMatch = null;
      for (const m of team) {
        if (String(m.email).toLowerCase().trim() !== email) continue;
        const stored   = m.password || '';
        const isHashed = stored.startsWith('$2b$') || stored.startsWith('$2a$');
        const ok = isHashed ? await bcrypt.compare(password, stored) : stored === password;
        if (ok) { envMatch = m; break; }
      }
      if (envMatch) {
        const role = (envMatch.role || 'agent').toLowerCase();
        const ts   = Date.now();
        return res.json({
          success: true,
          sessionToken: signToken(envMatch.email, role, ts),
          sessionTs: ts,
          vendor: {
            vendorId:   envMatch.email,
            name:       envMatch.name || envMatch.email,
            role,
            chainId:    '0',
            chainName:  'Talabat',
            branchName: 'Admin Panel',
          },
        });
      }

      // 2. Self-registered agents in the Credentials sheet (chainId = '0')
      const credsResp = await sheets.spreadsheets.values.get({
        spreadsheetId: TRACKING_SHEET_ID,
        range: CREDENTIALS_TAB,
      });
      const credsValues = credsResp.data.values || [];
      if (credsValues.length > 1) {
        const headers = credsValues[0];
        for (let i = 0; i < credsValues.length - 1; i++) {
          const row = credsValues[i + 1];
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = row[idx] || ''; });
          if (String(obj['Vendor ID']).toLowerCase().trim() !== email) continue;
          if (String(obj['Chain ID']).trim() !== '0') continue;

          const rowNum  = i + 2; // 1-indexed; +1 to skip header row
          const matches = await verifyAndMigrate(obj['Password'], password, sheets, rowNum);
          if (!matches) continue;

          const role = obj['Branch Name'] || 'agent';
          const ts   = Date.now();
          return res.json({
            success: true,
            sessionToken: signToken(obj['Vendor ID'], role, ts),
            sessionTs: ts,
            vendor: {
              vendorId:   obj['Vendor ID'],
              name:       (obj['Chain Name'] && obj['Chain Name'] !== 'Talabat') ? obj['Chain Name'] : obj['Vendor ID'],
              role,
              chainId:    '0',
              chainName:  'Talabat',
              branchName: 'Admin Panel',
            },
          });
        }
      }

      await delay2s();
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
    for (let i = 0; i < rows.length; i++) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = rows[i][idx] || ''; });
      const matchKey = (obj['Chain ID'] && obj['Chain ID'].trim())
        ? obj['Chain ID'].trim()
        : obj['Vendor ID'].trim();
      if (matchKey.toLowerCase() !== String(vendorId).toLowerCase().trim()) continue;

      const rowNum  = i + 2;
      const matches = await verifyAndMigrate(obj['Password'], password, sheets, rowNum);
      if (matches) { matched = obj; break; }
    }

    if (!matched) {
      await delay2s();
      return res.status(401).json({ error: 'Incorrect Chain ID or password.' });
    }

    const vid = matched['Chain ID'] || matched['Vendor ID'];
    const ts  = Date.now();
    return res.json({
      success: true,
      sessionToken: signToken(vid, 'vendor', ts),
      sessionTs: ts,
      vendor: {
        vendorId:   vid,
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
