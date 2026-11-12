const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { Redis } = require('@upstash/redis');
const { getPacked, setPacked } = require('../lib/cache-zip');
const { brandForChain } = require('../lib/chain-vertical');
const { loadTeamMembers } = require('../lib/team');
const { searchCatalog } = require('../lib/catalog');

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const { ensureColumns } = require('../lib/sheet-columns');

// Sheet1 stores the vendor as "<vendorId>@vendor.portal"; the session email is just "<vendorId>".
function sameAccount(rowEmail, sessEmail) {
  const norm = e => String(e || '').toLowerCase().trim().replace(/@vendor\.portal$/, '');
  return norm(rowEmail) !== '' && norm(rowEmail) === norm(sessEmail);
}
const { NO_RESUBMIT } = require('../lib/rejection-reasons');
const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';
const HEADERS  = [
  'Timestamp', 'Vendor ID', 'Email Address', 'Restaurant', 'Branch',
  'Contact Name', 'Request Type', 'Item Name', 'SKU', 'Barcode',
  'Reason', 'Notes', 'Status', 'Rejection Reason', 'Assignee',
];

// In-memory PIM catalog cache (warm Vercel instances; Redis is the persistent layer)
let pimCache = null; // { rows, expiresAt }

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── PIM CATALOG SEARCH (GET) — no auth required, catalog data is not sensitive ──
  if (req.method === 'GET') {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) return res.json({ results: [] });
    let catalogError = '';
    try {
      // First choice: ask the catalog sheet for just the matching rows (no IMPORTRANGE, nothing big to download).
      // If that is not possible, the PIM tab below is used as before.
      try { return res.json({ results: await searchCatalog(q), source: 'catalog' }); }
      catch (e) { catalogError = String(e.message || e).slice(0, 200); console.warn('direct catalog lookup unavailable, using the PIM tab:', catalogError); }

      const PIM_KEY = 'talabat:pim_catalog_v2';
      let rows = null;

      // 1. In-memory cache
      if (pimCache && pimCache.expiresAt > Date.now()) rows = pimCache.rows;

      // 2. Redis cache
      if (!rows && process.env.UPSTASH_REDIS_REST_URL) {
        try {
          const cached = await getPacked(getRedis(), PIM_KEY);
          if (cached) rows = cached;
        } catch (_) {}
      }

      // 3. Google Sheets (source of truth)
      if (!rows) {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
        const sheets = google.sheets({ version: 'v4', auth });
        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'PIM!A:D' });
        rows = (resp.data.values || []).slice(1); // skip header row
        if (rows.length) {
          pimCache = { rows, expiresAt: Date.now() + 3600 * 1000 };
          if (process.env.UPSTASH_REDIS_REST_URL)
            setPacked(getRedis(), PIM_KEY, rows, { ex: 3600 }).catch(() => {});
        }
      }

      const results = (rows || [])
      .filter(r => {
        const sku = String(r[0] || '').toLowerCase();
        const master = String(r[1] || '').toLowerCase();
        const barcode = String(r[2] || '').toLowerCase();
        const name = String(r[3] || '').toLowerCase();
        return barcode.includes(q) || master.includes(q) || name.includes(q) || sku.includes(q);
      })
      .sort((a, b) => {   // an exact barcode / code match comes first
        const exact = r => [r[0], r[1], r[2]].some(x => String(x || '').toLowerCase() === q) ? 1 : 0;
        return exact(b) - exact(a);
      })
      .slice(0, 25)
      .map(r => ({
        masterCode: String(r[0] || ''), // Column A -> SKU
        barcode: String(r[2] || ''),    // Column C -> Barcode
        name: String(r[3] || '')        // Column D -> Item Name (English)
      }));

      return res.json({ results, source: 'pim', catalogError });
    } catch (err) {
      console.error('pim-search error:', err.message);
      return res.json({ results: [], source: 'error', catalogError, error: String(err.message || err).slice(0, 200) }); // autocomplete is non-critical
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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

      if (!sameAccount(rowEmail, sess.email))
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

    // -- Required fields + brand / weighable rules (validated here as well as in the form) --
    if (!String(body.restaurant || '').trim() || !String(body.branch || '').trim())
      return res.status(400).json({ error: 'Restaurant / Chain name and Branch / Location are required' });
    let brandType = String(body.brandType || '').trim().toLowerCase();
    if (brandType && !/^[a-z0-9\u0600-\u06FF-]{1,40}$/.test(brandType))
      return res.status(400).json({ error: 'Invalid brand type' });
    // The brand from the Chain Vertical sheet wins; otherwise the one saved on the account; never the browser's
    const sheetBrand = await brandForChain(sess.email);
    if (sheetBrand) brandType = sheetBrand;
    else try {
      const cr = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Credentials!A:H' });
      const me = String(sess.email || '').toLowerCase().trim();
      for (const r of (cr.data.values || []).slice(1)) {
        if (String(r[0] || '').toLowerCase().trim() === me || String(r[2] || '').toLowerCase().trim() === me) {
          const stored = String(r[7] || '').trim().toLowerCase();
          if (/^[a-z0-9\u0600-\u06FF-]{1,40}$/.test(stored)) brandType = stored;
          break;
        }
      }
    } catch (e) { console.warn('brand lookup failed (using submitted value):', e.message); }
    const contactEmail = String(body.contactEmail || '').trim();
    if (contactEmail && !/\S+@\S+\.\S+/.test(contactEmail))
      return res.status(400).json({ error: 'Please enter a valid email address' });
    const reqTypeText = String(body.requestType || '').trim();
    const itemNameAr = String(body.itemNameAr || '').trim();
    if (/^urgent add item$/i.test(reqTypeText) && !/[\u0600-\u06FF]/.test(itemNameAr))
      return res.status(400).json({ error: 'Item name in Arabic is required (please write it in Arabic letters)' });
    if (/^remove an item$/i.test(reqTypeText) && !String(body.fileLink || '').trim() && !String(body.barcode || '').trim())
      return res.status(400).json({ error: 'Barcode and reason for delisting are required' });
    if (/^remove an item$/i.test(reqTypeText) && !String(body.reason || '').trim())
      return res.status(400).json({ error: 'Barcode and reason for delisting are required' });
    let itemType = '', minWeight = '';
    if (brandType === 'grocery' && /^urgent add item$/i.test(String(body.requestType || '').trim())) {
      itemType = String(body.itemType || '').trim().toLowerCase();
      if (!['weighable', 'packed'].includes(itemType))
        return res.status(400).json({ error: 'Please choose whether the item is Weighable or Packed' });
      if (itemType === 'weighable') {
        const num = x => parseFloat(String(x || '').replace(/[^\d.]/g, ''));
        if (!(num(body.price) > 0))     return res.status(400).json({ error: 'Price per Kilo is required for weighable items' });
        if (!(num(body.minWeight) > 0)) return res.status(400).json({ error: 'Minimum Weight is required for weighable items' });
        minWeight = String(body.minWeight).trim();
      }
    }

    await ensureColumns(sheets, SHEET_ID, TAB, 33); // AC-AG: brand, item type, min weight, contact email, Arabic item name

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

    // Resubmission: the vendor re-sends a Rejected request after fixing it. It is saved as a NEW row
    // (new timestamp, new SLA clock, normal auto-assignment) linked to the original.
    const parentRow = body.parentRow ? parseInt(body.parentRow, 10) : 0;
    if (body.parentRow) {
      if (!parentRow || parentRow < 2) return res.status(400).json({ error: 'Invalid original request' });
      const pr = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: `${TAB}!A${parentRow}:AB${parentRow}`,
      });
      const p = (pr.data.values || [[]])[0] || [];
      if (!sameAccount(p[9], sess.email))
        return res.status(403).json({ error: 'Forbidden: this request does not belong to your account' });
      if (!String(p[19] || '').toLowerCase().includes('reject'))
        return res.status(409).json({ error: 'Only Rejected requests can be resubmitted' });
      if (String(p[27] || '').trim())
        return res.status(409).json({ error: 'This request was already resubmitted' });
      if (String(p[25] || '').split(',').includes(NO_RESUBMIT))
        return res.status(409).json({ error: 'This request cannot be resubmitted. Please send a new request instead.' });
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

    const appendResp = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:T`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });

    // Auto-assign: find the row number we just wrote and assign it to an agent
    const updatedRange = (appendResp.data.updates && appendResp.data.updates.updatedRange) || '';
    const rowMatch = updatedRange.match(/(\d+)$/);
    if (rowMatch) {
      await autoAssign(sheets, chainName, parseInt(rowMatch[1], 10), now);
      try {
        const nr = parseInt(rowMatch[1], 10);
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID, range: `${TAB}!AC${nr}:AG${nr}`, valueInputOption: 'RAW',
          requestBody: { values: [[brandType, itemType, minWeight, contactEmail, itemNameAr]] },
        });
      } catch (e) { console.warn('brand/item columns write failed (non-fatal):', e.message); }
      if (parentRow) {
        // Link both ways: new row → original (AA), original → new row (AB) + audit entry
        const newRow = parseInt(rowMatch[1], 10);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            valueInputOption: 'RAW',
            data: [
              { range: `${TAB}!AA${newRow}`,    values: [[parentRow]] },
              { range: `${TAB}!AB${parentRow}`, values: [[newRow]] },
              { range: `${TAB}!Y${parentRow}`,  values: [[`${sess.email} → Resubmitted as row ${newRow} at ${now.toISOString()}`]] },
            ],
          },
        });
      }
    }

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

// Auto-assign the newly submitted row to the correct agent.
// Rule 1/2: same chain name → same agent who already handles it.
// Rule 4: new chain → agent with fewest total assignments.
async function autoAssign(sheets, chainName, newRowNum, now) {
  try {
    // Build agentMap: { email → displayName }
    // Always merge TEAM_CREDENTIALS env var + Credentials sheet (Chain ID='0')
    // so agents who sign up via the portal are included alongside env-var agents.
    const agentMap = {};

    // Source 1: TEAM_CREDENTIALS env var (pre-configured accounts)
    try {
      const team = JSON.parse(process.env.TEAM_CREDENTIALS || '[]');
      for (const m of team) {
        const role = (m.role || '').toLowerCase();
        if (role !== 'monitor') {
          const email = String(m.email).toLowerCase().trim();
          agentMap[email] = m.name || email;
        }
      }
    } catch (_) {}

    // Source 2: the Team tab (and older Credentials rows with Chain ID 0)
    try {
      for (const m of await loadTeamMembers(sheets)) {
        if (m.role === 'monitor') continue;                           // skip monitors
        if (!m.email || !m.email.includes('@') || agentMap[m.email]) continue;
        agentMap[m.email] = m.name || m.email;
      }
    } catch (_) {}

    const agentEmails = Object.keys(agentMap);
    if (agentEmails.length === 0) return;

    // Fetch columns D (Chain Name) through U (Assignee) for all existing rows
    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!D:U`,
    });
    // D=idx0, E=1, F=2, G=3, H=4, I=5, J=6, K=7, L=8, M=9,
    // N=10, O=11, P=12, Q=13, R=14, S=15, T=16, U=17
    const allRows = (dataResp.data.values || []).slice(1); // skip header row

    const chainLower = chainName.trim().toLowerCase();

    // Rule 1/2: find existing agent already assigned to this chain
    // rowAssignee may be an email (old rows) or a display name (new rows)
    let assignedAgent = null;
    for (const r of allRows) {
      const rowChain    = String(r[0]  || '').trim().toLowerCase();
      const rowAssignee = String(r[17] || '').trim().toLowerCase();
      if (rowChain !== chainLower || !rowAssignee) continue;
      const matched = agentEmails.find(e =>
        e === rowAssignee ||                                    // email match (old rows)
        (agentMap[e] || '').toLowerCase() === rowAssignee      // name match (new rows)
      );
      if (matched) { assignedAgent = matched; break; }
    }

    // Rule 4: new chain → pick the agent with the fewest total assignments
    if (!assignedAgent) {
      const counts = {};
      for (const e of agentEmails) counts[e] = 0;
      for (const r of allRows) {
        const rowAssignee = String(r[17] || '').trim().toLowerCase();
        if (!rowAssignee) continue;
        const matched = agentEmails.find(e =>
          e === rowAssignee || (agentMap[e] || '').toLowerCase() === rowAssignee
        );
        if (matched) counts[matched]++;
      }
      assignedAgent = agentEmails.reduce((min, e) => counts[e] < counts[min] ? e : min, agentEmails[0]);
    }

    if (!assignedAgent) return;

    const displayName = agentMap[assignedAgent] || assignedAgent;
    const ts = now.toISOString();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TAB}!U${newRowNum}`, values: [[displayName]] },
          { range: `${TAB}!W${newRowNum}`, values: [[ts]] },
          { range: `${TAB}!Y${newRowNum}`, values: [[`Auto-assigned to ${displayName} at ${ts}`]] },
        ],
      },
    });
  } catch (err) {
    console.error('auto-assign error (non-fatal):', err.message);
  }
}
