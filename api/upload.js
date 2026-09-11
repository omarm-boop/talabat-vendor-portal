const { put } = require('@vercel/blob');

const ALLOWED   = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

  const { filename, contentType, data } = body || {};
  if (!data || !filename) return res.status(400).json({ error: 'filename and data required' });
  if (!ALLOWED.includes(contentType)) return res.status(400).json({ error: 'Only JPG, PNG, and WEBP are allowed' });

  try {
    const base64 = data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'File exceeds the 10 MB limit' });

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const blob = await put(`vendor-photos/${Date.now()}-${safeName}`, buffer, {
      access: 'public',
      contentType,
    });

    return res.json({ url: blob.url });
  } catch (err) {
    console.error('upload.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
