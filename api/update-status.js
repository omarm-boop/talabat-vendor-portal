const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { sendEmail } = require('../lib/email');
const { ensureColumns } = require('../lib/sheet-columns');
const { cleanCodes, composeReason, canResubmit, NO_RESUBMIT } = require('../lib/rejection-reasons');
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

  // Only the Talabat team (agents / monitors) can change a request. Vendors never call this endpoint.
  if (sess.role !== 'monitor' && sess.role !== 'agent')
    return res.status(403).json({ error: 'Team access required' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  // A message from the team to the vendor (shown on the vendor's dashboard, whatever the status is)
  if (body && body.note !== undefined && !body.status) {
    const noteRow = parseInt(body.rowIndex, 10);
    if (!noteRow || noteRow < 2) return res.status(400).json({ error: 'rowIndex is required' });
    const note = String(body.note || '').trim().slice(0, 500);
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const sheets = google.sheets({ version: 'v4', auth });
      const at = new Date().toISOString();
      await ensureColumns(sheets, SHEET_ID, TAB, 35);   // AH = team note, AI = when it was written
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: [
            { range: `${TAB}!AH${noteRow}`, values: [[note]] },
            { range: `${TAB}!AI${noteRow}`, values: [[note ? at : '']] },
            { range: `${TAB}!Y${noteRow}`,  values: [[`${sess.email} → Note to vendor at ${at}`]] },
          ],
        },
      });
      if (process.env.UPSTASH_REDIS_REST_URL) getRedis().del('sheet:v1:all').catch(() => {});
      return res.json({ success: true, note, noteAt: note ? at : '' });
    } catch (err) {
      console.error('update-status note error:', err.message);
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }

  const { rowIndex, status, vendorId } = body || {};
  if (!rowIndex || !status)
    return res.status(400).json({ error: 'rowIndex and status are required' });

  // Rejection: reason codes (dropdown) + optional free-text note. A plain `rejectionReason`
  // string is still accepted for older clients.
  let rejectionReason = String((body && body.rejectionReason) || '').trim();
  let rejectCodes = '';
  if (status === 'Rejected') {
    const codes = cleanCodes(body.rejectCodes);
    const note  = String(body.rejectNote || '').trim();
    if (!codes.length && !note && !rejectionReason)
      return res.status(400).json({ error: 'Select a rejection reason or write one' });
    if (codes.length || note) rejectionReason = composeReason(codes, note);
    const allow = canResubmit(codes, typeof body.allowResubmit === 'boolean' ? body.allowResubmit : undefined);
    rejectCodes = codes.concat(allow ? [] : [NO_RESUBMIT]).join(',');
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const now    = new Date().toISOString();

    if (status === 'Rejected') await ensureColumns(sheets, SHEET_ID, TAB, 28);

    // Write status + rejection reason + audit log in one call
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `${TAB}!T${rowIndex}`, values: [[status]] },
          { range: `${TAB}!V${rowIndex}`, values: [[rejectionReason || '']] },
          { range: `${TAB}!Z${rowIndex}`, values: [[rejectCodes]] },
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

  // Look up the vendor's notification email from Credentials:
  // col A = Vendor ID, col C = Chain ID, col G (index 6) = notification email
  const creds = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CREDS_TAB}!A:G`,
  });
  const rows = (creds.data.values || []).slice(1);
  const key  = String(vendorId).toLowerCase().trim();
  const row  = rows.find(r =>
    String(r[0] || '').toLowerCase().trim() === key ||
    String(r[2] || '').toLowerCase().trim() === key
  );
  // For team members (@talabat.com), col A IS the email.
  // For vendors, use col G (notification email captured at signup).
  const colA = row ? String(row[0] || '').trim() : '';
  const colG = row ? String(row[6] || '').trim() : '';
  const email = colG.includes('@') ? colG : (colA.includes('@') ? colA : '');
  if (!email) return;

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
