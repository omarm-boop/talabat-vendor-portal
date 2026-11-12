const { google } = require('googleapis');

// The product catalog: a Google Sheet with ~345,000 rows (Master Product Code | Item Barcodes | Item Name (Arabic) |
// Item Name (English) | Item Image Path). It is far too big to download or IMPORTRANGE, so the portal asks Google
// for only the few rows that match what the vendor typed (Google Visualization query), using the service account.
const SOURCE_ID  = '1FD1tCUDypNzpVx3zHCfEUxyI2sB3s_1mpDS5ZuwFQ9s';
const SOURCE_GID = 1949094463;
const CACHE_MS   = 10 * 60 * 1000;
const MAX_CACHED = 500;

let tokenCache = { token: '', exp: 0 };
let colsCache = null;
const queryCache = new Map();   // typed text -> { at, results }

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.JWT({
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
  if (!m) throw new Error('catalog sheet not readable (is it shared with the service account?)');
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

const esc = s => String(s).replace(/\\/g, '').replace(/'/g, "\\'");
const cell = c => (c && c.v !== null && c.v !== undefined) ? String(c.v) : '';

// -> [{ masterCode, barcode, name }] (at most 25). Throws when the catalog cannot be queried.
async function searchCatalog(raw) {
  const q = norm(raw);
  if (q.length < 2) return [];
  const hit = queryCache.get(q);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;

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

  if (queryCache.size >= MAX_CACHED) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(q, { at: Date.now(), results });
  return results;
}

module.exports = { searchCatalog };
