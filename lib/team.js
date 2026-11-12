// Talabat team accounts live in the "Team" tab of the tracking sheet: Email | Password | Name | Role (agent / monitor).
// Rows in "Credentials" with Chain ID 0 (the old place for team accounts) still work until they are moved to Team.
const SHEET_ID  = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const TEAM_TAB  = 'Team';
const CREDS_TAB = 'Credentials';

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const colLetter = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// Returns [{ email, password, name, role, rowNum, tab, passCol, legacy }]. The Team tab wins if an email is in both places.
async function loadTeamMembers(sheets) {
  const members = [];
  const seen = new Set();

  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TEAM_TAB}!A:Z` });
    const rows = resp.data.values || [];
    const headers = (rows[0] || []).map(norm);
    const find = (...names) => { for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; } return -1; };
    const cEmail = find('email', 'e-mail'), cPass = find('password'), cName = find('name'), cRole = find('role');
    if (cEmail >= 0 && cPass >= 0) {
      rows.slice(1).forEach((r, i) => {
        const email = String(r[cEmail] || '').toLowerCase().trim();
        if (!email || seen.has(email)) return;
        seen.add(email);
        members.push({
          email, password: String(r[cPass] || ''), name: cName >= 0 ? String(r[cName] || '').trim() : '',
          role: (cRole >= 0 ? String(r[cRole] || '').trim().toLowerCase() : '') || 'agent',
          rowNum: i + 2, tab: TEAM_TAB, passCol: colLetter(cPass), legacy: false,
        });
      });
    }
  } catch (e) { console.warn('team tab unavailable:', e.message); }

  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${CREDS_TAB}!A:F` });
    (resp.data.values || []).forEach((r, i) => {
      if (i === 0 || String(r[2] || '').trim() !== '0') return;
      const email = String(r[0] || '').toLowerCase().trim();
      if (!email || seen.has(email)) return;
      seen.add(email);
      const name = String(r[3] || '').trim();
      members.push({
        email, password: String(r[1] || ''), name: name && name !== 'Talabat' ? name : '',
        role: String(r[4] || '').trim().toLowerCase() || 'agent',
        rowNum: i + 1, tab: CREDS_TAB, passCol: 'B', legacy: true,
      });
    });
  } catch (e) { console.warn('credentials team rows unavailable:', e.message); }

  return members;
}

module.exports = { loadTeamMembers };
