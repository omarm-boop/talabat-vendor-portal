const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });
  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const { rowIndex, assignee } = body || {};
  if (!rowIndex) return res.status(400).json({ error: 'rowIndex is required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const now = new Date().toISOString();

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TAB}!U${rowIndex}`, values: [[assignee || '']] },
          { range: `${TAB}!W${rowIndex}`, values: [[assignee ? now : '']] },
          { range: `${TAB}!Y${rowIndex}`, values: [[`${sess.email} → Assigned:${assignee||'(unassigned)'} at ${now}`]] },
        ],
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('assign.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
