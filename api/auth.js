const { google } = require('googleapis');
const bcrypt = require('bcryptjs');
const { signToken, verifyRequest } = require('../lib/verify');
const { ensureColumns } = require('../lib/sheet-columns');
const { loadBranchMap } = require('../lib/branches');
const { setCors } = require('../lib/cors');
const { checkLoginLimit } = require('../lib/ratelimit');

const TRACKING_SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDENTIALS_TAB   = 'Credentials';

const delay2s = () => new Promise(r => setTimeout(r, 2000));

// Branches of the signed-in vendor's chain. Never fails the page: an empty list means "type it in".
async function handleBranches(req, res) {
  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const map = await loadBranchMap();
    return res.json({ success: true, branches: map[String(sess.email).trim()] || [] });
  } catch (err) {
    console.warn('branch list unavailable (is the sheet shared with the service account?):', err.message);
    return res.json({ success: true, branches: [] });
  }
}

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
      valueInputOption: 'RAW',
      requestBody: { values: [[hashed]] },
    });
  } catch (err) {
    console.error('Password migration failed at row', rowNum, ':', err.message);
  }
  return 'plain'; // matched a plain-text (admin-set) password
}

// Saves the vendor's contact email (Credentials col G) and brand type (col H) once, so they are remembered.
// Lives here (not in its own file) to stay within the Vercel function-count limit.
async function handleProfile(req, res, body) {
  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });
  if (sess.role !== 'vendor') return res.status(403).json({ error: 'Vendors only' });

  const email = String(body.email || '').trim().toLowerCase();
  const brandType = String(body.brandType || '').trim().toLowerCase();
  if (!email && !brandType) return res.status(400).json({ error: 'Nothing to save' });
  if (email && !/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (brandType && !['pharmacy', 'grocery'].includes(brandType)) return res.status(400).json({ error: 'Invalid brand type' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.JWT({
      email: credentials.client_email, key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: TRACKING_SHEET_ID, range: `${CREDENTIALS_TAB}!A:H` });
    const rows = resp.data.values || [];
    const me = String(sess.email).toLowerCase().trim();
    let rowNum = 0, existingBrand = '';
    for (let i = 1; i < rows.length; i++) {
      const a = String(rows[i][0] || '').toLowerCase().trim();
      const c = String(rows[i][2] || '').toLowerCase().trim();
      if (a === me || (c && c === me)) { rowNum = i + 1; existingBrand = String(rows[i][7] || '').trim().toLowerCase(); break; }
    }
    if (!rowNum) return res.status(404).json({ error: 'Account not found' });
    // Pharmacy and Grocery are different verticals: once a brand type is saved it can never be changed here
    if (brandType && existingBrand && brandType !== existingBrand)
      return res.status(409).json({ error: 'Your brand type is already set and cannot be changed. Please contact your account manager.', brandType: existingBrand });

    await ensureColumns(sheets, TRACKING_SHEET_ID, CREDENTIALS_TAB, 8);
    const data = [];
    if (email)     data.push({ range: `${CREDENTIALS_TAB}!G${rowNum}`, values: [[email]] });
    if (brandType && !existingBrand) {
      data.push({ range: `${CREDENTIALS_TAB}!H${rowNum}`, values: [[brandType]] });
      data.push({ range: `${CREDENTIALS_TAB}!H1`, values: [['Brand Type']] });
    }
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: TRACKING_SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data },
      });
    }
    return res.json({ success: true, email, brandType: existingBrand || brandType });
  } catch (err) {
    console.error('auth.js profile error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  if (body && body.action === 'profile') return handleProfile(req, res, body);
  if (body && body.action === 'branches') return handleBranches(req, res);
  const { vendorId, password } = body || {};

  if (!vendorId || !password)
    return res.status(400).json({ error: 'Email / Vendor ID and password are required' });

  try {
    if (!await checkLoginLimit(req, res, vendorId)) return;
  } catch (rlErr) {
    console.warn('Rate-limit check failed (failing open):', rlErr.message);
  }

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

    let matched = null, matchedRow = [], matchedRowNum = 0, matchedHow = false;
    for (let i = 0; i < rows.length; i++) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = rows[i][idx] || ''; });
      const matchKey = (obj['Chain ID'] && obj['Chain ID'].trim())
        ? obj['Chain ID'].trim()
        : obj['Vendor ID'].trim();
      if (matchKey.toLowerCase() !== String(vendorId).toLowerCase().trim()) continue;

      const rowNum  = i + 2;
      const matches = await verifyAndMigrate(obj['Password'], password, sheets, rowNum);
      if (matches) { matched = obj; matchedRow = rows[i]; matchedRowNum = rowNum; matchedHow = matches; break; }
    }

    if (!matched) {
      await delay2s();
      return res.status(401).json({ error: 'Incorrect Chain ID or password.' });
    }

    const vid = matched['Chain ID'] || matched['Vendor ID'];
    const ts  = Date.now();

    // An account created by an admin (plain-text password, or the default 123456) must set its own
    // password. The "Must Change Password" flag (Credentials col I) keeps that true until it is changed.
    const flagged = String(matchedRow[8] || '').trim().toLowerCase() === 'yes';
    const mustChange = password === '123456' || matchedHow === 'plain' || flagged;
    if (mustChange && !flagged) {
      try {
        await ensureColumns(sheets, TRACKING_SHEET_ID, CREDENTIALS_TAB, 9);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: TRACKING_SHEET_ID,
          requestBody: { valueInputOption: 'RAW', data: [
            { range: `${CREDENTIALS_TAB}!I${matchedRowNum}`, values: [['yes']] },
            { range: `${CREDENTIALS_TAB}!I1`, values: [['Must Change Password']] },
          ] },
        });
      } catch (e) { console.warn('must-change flag write failed (non-fatal):', e.message); }
    }
    return res.json({
      success: true,
      mustChangePassword: mustChange,
      sessionToken: signToken(vid, 'vendor', ts),
      sessionTs: ts,
      vendor: {
        vendorId:   vid,
        role:       'vendor',
        chainId:    matched['Chain ID'],
        chainName:  matched['Chain Name'],
        branchName: matched['Branch Name'],
        email:      String(matchedRow[6] || '').trim(),
        brandType:  String(matchedRow[7] || '').trim().toLowerCase(),
      },
    });

  } catch (err) {
    console.error('auth.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
