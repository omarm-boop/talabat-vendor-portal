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

    // Column positions match actual Sheet1 headers (legacy Google Form structure):
    // A=Timestamp, B=Vendor ID (Month Name), C=Contact Name (Week number),
    // D=Chain Name, E=Branch (Request Type col), F=Barcode, G=SKU,
    // H=Item Name, I=Explanation, J=Email, K=Image(empty), L=File link,
    // M-O=empty, P=Delist reason, Q-S=empty, T=Status
    const row = [
      new Date().toISOString(),   // A: Timestamp
      body.vendor      || '',     // B: Vendor ID
      body.name        || '',     // C: Contact Name
      body.restaurant  || '',     // D: Chain Name
      body.branch      || '',     // E: Branch
      body.barcode     || '',     // F: Barcode
      body.sku         || '',     // G: SKU / Internal Code
      itemName,                   // H: Item Name
      explainText,                // I: Explanation (Request Type + Notes)
      body.email       || '',     // J: Email
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
