const { google } = require('googleapis');

// Branch master list: A = Chain ID, B = Chain Name, C = Vendor Id, D = Vendor Name (English)
const BRANCH_SHEET_ID  = '1bhCkMlLw4vJM23NBe8jNkNcatL3RAbj9qLh0b04S6ps';
const BRANCH_SHEET_GID = 1244934692;
const BRANCH_CACHE_MS  = 10 * 60 * 1000;
let branchCache = { at: 0, byChain: null };

// Returns { [chainId]: [{ id, name }] }. Throws if the sheet cannot be read (e.g. not shared with the service account).
async function loadBranchMap() {
  if (branchCache.byChain && Date.now() - branchCache.at < BRANCH_CACHE_MS) return branchCache.byChain;
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
    spreadsheetId: BRANCH_SHEET_ID, range: `'${tab.properties.title.replace(/'/g, "''")}'!A:D`,
  });
  const byChain = {};
  (resp.data.values || []).slice(1).forEach(r => {
    const chainId = String(r[0] || '').trim();
    const name = String(r[3] || '').trim();
    if (!chainId || !name) return;
    (byChain[chainId] = byChain[chainId] || []).push({ id: String(r[2] || '').trim(), name });
  });
  Object.values(byChain).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
  branchCache = { at: Date.now(), byChain };
  return byChain;
}

module.exports = { loadBranchMap };
