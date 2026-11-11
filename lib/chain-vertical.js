const { google } = require('googleapis');
const { loadBranchData } = require('./branches');

// "Chain Vertical" tab of the tracking sheet (an export of Talabat's chain data):
//   "Chain Attributes Chain ID"        -> the Chain ID the vendor signs in with
//   "Chain Attributes Chain Vertical"  -> Pharmacy / Grocery / ...
const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TAB_GID   = 729652391;
const TAB_NAME  = 'Chain Vertical';
const ID_HEADER = 'chain attributes chain id';
const VERTICAL_HEADER = 'chain attributes chain vertical';
const CACHE_MS  = 10 * 60 * 1000;
let cache = { at: 0, byChain: null };

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Maps the vertical's name to the portal's two brand types. Anything it does not recognise returns ''
// (the vendor is then asked once, as before).
function brandFromVertical(v) {
  const s = norm(v);
  if (!s) return '';
  if (s.includes('pharm') || s.includes('صيدل')) return 'pharmacy';
  if (/groc|super ?market|hyper ?market|mini ?market|convenience|dark ?store|بقال|سوبر/.test(s)) return 'grocery';
  return '';
}

async function loadVerticalMap() {
  if (cache.byChain && Date.now() - cache.at < CACHE_MS) return cache.byChain;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.JWT({
    email: credentials.client_email, key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const all = meta.data.sheets || [];
  const tab = all.find(s => s.properties.sheetId === TAB_GID) || all.find(s => norm(s.properties.title) === norm(TAB_NAME));
  if (!tab) throw new Error('Chain Vertical tab not found');
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `'${tab.properties.title.replace(/'/g, "''")}'`,
  });
  const rows = resp.data.values || [];
  const headers = (rows[0] || []).map(norm);
  const idCol = headers.indexOf(ID_HEADER), vCol = headers.indexOf(VERTICAL_HEADER);
  if (idCol < 0 || vCol < 0) throw new Error('Chain Vertical columns not found (expected "Chain Attributes Chain ID" and "Chain Attributes Chain Vertical")');
  const byChain = {}, unmapped = new Set();
  rows.slice(1).forEach(r => {
    const id = String(r[idCol] || '').trim().replace(/\.0+$/, '');
    const vertical = String(r[vCol] || '').trim();
    if (!id || !vertical) return;
    const brand = brandFromVertical(vertical);
    if (!brand) unmapped.add(vertical);
    byChain[id] = { vertical, brand };
  });
  if (unmapped.size) console.warn('chain-vertical: verticals not mapped to pharmacy/grocery:', [...unmapped].slice(0, 20).join(' | '));
  cache = { at: Date.now(), byChain };
  return byChain;
}

// 'pharmacy' | 'grocery' | '' (unknown chain, unrecognised vertical, or the sheets cannot be read).
// The branch master list's "Vertical" column is the main source; the "Chain Vertical" tab is the backup.
async function brandForChain(chainId) {
  const id = String(chainId || '').trim();
  try {
    const { verticalByChain } = await loadBranchData();
    const brand = brandFromVertical(verticalByChain[id]);
    if (brand) return brand;
  } catch (err) {
    console.warn('branch master list unavailable for the vertical:', err.message);
  }
  try {
    const e = (await loadVerticalMap())[id];
    return e ? e.brand : '';
  } catch (err) {
    console.warn('chain-vertical tab unavailable:', err.message);
    return '';
  }
}

module.exports = { brandForChain, brandFromVertical, loadVerticalMap };
