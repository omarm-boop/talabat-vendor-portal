const { google } = require('googleapis');

// Branch master list = the base data of every vendor. Columns (found by header name, falling back to position):
//   Chain ID | Chain Name | Vendor Id | Vendor Name (English) | Vertical
const BRANCH_SHEET_ID  = '1bhCkMlLw4vJM23NBe8jNkNcatL3RAbj9qLh0b04S6ps';
const BRANCH_SHEET_GID = 1244934692;
const BRANCH_CACHE_MS  = 10 * 60 * 1000;
let branchCache = { at: 0, data: null };

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Returns { byChain: { chainId: [{ id, name }] }, verticalByChain: { chainId: 'grocery' | 'pharmacy' | ... } }.
// Throws if the sheet cannot be read (e.g. not shared with the service account).
async function loadBranchData() {
  if (branchCache.data && Date.now() - branchCache.at < BRANCH_CACHE_MS) return branchCache.data;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.JWT({
    email: credentials.client_email, key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BRANCH_SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const tab = (meta.data.sheets || []).find(s => s.properties.sheetId === BRANCH_SHEET_GID);
  if (!tab) throw new Error('Branch tab not found');
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: BRANCH_SHEET_ID, range: `'${tab.properties.title.replace(/'/g, "''")}'!A:Z`,
  });
  const rows = resp.data.values || [];
  const headers = (rows[0] || []).map(norm);
  const col = (name, fallback) => { const i = headers.indexOf(name); return i >= 0 ? i : fallback; };
  const cChain = col('chain id', 0), cVendor = col('vendor id', 2), cName = col('vendor name (english)', 3), cVert = col('vertical', -1);
  const byChain = {}, verticalByChain = {};
  rows.slice(1).forEach(r => {
    const chainId = String(r[cChain] || '').trim().replace(/\.0+$/, '');
    const name = String(r[cName] || '').trim();
    if (!chainId) return;
    if (name) (byChain[chainId] = byChain[chainId] || []).push({ id: String(r[cVendor] || '').trim(), name });
    const vertical = cVert >= 0 ? String(r[cVert] || '').trim() : '';
    if (vertical && !verticalByChain[chainId]) verticalByChain[chainId] = vertical;   // first non-empty row of the chain
  });
  Object.values(byChain).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
  branchCache = { at: Date.now(), data: { byChain, verticalByChain } };
  return branchCache.data;
}

// { chainId: [{ id, name }] }: used for sign-up checks and the branch dropdown
async function loadBranchMap() { return (await loadBranchData()).byChain; }

module.exports = { loadBranchMap, loadBranchData };
