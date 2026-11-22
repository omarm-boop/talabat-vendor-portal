// Request numbers: ENGZ01, ENGZ02 ... ENGZ99, ENGZ100 ... One per request, never reused.
// Stored in column AJ of Sheet1 (index 35). A counter in Redis hands out the next number atomically, so two vendors
// submitting at the same moment never get the same one. The first time the counter is used (or if it is ever lost),
// every request that has no number yet is numbered in sheet order, and the counter continues after the highest.
const { ensureColumns } = require('./sheet-columns');

const KEY = 'reqno:counter';
const COL = 35;                       // AJ
const fmt = n => 'ENGZ' + String(n).padStart(2, '0');
const parse = s => { const m = /^ENGZ(\d+)$/i.exec(String(s || '').trim()); return m ? parseInt(m[1], 10) : 0; };

// Numbers every request that has none, in row order. Returns { max, byRow } (byRow: sheet row number -> number)
async function backfill(sheets, sheetId, tab) {
  await ensureColumns(sheets, sheetId, tab, 37);   // AJ = request number, AK = assignment email status
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:AJ` });
  const rows = (resp.data.values || []).slice(1);
  let max = 0;
  rows.forEach(r => { max = Math.max(max, parse(r[COL])); });
  const col = [], byRow = {};
  rows.forEach((r, i) => {
    let v = String(r[COL] || '').trim();
    if (!v && String(r[0] || '').trim()) { max++; v = fmt(max); }
    col.push([v]);
    if (v) byRow[i + 2] = v;
  });
  if (col.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range: `${tab}!AJ2:AJ${col.length + 1}`, valueInputOption: 'RAW', requestBody: { values: col },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: `${tab}!AJ1`, valueInputOption: 'RAW', requestBody: { values: [['Request No']] },
  });
  return { max, byRow };
}

// The number for the request just written to sheet row `rowNum`
async function nextRequestNo(sheets, redis, sheetId, tab, rowNum) {
  await ensureColumns(sheets, sheetId, tab, 37);
  if (!redis) {                                   // no counter available: number everything from the sheet
    const { byRow } = await backfill(sheets, sheetId, tab);
    return byRow[rowNum] || '';
  }
  const n = await redis.incr(KEY);
  if (n > 1) return fmt(n);
  // fresh counter: number the existing requests (this one included), then continue after the highest
  const { max, byRow } = await backfill(sheets, sheetId, tab);
  await redis.set(KEY, max);
  return byRow[rowNum] || fmt(await redis.incr(KEY));
}

module.exports = { nextRequestNo, fmt, parse };
