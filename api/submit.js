const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { Redis } = require('@upstash/redis');

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Form Responses 1';
const HEADERS  = [
  'Timestamp', 'Vendor ID', 'Email Address', 'Restaurant', 'Branch',
  'Contact Name', 'Request Type', 'Item Name', 'SKU', 'Barcode',
  'Reason', 'Notes', 'Status', 'Rejection Reason', 'Assignee',
];

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  // ── WITHDRAW (vendor withdraws their own pending request) ─────────────────
  if (body && body.rowIndex) {
    const { rowIndex } = body;
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const sheets = google.sheets({ version: 'v4', auth });

      const peek = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${TAB}!A${rowIndex}:T${rowIndex}`,
      });
      const row       = (peek.data.values || [[]])[0] || [];
      const rowEmail  = String(row[9]  || '').toLowerCase().trim();
      const rowStatus = String(row[19] || '').toLowerCase().trim();

      if (rowEmail !== sess.email.toLowerCase().trim())
        return res.status(403).json({ error: 'Forbidden: this request does not belong to your account' });
      if (rowStatus !== 'pending' && rowStatus !== '')
        return res.status(409).json({ error: 'Only Pending requests can be withdrawn' });

      const now = new Date().toISOString();
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `${TAB}!T${rowIndex}`, values: [['Withdrawn']] },
            { range: `${TAB}!Y${rowIndex}`, values: [[`${sess.email} → Withdrawn at ${now}`]] },
          ],
        },
      });
      if (process.env.UPSTASH_REDIS_REST_URL) getRedis().del('sheet:v1:all').catch(() => {});
      return res.json({ success: true });
    } catch (err) {
      console.error('withdraw error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // Server-side daily submission limit (configurable via DAILY_SUBMIT_LIMIT, default 5)
  const dailyLimit = parseInt(process.env.DAILY_SUBMIT_LIMIT || '5', 10);
  let dailyKey = null;
  if (dailyLimit > 0 && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
      dailyKey      = `daily:${sess.email}:${dateKey}`;
      const current = await getRedis().get(dailyKey);
      if (current !== null && parseInt(current, 10) >= dailyLimit) {
        return res.status(429).json({
          error: `Daily submission limit reached (${dailyLimit} per day). Please try again tomorrow.`,
        });
      }
    } catch (e) {
      console.warn('daily-limit Redis error (failing open):', e.message);
    }
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Write headers if sheet is empty
    const peek = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A1:A1`,
    });
    if (!peek.data.values || peek.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }

    // Deduplication: block if a Pending/In-Progress row exists for same chain + type + barcode
    const chainCheck   = (body.restaurant  || '').trim().toLowerCase();
    const typeCheck    = (body.requestType || '').trim().toLowerCase();
    const barcodeCheck = (body.barcode     || '').trim();
    if (chainCheck && typeCheck) {
      const dupResp = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!D:T`,
      });
      const dupRows = (dupResp.data.values || []).slice(1);
      const isDup = dupRows.some(row => {
        const st = String(row[16] || '').trim().toLowerCase();
        if (st !== 'pending' && !st.includes('progress')) return false;
        if (String(row[0] || '').trim().toLowerCase() !== chainCheck) return false;
        if (String(row[1] || '').trim().toLowerCase() !== typeCheck)  return false;
        if (barcodeCheck) {
          const rowBarcode = String(row[2] || '').trim();
          // Different barcode means different item — not a duplicate
          if (rowBarcode !== barcodeCheck) return false;
        }
        return true;
      });
      if (isDup) return res.status(409).json({
        error: 'A Pending or In Progress request for this item already exists. Please wait for it to be resolved before submitting again.',
      });
    }

    const itemName = body.itemName || body.itemNameEn || body.currentName || '';

    // Build explanation from whichever description fields were submitted
    const explanation = [
      body.notes,
      body.description,
      body.currentDesc && body.newDesc ? `Current: ${body.currentDesc} → New: ${body.newDesc}` : null,
      body.currentName && body.newName ? `Current name: ${body.currentName} → New: ${body.newName}` : null,
      body.currentBarcode && body.newBarcode ? `Current barcode: ${body.currentBarcode} → New: ${body.newBarcode}` : null,
    ].filter(Boolean).join('\n');

    // Strip chain name prefix from branch to get location only
    // e.g. "Abu Auf - Mohandseen Syria" with chain "Abu Auf" → "Mohandseen Syria"
    const chainName  = body.restaurant || '';
    const fullBranch = body.branch     || '';
    const chainPrefix = chainName + ' - ';
    const branchOnly = fullBranch.startsWith(chainPrefix)
      ? fullBranch.slice(chainPrefix.length)
      : fullBranch;

    // Auto-calculate month name and week-of-month to match legacy form columns
    const now = new Date();
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const monthName   = MONTHS[now.getUTCMonth()];
    const weekOfMonth = Math.ceil(now.getUTCDate() / 7);

    // Column positions match actual Sheet1 headers (legacy Google Form structure):
    // A=Timestamp, B=Month Name, C=Week number, D=Chain Name, E=Request Type,
    // F=Barcode, G=SKU, H=Item Name, I=Explanation, J=Email,
    // K=Image link, L=File link, M=Price, N=Branch Name, O=unused,
    // P=Delist reason, Q-S=unused, T=Status
    const row = [
      now.toISOString(),          // A: Timestamp
      monthName,                  // B: Month Name (e.g. "September")
      weekOfMonth,                // C: Week number (1–5 within month)
      body.restaurant  || '',     // D: Chain Name / اسم السلسة
      body.requestType || '',     // E: Request Type / نوع الطلب
      body.barcode     || '',     // F: Barcode / الباركود
      body.sku         || '',     // G: SKU / الباركود الداخلى
      itemName,                   // H: Item Name / اسم المنتج
      explanation,                // I: Explain your request (notes/description only)
      body.email       || '',     // J: Email Address (vendorId@vendor.portal)
      body.photoLink   || '',     // K: Upload Item Picture / تحميل صورة المنتج
      body.fileLink    || '',     // L: Upload file
      body.price       || '',     // M: Price / السعر
      branchOnly,                 // N: Branch Name / اسم الفرع (location only)
      '',                         // O: unused
      body.reason      || '',     // P: Delist reason
      '', '', '',                 // Q, R, S: unused
      'Pending',                  // T: Status
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:T`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });

    // Increment daily counter only after successful write (avoids burning slots on errors)
    if (dailyKey) {
      getRedis().incr(dailyKey).then(count => {
        if (count === 1) {
          const now = new Date();
          const midnight = new Date(now); midnight.setUTCHours(24, 0, 0, 0);
          getRedis().expire(dailyKey, Math.ceil((midnight - now) / 1000)).catch(() => {});
        }
      }).catch(() => {});
    }

    // Invalidate the requests cache so the new row appears immediately
    if (process.env.UPSTASH_REDIS_REST_URL) {
      getRedis().del('sheet:v1:all').catch(() => {});
    }

    return res.json({ success: true });

  } catch (err) {
    console.error('submit.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
