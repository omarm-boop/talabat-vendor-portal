// Emails a Content Team member (employee or monitor) when requests are assigned to them.
// Needs email sending to be set up (see lib/email.js). Never throws: a failed email must not fail the assignment.
const { sendEmail, emailConfigured } = require('./email');
const { loadTeamMembers } = require('./team');

const SITE = process.env.PORTAL_ORIGIN || 'https://talabat-vendor-portal.vercel.app';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "who" is an email or a display name (the portal stores the name in the Assignee column).
async function resolveEmail(sheets, who) {
  const w = String(who || '').trim();
  if (!w) return '';
  if (w.includes('@')) return w.toLowerCase();
  const key = w.toLowerCase();
  try {
    for (const m of JSON.parse(process.env.TEAM_CREDENTIALS || '[]')) {
      if (String(m.name || '').toLowerCase().trim() === key && String(m.email || '').includes('@')) return String(m.email).toLowerCase().trim();
    }
  } catch (_) {}
  try {
    const hit = (await loadTeamMembers(sheets)).find(m => String(m.name || '').toLowerCase().trim() === key && m.email.includes('@'));
    if (hit) return hit.email;
  } catch (_) {}
  return '';
}

// tickets: [{ chain, type, item, branch, priority }]; skipEmail: do not mail someone about their own action
async function notifyAssignee(sheets, who, tickets, skipEmail) {
  try {
    if (!tickets || !tickets.length) return false;
    if (!emailConfigured()) { console.warn('assignment email skipped: no email sending is set up (MAIL_WEBHOOK_URL / MAIL_WEBHOOK_SECRET)'); return false; }
    const to = await resolveEmail(sheets, who);
    if (!to) { console.warn('assignment email skipped: no email found for', who); return false; }
    if (skipEmail && to === String(skipEmail).toLowerCase().trim()) return false;

    const n = tickets.length;
    const first = tickets[0];
    const subject = n === 1
      ? `New request assigned to you: ${first.type || 'Request'} - ${first.chain || ''}`.trim()
      : `${n} new requests assigned to you`;
    const rows = tickets.slice(0, 20).map(t => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.chain)}${t.priority === 'high' ? ' <strong style="color:#c62828">HIGH PRIORITY</strong>' : ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.type)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.branch)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.item)}</td></tr>`).join('');
    const more = n > 20 ? `<p style="color:#888">…and ${n - 20} more.</p>` : '';
    return await sendEmail(to, subject,
      `<p>Hi,</p>
       <p>${n === 1 ? 'A request has' : n + ' requests have'} been assigned to you on Engizni. Please handle ${n === 1 ? 'it' : 'them'} within the SLA (24 working hours).</p>
       <table style="border-collapse:collapse;font-size:13px">
         <tr style="background:#fff3e8"><th align="left" style="padding:6px 10px">Chain</th><th align="left" style="padding:6px 10px">Request</th><th align="left" style="padding:6px 10px">Branch</th><th align="left" style="padding:6px 10px">Item</th></tr>
         ${rows}
       </table>${more}
       <p><a href="${SITE}" style="background:#ff5900;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open Engizni</a></p>
       <p style="color:#888;font-size:12px">This is an automated message from Engizni.</p>`);
  } catch (e) {
    console.error('notifyAssignee (non-fatal):', e.message);
    return false;
  }
}

// Reads chain / type / item / branch of sheet rows (columns D, E, H, N and the priority flag X)
async function ticketsFromRows(sheets, sheetId, tab, rowIndexes) {
  try {
    const ranges = rowIndexes.slice(0, 30).map(r => `${tab}!D${r}:X${r}`);
    const resp = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId, ranges });
    return (resp.data.valueRanges || []).map(v => {
      const r = (v.values || [[]])[0] || [];
      // D=0 chain, E=1 type, H=4 item, N=10 branch, X=20 priority
      return { chain: r[0] || '', type: r[1] || '', item: r[4] || '', branch: r[10] || '', priority: r[20] || '' };
    });
  } catch (e) { console.warn('ticketsFromRows (non-fatal):', e.message); return []; }
}

module.exports = { notifyAssignee, ticketsFromRows };
