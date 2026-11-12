const { google } = require('googleapis');
const { verifyRequest } = require('../lib/verify');
const { setCors } = require('../lib/cors');
const { loadTeamMembers } = require('../lib/team');

const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDS_TAB = 'Credentials';
const TEAM_TTL  = 120; // seconds — team list changes rarely

let teamCache = null; // { data, expiresAt }

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!await verifyRequest(req)) return res.status(401).json({ error: 'Unauthorized' });

  // Serve from in-memory cache when warm (team list changes rarely)
  if (teamCache && teamCache.expiresAt > Date.now()) {
    return res.json(teamCache.data);
  }

  const names  = new Set();
  // agents: [{name, email}] for email→name resolution in the frontend
  const agents = [];

  // From TEAM_CREDENTIALS env var — exclude monitors
  try {
    const team = JSON.parse(process.env.TEAM_CREDENTIALS || '[]');
    team.forEach(m => {
      if ((m.role || '').toLowerCase() === 'monitor') return;
      const name = m.name || m.email || '';
      if (!name) return;
      names.add(name);
      agents.push({ name, email: (m.email || '').toLowerCase().trim() });
    });
  } catch (_) {}

  // From the Team tab (and older Credentials rows with Chain ID 0) - monitors are excluded
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    for (const m of await loadTeamMembers(sheets)) {
      if (m.role === 'monitor') continue;
      const display = m.name || m.email;
      if (!display || names.has(display)) continue;
      names.add(display);
      agents.push({ name: display, email: m.email });
    }
  } catch (_) {}

  const data = { names: [...names], agents };
  teamCache = { data, expiresAt: Date.now() + TEAM_TTL * 1000 };
  return res.json(data);
};
