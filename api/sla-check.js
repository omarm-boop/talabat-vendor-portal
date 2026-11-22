const { google } = require('googleapis');
const { sendEmail, emailConfigured } = require('../lib/email');
const { teamDirectory, notifyAndRecord, esc, SITE } = require('../lib/notify-team');
const { isWorkingDay, workingHoursSince } = require('../lib/sla');
const { warmCatalog } = require('../lib/catalog');

const SHEET_ID = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB      = 'Sheet1';

// ── Morning reminder emails ──────────────────────────────────────────────────────────────────────────────────────
// Every team member with open (Pending / In Progress) requests gets one email listing them, the most urgent first.
// Monitors also see the overdue and unassigned requests of the whole team. Nothing is sent on non-working days.
const fmtLeft = h => h <= 0 ? `<strong style="color:#c62828">OVERDUE by ${Math.max(1, Math.round(-h))}h</strong>`
  : h <= 8 ? `<strong style="color:#e65100">${h.toFixed(1)}h left</strong>` : `${h.toFixed(1)}h left`;
function ticketTable(list) {
  const rows = list.slice(0, 40).map(t => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.chain)}${t.priority === 'high' ? ' <strong style="color:#c62828">HIGH</strong>' : ''}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.type)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.branch)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.item)}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${fmtLeft(t.left)}</td></tr>`).join('');
  const more = list.length > 40 ? `<p style="color:#888">…and ${list.length - 40} more.</p>` : '';
  return `<table style="border-collapse:collapse;font-size:13px"><tr style="background:#fff3e8">
    <th align="left" style="padding:6px 10px">Chain</th><th align="left" style="padding:6px 10px">Request</th><th align="left" style="padding:6px 10px">Branch</th><th align="left" style="padding:6px 10px">Item</th><th align="left" style="padding:6px 10px">SLA</th></tr>${rows}</table>${more}`;
}

async function retryFailedAssignmentEmails(sheets, rows) {
  if (!emailConfigured()) return { skipped: 'email not set up' };
  const byWho = new Map();
  rows.forEach((row, i) => {
    const st = String(row[19] || '').trim().toLowerCase();
    if (!(st === 'pending' || st.includes('progress') || st.includes('regional'))) return;   // only requests still open
    if (!/^failed/i.test(String(row[36] || ''))) return;
    const who = String(row[20] || '').trim();
    if (!who) return;
    if (!byWho.has(who)) byWho.set(who, []);
    byWho.get(who).push({ row: i + 2, no: String(row[35] || ''), chain: String(row[3] || ''), type: String(row[4] || ''),
      item: String(row[7] || ''), branch: String(row[13] || ''), priority: String(row[23] || '').toLowerCase() === 'high' ? 'high' : '' });
  });
  let sent = 0, failed = 0;
  for (const [who, tickets] of byWho) {
    (await notifyAndRecord(sheets, SHEET_ID, TAB, who, tickets)) ? sent++ : failed++;
  }
  return { people: byWho.size, sent, failed };
}

async function sendReminders(sheets, rows) {
  if (!emailConfigured()) { console.log('reminders skipped: email sending is not set up'); return { skipped: 'email not set up' }; }
  if (!isWorkingDay(new Date())) return { skipped: 'not a working day' };
  const nowMs = Date.now();
  const open = [];
  for (const row of rows) {
    const status = String(row[19] || '').trim().toLowerCase();
    if (!(status === 'pending' || status.includes('progress'))) continue;
    const start = row[22] || row[0];
    if (!start) continue;
    const priority = String(row[23] || '').trim().toLowerCase() === 'high' ? 'high' : '';
    open.push({
      chain: String(row[3] || ''), type: String(row[4] || ''), item: String(row[7] || ''), branch: String(row[13] || ''),
      assignee: String(row[20] || '').trim(), priority, left: (priority ? 8 : 24) - workingHoursSince(start, nowMs),
    });
  }
  if (!open.length) return { sent: 0, open: 0 };

  const team = await teamDirectory(sheets);
  const find = new Map();
  team.forEach(m => { find.set(m.name.toLowerCase(), m); find.set(m.email, m); });
  const mine = new Map(), unassigned = [];
  for (const t of open) {
    const m = t.assignee ? find.get(t.assignee.toLowerCase()) : null;
    if (!m) { unassigned.push(t); continue; }
    if (!mine.has(m.email)) mine.set(m.email, []);
    mine.get(m.email).push(t);
  }
  const overdue = open.filter(t => t.left <= 0);

  const jobs = [];
  for (const m of team) {
    const own = (mine.get(m.email) || []).sort((a, b) => a.left - b.left);
    const ownOver = own.filter(t => t.left <= 0).length;
    const teamOver = m.role === 'monitor' ? overdue.filter(t => !own.includes(t)).sort((a, b) => a.left - b.left) : [];
    const loose = m.role === 'monitor' ? unassigned : [];
    if (!own.length && !teamOver.length && !loose.length) continue;
    const bits = [];
    if (own.length) bits.push(`${own.length} yours${ownOver ? ` (${ownOver} overdue)` : ''}`);
    if (teamOver.length) bits.push(`${teamOver.length} overdue in the team`);
    if (loose.length) bits.push(`${loose.length} unassigned`);
    const html = `<p>Good morning ${esc(m.name)},</p>`
      + (own.length ? `<p><strong>Your open requests</strong> (most urgent first). The SLA is 24 working hours, 8 for high priority.</p>${ticketTable(own)}` : '')
      + (teamOver.length ? `<p><strong>Overdue in the team</strong></p>${ticketTable(teamOver)}` : '')
      + (loose.length ? `<p><strong>Not assigned to anyone</strong></p>${ticketTable(loose.sort((a, b) => a.left - b.left))}` : '')
      + `<p><a href="${SITE}" style="background:#ff5900;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Engizni</a></p>
         <p style="color:#888;font-size:12px">Daily reminder from Engizni, sent on working days.</p>`;
    jobs.push(() => sendEmail(m.email, `Engizni reminder: ${bits.join(', ')}`, html));
  }
  let sent = 0;
  for (let i = 0; i < jobs.length; i += 5) {   // five at a time, so the job finishes quickly
    const results = await Promise.all(jobs.slice(i, i + 5).map(j => j().catch(() => false)));
    sent += results.filter(Boolean).length;
  }
  return { open: open.length, overdue: overdue.length, recipients: jobs.length, sent };
}

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
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],   // write access: the retry below records its result in the sheet
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read through col X: U = Assignee, W = when it was assigned, X = priority
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:AK`,
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

    // Safety net: any assignment email that failed earlier (marked FAILED in column AK) is sent again now
    let retried = {};
    try { retried = await retryFailedAssignmentEmails(sheets, rows); }
    catch (e) { console.error('assignment email retry (non-fatal):', e.message); retried = { error: e.message }; }

    let reminders = {};
    try { reminders = await sendReminders(sheets, rows); }
    catch (e) { console.error('reminders error (non-fatal):', e.message); reminders = { error: e.message }; }

    // Refresh the barcode list now, so no vendor ever waits for it during the day
    let warmedBarcodes = 0;
    try { warmedBarcodes = await warmCatalog(); }
    catch (e) { console.warn('barcode list refresh failed (non-fatal):', e.message); }

    return res.json({
      checked: rows.length,
      pendingBreaches: pendingBreaches.length,
      inProgressBreaches: inProgressBreaches.length,
      retried,
      reminders,
      warmedBarcodes,
    });
  } catch (err) {
    console.error('sla-check error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
