const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';
const HEADERS  = [
  'Timestamp', 'Vendor ID', 'Email Address', 'Restaurant', 'Branch',
  'Contact Name', 'Request Type', 'Item Name', 'SKU', 'Barcode',
  'Reason', 'Notes', 'Status', 'Rejection Reason',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

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
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADERS] },
      });
    }

    const itemName = body.itemName || body.itemNameEn || body.currentName || body.sku || '';

    const row = [
      new Date().toISOString(),
      body.vendor      || '',
      body.email       || '',
      body.restaurant  || '',
      body.branch      || '',
      body.name        || '',
      body.requestType || '',
      itemName,
      body.sku         || '',
      body.barcode     || '',
      body.reason      || '',
      body.notes       || body.fileLink || '',
      'Pending',
      '',
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:N`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    return res.json({ success: true });

  } catch (err) {
    console.error('submit.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
