const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';
const HEADERS  = [
  'Timestamp', 'Vendor ID', 'Email Address', 'Restaurant', 'Branch',
  'Contact Name', 'Request Type', 'Item Name', 'SKU', 'Barcode',
  'Reason', 'Notes', 'Status', 'Rejection Reason', 'Assignee',
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

    const itemName   = body.itemName || body.itemNameEn || body.currentName || '';
    const explainText = [body.requestType, body.notes].filter(Boolean).join('\n');

    // Auto-calculate month name and week-of-month to match legacy form columns
    const now = new Date();
    const MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const monthName   = MONTHS[now.getUTCMonth()];
    const weekOfMonth = Math.ceil(now.getUTCDate() / 7);

    // Column positions match actual Sheet1 headers (legacy Google Form structure):
    // A=Timestamp, B=Month Name, C=Week number, D=Chain Name, E=Branch,
    // F=Barcode, G=SKU, H=Item Name, I=Explanation, J=Email,
    // K=Image(empty), L=File link, M-O=empty, P=Delist reason, Q-S=empty, T=Status
    const row = [
      now.toISOString(),          // A: Timestamp
      monthName,                  // B: Month Name (e.g. "September")
      weekOfMonth,                // C: Week number (1–5 within month)
      body.restaurant  || '',     // D: Chain Name
      body.branch      || '',     // E: Branch
      body.barcode     || '',     // F: Barcode
      body.sku         || '',     // G: SKU / Internal Code
      itemName,                   // H: Item Name
      explainText,                // I: Explanation (Request Type + Notes)
      body.email       || '',     // J: Email (vendorId@vendor.portal — used to identify vendor)
      '',                         // K: Image upload (not applicable)
      body.fileLink    || '',     // L: File link
      '', '', '',                 // M, N, O: unused
      body.reason      || '',     // P: Delist reason
      '', '', '',                 // Q, R, S: unused
      'Pending',                  // T: Status
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:T`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    return res.json({ success: true });

  } catch (err) {
    console.error('submit.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
