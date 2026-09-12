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

  const SLA_DAYS = parseInt(process.env.SLA_DAYS || '3', 10);
  const cutoff   = Date.now() - SLA_DAYS * 24 * 3600 * 1000;

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:T`,
    });

    const rows = (resp.data.values || []).slice(1); // skip header
    const breaches = [];

    for (const row of rows) {
      const status = String(row[19] || '').trim().toLowerCase();
      if (status !== 'pending') continue;

      const ts = new Date(row[0] || '').getTime();
      if (!ts || ts > cutoff) continue;

      breaches.push({
        chain:   String(row[3] || '').trim(),
        type:    String(row[4] || '').trim(),
        item:    String(row[7] || '').trim(),
        daysOld: Math.floor((Date.now() - ts) / (24 * 3600 * 1000)),
      });
    }

    console.log(`SLA check: ${breaches.length} breach(es) / ${rows.length} rows`);

    if (breaches.length > 0 && process.env.SLACK_WEBHOOK_URL) {
      const lines = breaches
        .map(b => `• *${b.chain}* — ${b.type}${b.item ? ': ' + b.item : ''} — *${b.daysOld}d old*`)
        .join('\n');
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `:warning: *SLA Breach* — ${breaches.length} Pending request${breaches.length > 1 ? 's' : ''} older than ${SLA_DAYS} days:\n${lines}`,
        }),
      });
    }

    return res.json({ checked: rows.length, breaches: breaches.length });
  } catch (err) {
    console.error('sla-check error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
