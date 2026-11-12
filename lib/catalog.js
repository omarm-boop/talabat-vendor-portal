const { google } = require('googleapis');
const { Redis } = require('@upstash/redis');
const { getPacked, setPacked } = require('./cache-zip');

// The product catalog: a Google Sheet with ~345,000 rows (Master Product Code | Item Barcodes | Item Name (Arabic) |
// Item Name (English) | Item Image Path). It is far too big to download or IMPORTRANGE, so the portal asks Google
// for only the few rows that match what the vendor typed (Google Visualization query), using the service account.
const SOURCE_ID  = '1FD1tCUDypNzpVx3zHCfEUxyI2sB3s_1mpDS5ZuwFQ9s';
const SOURCE_GID = 1949094463;
const CACHE_MS   = 10 * 60 * 1000;
const MAX_CACHED = 500;

let tokenCache = { token: '', exp: 0 };
let jwtClient = null;
let colsCache = null;
let redis = null;
const getRedis = () => redis || (redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }));
let barcodeIndex = null;    // { list: [barcode strings by row], title, idx: { master, barcode, ar, en }, at }
const INDEX_MS = 60 * 60 * 1000;
const REDIS_INDEX_KEY = 'catalog:barcodes:v1';
const colLetter = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const queryCache = new Map();   // typed text -> { at, results }

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = jwtClient = new google.auth.JWT({
    email: credentials.client_email, key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
  });
  const res = await auth.getAccessToken();
  const token = typeof res === 'string' ? res : res && res.token;
  if (!token) throw new Error('could not get a Google access token');
  tokenCache = { token, exp: Date.now() + 50 * 60 * 1000 };
  return token;
}

async function gviz(sql) {
  const url = `https://docs.google.com/spreadsheets/d/${SOURCE_ID}/gviz/tq?gid=${SOURCE_GID}&headers=1&tqx=out:json&tq=${encodeURIComponent(sql)}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + await getToken() } });
  const text = await r.text();
  const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
  if (!m) throw new Error(`query endpoint refused (HTTP ${r.status} ${String(text).replace(/\s+/g, ' ').slice(0, 50)})`);
  const j = JSON.parse(m[1]);
  if (j.status === 'error') throw new Error((j.errors || []).map(e => e.detailed_message || e.message).join('; ') || 'catalog query failed');
  return j.table;
}

// Finds the column letters and types by header name, so a moved column does not break the lookup.
async function columns() {
  if (colsCache) return colsCache;
  const t = await gviz('select * limit 1');
  const find = (...labels) => (t.cols || []).find(c => labels.includes(norm(c.label)));
  const master = find('master product code'), barcode = find('item barcodes', 'item barcode', 'barcode');
  const ar = find('item name (arabic)'), en = find('item name (english)');
  if (!barcode || !(en || ar)) throw new Error('catalog columns not found (expected "Item Barcodes" and "Item Name (English)")');
  colsCache = { master, barcode, ar, en };
  return colsCache;
}

// ---- Second way in: the Sheets API (works with plain sharing). It keeps a list of all barcodes (one column, shared through
// Redis), finds the matching rows in memory and then reads only those rows. Barcode searches only.
async function sheetsClient() {
  if (!jwtClient) await getToken();
  return google.sheets({ version: 'v4', auth: jwtClient });
}
async function loadBarcodeIndex() {
  if (barcodeIndex && Date.now() - barcodeIndex.at < INDEX_MS) return barcodeIndex;
  if (process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const c = await getPacked(getRedis(), REDIS_INDEX_KEY);
      if (c && Array.isArray(c.list) && c.title && c.idx) { barcodeIndex = { ...c, at: Date.now() }; return barcodeIndex; }
    } catch (_) { /* rebuild below */ }
  }
  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_ID, fields: 'sheets.properties(sheetId,title)' });
  const tab = (meta.data.sheets || []).find(s => s.properties.sheetId === SOURCE_GID);
  if (!tab) throw new Error('catalog tab not found');
  const title = tab.properties.title, tq = `'${title.replace(/'/g, "''")}'`;
  const head = await sheets.spreadsheets.values.get({ spreadsheetId: SOURCE_ID, range: `${tq}!A1:J1` });
  const names = ((head.data.values || [[]])[0] || []).map(norm);
  const at = (...labels) => { for (const l of labels) { const i = names.indexOf(l); if (i >= 0) return i; } return -1; };
  const idx = { master: at('master product code'), barcode: at('item barcodes', 'item barcode', 'barcode'), ar: at('item name (arabic)'), en: at('item name (english)') };
  if (idx.barcode < 0) throw new Error('catalog column "Item Barcodes" not found');
  const L = colLetter(idx.barcode);
  const col = await sheets.spreadsheets.values.get({ spreadsheetId: SOURCE_ID, range: `${tq}!${L}2:${L}`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const list = (col.data.values || []).map(r => (r[0] === undefined || r[0] === null) ? '' : String(r[0]));
  barcodeIndex = { list, title, idx, at: Date.now() };
  if (process.env.UPSTASH_REDIS_REST_URL) setPacked(getRedis(), REDIS_INDEX_KEY, { list, title, idx }, { ex: 6 * 3600 }).catch(() => {});
  return barcodeIndex;
}
async function searchBySheetsApi(q) {
  if (!/^\d{3,}$/.test(q)) throw new Error('names can only be searched through the query endpoint');
  const ix = await loadBarcodeIndex();
  const hits = [];
  for (let i = 0; i < ix.list.length && hits.length < 25; i++) {
    const b = ix.list[i];
    if (b === q) hits.unshift(i); else if (b.startsWith(q)) hits.push(i);
  }
  if (!hits.length) return [];
  const sheets = await sheetsClient();
  const tq = `'${ix.title.replace(/'/g, "''")}'`;
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SOURCE_ID, ranges: hits.slice(0, 25).map(i => `${tq}!A${i + 2}:J${i + 2}`), valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const val = (row, i) => (i >= 0 && row[i] !== undefined && row[i] !== null) ? String(row[i]) : '';
  return (resp.data.valueRanges || []).map(vr => {
    const row = (vr.values && vr.values[0]) || [];
    const master = val(row, ix.idx.master);
    return { masterCode: /^#/.test(master) ? '' : master, barcode: val(row, ix.idx.barcode), name: val(row, ix.idx.en) || val(row, ix.idx.ar) };
  }).filter(x => x.barcode || x.name);
}

const esc = s => String(s).replace(/\\/g, '').replace(/'/g, "\\'");
const cell = c => (c && c.v !== null && c.v !== undefined) ? String(c.v) : '';

// -> [{ masterCode, barcode, name }] (at most 25). Throws when the catalog cannot be queried.
async function searchCatalog(raw) {
  const q = norm(raw);
  if (q.length < 2) return [];
  const hit = queryCache.get(q);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;
  let results;
  try {
    results = await searchByQuery(q);
  } catch (e1) {
    try {
      results = await searchBySheetsApi(q);
    } catch (e2) {
      let who = '';
      try { if (e2.code === 403 || /permission/i.test(String(e2.message))) who = ` | share the catalog sheet with: ${JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT).client_email}`; } catch (_) {}
      throw new Error(`${e1.message} | Sheets API: ${e2.code || ''} ${String(e2.message || e2).replace(/\s+/g, ' ').slice(0, 110)}${who}`);
    }
  }
  if (queryCache.size >= MAX_CACHED) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(q, { at: Date.now(), results });
  return results;
}

async function searchByQuery(q) {

  const c = await columns();
  const digits = /^\d+$/.test(q);
  let where = '';
  if (digits) {
    if (q.length < 3) return [];
    if (c.barcode.type === 'string') where = `${c.barcode.id} starts with '${esc(q)}'`;
    else if (q.length >= 6) where = `${c.barcode.id} = ${q}`;          // a numeric column can only be matched exactly
    if (where && c.master && c.master.type === 'string') where += ` or ${c.master.id} = '${esc(q)}'`;
  } else {
    if (q.length < 3) return [];
    const parts = [];
    if (c.en && c.en.type === 'string') parts.push(`lower(${c.en.id}) contains '${esc(q)}'`);
    if (c.ar && c.ar.type === 'string') parts.push(`lower(${c.ar.id}) contains '${esc(q)}'`);
    where = parts.join(' or ');
  }
  if (!where) return [];

  const ids = [c.master, c.barcode, c.ar, c.en].filter(Boolean).map(x => x.id);
  const order = [c.master, c.barcode, c.ar, c.en].filter(Boolean);
  const idx = col => order.indexOf(col);
  const run = async w => {
    const table = await gviz(`select ${ids.join(', ')} where ${w} limit 25`);
    return (table.rows || []).map(r => {
      const get = col => col ? cell((r.c || [])[idx(col)]) : '';
      const master = get(c.master);
      return { masterCode: /^#/.test(master) ? '' : master, barcode: get(c.barcode), name: get(c.en) || get(c.ar) };
    }).filter(x => x.barcode || x.name);
  };
  let results = await run(where);
  if (!results.length && digits && q.length >= 8) {
    // some barcodes are stored as numbers and some as text in the same column: try the other form too
    const other = c.barcode.type === 'string' ? `${c.barcode.id} = ${q}` : `${c.barcode.id} = '${esc(q)}'`;
    try { results = await run(other); } catch (_) { /* that form does not fit this column */ }
  }
  results.sort((a, b) => (b.barcode === q ? 1 : 0) - (a.barcode === q ? 1 : 0));   // an exact barcode first

  return results;
}

module.exports = { searchCatalog };
