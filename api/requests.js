const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB_NAME = 'Sheet1';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: TAB_NAME,
    });

    const values = response.data.values || [];
    if (values.length < 2) return res.json({ data: [] });

    const headers = values[0].map(h => String(h).trim());
    const dataRows = values.slice(1);

    let rows = dataRows.map((row, index) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      obj['_rowIndex'] = index + 2;

      // Normalize sheet column names → portal field names.
      // Must handle both new rows (correct columns, post-fix) and old rows (pre-fix layout).

      // Vendor ID: new rows → extract from vendorId@vendor.portal email
      //            old rows → Month Name held a numeric vendor ID
      if (!obj['Vendor ID']) {
        const email = String(obj['Email Address'] || '');
        if (email.endsWith('@vendor.portal')) {
          obj['Vendor ID'] = email.replace('@vendor.portal', '');
        }
      }
      if (!obj['Vendor ID']) {
        const mn = String(obj['Month Name'] || '');
        if (/^\d+$/.test(mn)) obj['Vendor ID'] = mn;
      }

      // Request Type:
      //   new rows (post-fix) → col E "Request Type / نوع الطلب" has the value directly
      //   mid-era rows        → first line of col I Explanation (requestType was prepended)
      //   old rows            → col G "SKU / الباركود الداخلى" was misused for request type
      if (!obj['Request Type']) {
        const colE = String(obj['Request Type / نوع الطلب'] || '');
        if (colE) {
          obj['Request Type'] = colE;
        } else {
          const exp = String(obj['Explain your request (if needed) / توضيح الطلب'] || '');
          obj['Request Type'] = exp.split('\n')[0] || obj['SKU/ الباركود الداخلى'] || '';
        }
      }

      // Status fallback: old rows stored 'Pending' in col M "Price/ السعر"
      // New rows have 'Pending' in col T directly so this only fires for very old rows.
      if (!obj['Status']) obj['Status'] = obj['Price/ السعر'] || '';

      // Assignee: written to col U (index 20) by assign.js.
      // Read by index first — col U header varies across sheet setups.
      // Fall back to named headers for backward-compat with old rows.
      if (!obj['Assignee']) {
        obj['Assignee'] = (row[20] && row[20] !== '') ? row[20]
          : obj['Owner'] || obj['Items Weight / وزن المنتج'] || '';
      }

      // Rejection reason: written to col V (index 21) by update-status.js
      if (!obj['Rejection Reason']) {
        obj['Rejection Reason'] = (row[21] && row[21] !== '') ? row[21] : obj['Reason'] || '';
      }

      // Convenience aliases for frontend display
      if (!obj['Restaurant'])       obj['Restaurant']       = obj['Chain Name / اسم السلسة'] || '';
      // Branch: new rows → col N "Branch Name / اسم الفرع" (location only)
      //         old rows → col E "Request Type / نوع الطلب" was misused for branch
      if (!obj['Branch'])           obj['Branch']           = obj['Branch Name / اسم الفرع'] || obj['Request Type / نوع الطلب'] || '';
      if (!obj['Item Name'])        obj['Item Name']        = obj['Item Name / اسم المنتج'] || '';
      if (!obj['Notes'])            obj['Notes']            = obj['Explain your request (if needed) / توضيح الطلب'] || '';
      if (!obj['Rejection Reason']) obj['Rejection Reason'] = obj['Reason'] || obj['Branch Name / اسم الفرع'] || '';

      // SLA assignment timestamp — col W (index 22), written by assign.js
      obj['AssignedAt'] = row[22] !== undefined ? row[22] : '';

      // Priority flag — col X (index 23), written by set-priority.js
      obj['Priority'] = row[23] !== undefined ? row[23] : '';

      // Photo link — col K "Upload Item Picture"
      if (!obj['PhotoLink']) obj['PhotoLink'] = obj['Upload Item Picture (If needed) / تحميل صورة المنتج'] || obj['Upload Item Picture / تحميل صورة المنتج'] || '';

      return obj;
    });

    const vendorId = (req.query.vendorId || '').trim();
    if (vendorId) {
      rows = rows.filter(r =>
        String(r['Vendor ID'] || '').trim() === vendorId
      );
    }

    return res.json({ data: rows });

  } catch (err) {
    console.error('requests.js error:', err.message);
    return res.status(500).json({ error: err.message, data: [] });
  }
};
