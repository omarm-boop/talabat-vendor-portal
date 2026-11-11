const { google } = require('googleapis');
const { Redis } = require('@upstash/redis');
const { getPacked, setPacked } = require('./cache-zip');

// The "Final Database" tab of the branch master file is the base data of every vendor. Columns are found by header name:
//   Chain ID | Chain Name | Branch Id | Vendor Name (English) | Chain Vertical      (the first column is just a row number)
const BRANCH_SHEET_ID  = '1bhCkMlLw4vJM23NBe8jNkNcatL3RAbj9qLh0b04S6ps';
const BRANCH_TAB_NAME  = 'Final Database';
const BRANCH_SHEET_GID = 1244934692;   // the older tab, used only if "Final Database" cannot be found
const CACHE_MS = 10 * 60 * 1000;
const REDIS_KEY = 'branches:final-db:v1';
let memCache = { at: 0, data: null };
let redis = null;
const getRedis = () => redis || (redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }));

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Returns { byChain: { chainId: [{ id, name }] }, verticalByChain: { chainId: 'grocery' | 'pet shop' | ... } }.
// Throws if the sheet cannot be read (e.g. not shared with the service account).
async function loadBranchData() {
  if (memCache.data && Date.now() - memCache.at < CACHE_MS) return memCache.data;
  // other server instances share one copy through Redis, so a cold start does not re-read the whole sheet
  if (process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const c = await getPacked(getRedis(), REDIS_KEY);
      if (c && c.byChain && c.verticalByChain) { memCache = { at: Date.now(), data: c }; return c; }
    } catch (_) { /* fall through to the sheet */ }
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.JWT({
    email: credentials.client_email, key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BRANCH_SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const tabs = meta.data.sheets || [];
  const tab = tabs.find(s => norm(s.properties.title) === norm(BRANCH_TAB_NAME)) || tabs.find(s => s.properties.sheetId === BRANCH_SHEET_GID);
  if (!tab) throw new Error('Branch tab not found');
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: BRANCH_SHEET_ID, range: `'${tab.properties.title.replace(/'/g, "''")}'!A:Z`,
  });
  const rows = resp.data.values || [];
  const headers = (rows[0] || []).map(norm);
  const find = (...names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };
  const cChain = find('chain id'), cBranch = find('branch id', 'vendor id'), cName = find('vendor name (english)'), cVert = find('chain vertical', 'vertical');
  if (cChain < 0 || cName < 0) throw new Error('Branch list columns not found (expected "Chain ID" and "Vendor Name (English)")');
  const byChain = {}, verticalByChain = {};
  rows.slice(1).forEach(r => {
    const chainId = String(r[cChain] || '').trim().replace(/\.0+$/, '');
    const name = String(r[cName] || '').trim();
    if (!chainId) return;
    if (name) (byChain[chainId] = byChain[chainId] || []).push({ id: cBranch >= 0 ? String(r[cBranch] || '').trim() : '', name });
    const vertical = cVert >= 0 ? String(r[cVert] || '').trim() : '';
    if (vertical && !verticalByChain[chainId]) verticalByChain[chainId] = vertical;   // first non-empty row of the chain
  });
  Object.values(byChain).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
  const data = { byChain, verticalByChain };
  memCache = { at: Date.now(), data };
  if (process.env.UPSTASH_REDIS_REST_URL) setPacked(getRedis(), REDIS_KEY, data, { ex: Math.round(CACHE_MS / 1000) }).catch(() => {});
  return data;
}

// { chainId: [{ id, name }] }: used for sign-up checks and the branch dropdown
async function loadBranchMap() { return (await loadBranchData()).byChain; }

module.exports = { loadBranchMap, loadBranchData };
