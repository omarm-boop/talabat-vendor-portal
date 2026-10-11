const { google } = require('googleapis');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

module.exports = async function handler(req, res) {
  // Vercel Cron injects Authorization: Bearer <CRON_SECRET> automatically
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET') return res.status(405).end();

  const PENDING_SLA_DAYS     = parseInt(process.env.SLA_DAYS || '3', 10);
  const IN_PROGRESS_SLA_DAYS = parseInt(process.env.IN_PROGRESS_SLA_DAYS || '5', 10);
  const now                  = Date.now();
  const pendingCutoff        = now - PENDING_SLA_DAYS     * 24 * 3600 * 1000;
  const inProgressCutoff     = now - IN_PROGRESS_SLA_DAYS * 24 * 3600 * 1000;

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read through col U (index 20) to include Assignee
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:U`,
    });

    const rows = (resp.data.values || []).slice(1); // skip header
    const pendingBreaches    = [];
    const inProgressBreaches = [];

    for (const row of rows) {
      const status   = String(row[19] || '').trim().toLowerCase();
      const ts       = new Date(row[0] || '').getTime();
      if (!ts) continue;

      const chain    = String(row[3]  || '').trim();
      const type     = String(row[4]  || '').trim();
      const item     = String(row[7]  || '').trim();
      const assignee = String(row[20] || '').trim();
      const daysOld  = Math.floor((now - ts) / (24 * 3600 * 1000));

      if (status === 'pending' && ts <= pendingCutoff) {
        pendingBreaches.push({ chain, type, item, assignee, daysOld });
      } else if ((status === 'in progress' || status.includes('progress')) && ts <= inProgressCutoff) {
        inProgressBreaches.push({ chain, type, item, assignee, daysOld });
      }
    }

    const totalBreaches = pendingBreaches.length + inProgressBreaches.length;
    console.log(`SLA check: ${pendingBreaches.length} pending breach(es), ${inProgressBreaches.length} in-progress breach(es) / ${rows.length} rows`);

    if (totalBreaches > 0 && process.env.SLACK_WEBHOOK_URL) {
      const fmtLine = b =>
        `• *${b.chain}* — ${b.type}${b.item ? ': ' + b.item : ''}${b.assignee ? ' (→ ' + b.assignee + ')' : ''} — *${b.daysOld}d old*`;

      const sections = [];
      if (pendingBreaches.length) {
        sections.push(
          `:hourglass_flowing_sand: *Pending > ${PENDING_SLA_DAYS}d* (${pendingBreaches.length}):\n` +
          pendingBreaches.map(fmtLine).join('\n')
        );
      }
      if (inProgressBreaches.length) {
        sections.push(
          `:rotating_light: *In Progress > ${IN_PROGRESS_SLA_DAYS}d* (${inProgressBreaches.length}):\n` +
          inProgressBreaches.map(fmtLine).join('\n')
        );
      }

      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:warning: *SLA Breach* — ${totalBreaches} ticket${totalBreaches > 1 ? 's' : ''} need attention:\n\n` +
                sections.join('\n\n'),
        }),
      });
    }

    return res.json({
      checked: rows.length,
      pendingBreaches: pendingBreaches.length,
      inProgressBreaches: inProgressBreaches.length,
    });
  } catch (err) {
    console.error('sla-check error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
