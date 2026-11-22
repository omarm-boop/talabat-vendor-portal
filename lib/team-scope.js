// What a team member may see and change: employees only the requests assigned to them, monitors everything.
const { teamDirectory } = require('./notify-team');

const cache = new Map();   // email -> { at, names }

// The ways a person can appear in the Assignee column: their display name or their email (lowercase)
async function agentNames(sheets, email) {
  const key = String(email || '').toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.names;
  const names = new Set([key]);
  try { for (const m of await teamDirectory(sheets)) if (m.email === key) names.add(m.name.toLowerCase()); } catch (_) {}
  cache.set(key, { at: Date.now(), names });
  return names;
}

// true when the session may change all of these sheet rows (monitors always; employees only their own)
async function mayChangeRows(sheets, sheetId, tab, rowIndexes, sess) {
  if (sess.role === 'monitor') return true;
  const names = await agentNames(sheets, sess.email);
  const rows = (rowIndexes || []).map(Number).filter(n => n >= 2);
  if (!rows.length) return false;
  const resp = await sheets.spreadsheets.values.batchGet({ spreadsheetId: sheetId, ranges: rows.map(r => `${tab}!U${r}`) });
  return (resp.data.valueRanges || []).every(v => {
    const who = String(((v.values || [[]])[0] || [])[0] || '').trim().toLowerCase();
    return who && names.has(who);
  });
}

module.exports = { agentNames, mayChangeRows };
