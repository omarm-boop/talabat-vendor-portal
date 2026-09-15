const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { sendEmail } = require('../lib/email');
const { Redis } = require('@upstash/redis');

let redis = null;
function getRedis() {
  if (!redis) redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB       = 'Sheet1';
const CREDS_TAB = 'Credentials';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const { rowIndex, status, rejectionReason, vendorId } = body || {};
  if (!rowIndex || !status)
    return res.status(400).json({ error: 'rowIndex and status are required' });

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const now    = new Date().toISOString();

    // Write status + rejection reason + audit log in one call
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TAB}!T${rowIndex}`, values: [[status]] },
          { range: `${TAB}!V${rowIndex}`, values: [[rejectionReason || '']] },
          { range: `${TAB}!Y${rowIndex}`, values: [[`${sess.email} → ${status} at ${now}`]] },
        ],
      },
    });

    // Invalidate cache so next admin refresh sees the update immediately
    if (process.env.UPSTASH_REDIS_REST_URL) {
      getRedis().del('sheet:v1:all').catch(() => {});
    }

    // Fire-and-forget vendor notification (non-fatal)
    notifyVendor(sheets, vendorId, status, rejectionReason).catch(e =>
      console.error('notification error (non-fatal):', e.message)
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('update-status.js error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

async function notifyVendor(sheets, vendorId, status, rejectionReason) {
  if (!process.env.RESEND_API_KEY || !vendorId) return;

  // Look up the vendor's real email from Credentials col A→C
  const creds = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CREDS_TAB}!A:C`,
  });
  const rows = (creds.data.values || []).slice(1);
  const key  = String(vendorId).toLowerCase().trim();
  const row  = rows.find(r =>
    String(r[0] || '').toLowerCase().trim() === key ||
    String(r[2] || '').toLowerCase().trim() === key
  );
  const email = row ? String(row[2] || '').trim() : '';
  if (!email || !email.includes('@')) return;

  const statusLabel = status === 'Done' ? '✅ Completed'
    : status === 'Rejected' ? '❌ Rejected'
    : status === 'In Progress' ? '⏳ In Progress'
    : status;

  const reasonHtml = rejectionReason
    ? `<p><strong>Reason:</strong> ${rejectionReason}</p>` : '';

  await sendEmail(
    email,
    `Your request has been updated: ${statusLabel}`,
    `<p>Dear vendor,</p>
     <p>Your menu update request has been updated to: <strong>${statusLabel}</strong></p>
     ${reasonHtml}
     <p>Log in to your vendor portal to see the full details.</p>
     <p style="color:#888;font-size:12px">This is an automated notification from the Talabat Vendor Portal.</p>`
  );
}
