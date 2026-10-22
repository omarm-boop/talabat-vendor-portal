const { Redis } = require('@upstash/redis');
const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');

// Pointing to your exact Sheet ID and Tab
const CATALOG_SHEET_ID = process.env.CATALOG_SHEET_ID || '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CATALOG_TAB = 'PIM'; 
const CACHE_KEY = 'talabat:master_pim_catalog';
const CACHE_TTL_SECONDS = 3600; // Cache for 1 hour to prevent hitting Google Sheets limits

let redis = null;
function getRedis() {
  if (!redis && process.env.UPSTASH_REDIS_REST_URL) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

async function getMasterList() {
  const r = getRedis();
  if (r) {
    try {
      const cached = await r.get(CACHE_KEY);
      if (cached) return Array.isArray(cached) ? cached : JSON.parse(cached);
    } catch (e) {
      console.warn('Redis cache read failed, falling back to Sheets:', e.message);
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Fetch Columns A (Master Code), B (Barcode), C (Name)
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: CATALOG_SHEET_ID,
    range: `${CATALOG_TAB}!A2:C`,
  });

  const rows = resp.data.values || [];
  
  const items = rows
    .filter(row => row[0] && row[2]) // Must have at least Master Code and Name
    .map(row => ({
      masterCode: String(row[0]).trim(),
      barcode: row[1] ? String(row[1]).trim() : '',
      nameEn: String(row[2]).trim(),
    }));

  if (r && items.length > 0) {
    try {
      await r.set(CACHE_KEY, JSON.stringify(items), { ex: CACHE_TTL_SECONDS });
    } catch (e) {
      console.warn('Redis cache write failed:', e.message);
    }
  }

  return items;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const sess = await verifyRequest(req);
  if (!sess) return res.status(401).json({ error: 'Unauthorized' });

  const query = (req.query.q || '').toLowerCase().trim();
  if (!query || query.length < 2) return res.json({ results: [] });

  try {
    const list = await getMasterList();
    const results = list
      .filter(item => 
        item.barcode.toLowerCase().includes(query) || 
        item.masterCode.toLowerCase().includes(query) ||
        item.nameEn.toLowerCase().includes(query)
      )
      .slice(0, 10); // Return top 10 matches for a clean dropdown

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Barcode search error:', err);
    return res.status(500).json({ error: 'Failed to search barcodes' });
  }
};
