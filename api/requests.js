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

      // Request Type: new rows → first line of Explanation col (I)
      //               old rows → col G (SKU col was misused for request type)
      if (!obj['Request Type']) {
        const exp = String(obj['Explain your request (if needed) / توضيح الطلب'] || '');
        obj['Request Type'] = exp.split('\n')[0] || obj['SKU/ الباركود الداخلى'] || '';
      }

      // Status fallback: old rows stored 'Pending' in col M "Price/ السعر"
      if (!obj['Status']) obj['Status'] = obj['Price/ السعر'] || '';

      // Assignee: col U "Owner" (new rows), col O "Items Weight" (old rows)
      if (!obj['Assignee']) {
        obj['Assignee'] = obj['Owner'] || obj['Items Weight / وزن المنتج'] || '';
      }

      // Convenience aliases for frontend display
      if (!obj['Restaurant'])       obj['Restaurant']       = obj['Chain Name / اسم السلسة'] || '';
      if (!obj['Branch'])           obj['Branch']           = obj['Request Type / نوع الطلب'] || '';
      if (!obj['Item Name'])        obj['Item Name']        = obj['Item Name / اسم المنتج'] || '';
      if (!obj['Notes'])            obj['Notes']            = obj['Explain your request (if needed) / توضيح الطلب'] || '';
      if (!obj['Rejection Reason']) obj['Rejection Reason'] = obj['Reason'] || obj['Branch Name / اسم الفرع'] || '';

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
