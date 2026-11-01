/**
 * One-shot script: removes agent.test@talabat.com from the Credentials sheet.
 *
 * Usage:
 *   $env:GOOGLE_SERVICE_ACCOUNT = (Get-Content .env.local | Select-String GOOGLE_SERVICE_ACCOUNT | ...)
 *   -- OR set it as an environment variable, then:
 *   node scripts/cleanup-test-account.js
 *
 * Requires GOOGLE_SERVICE_ACCOUNT env var (the JSON service-account key).
 */

const { google } = require('googleapis');

const SHEET_ID   = '1MlxEtSPmPcc4Usq13w9CWedvNMws0Un2XD6QNaazSiQ';
const CREDS_TAB  = 'Credentials';
const TARGET_EMAIL = 'agent.test@talabat.com';

(async () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Get spreadsheet metadata to find the sheet (tab) ID
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const tab  = meta.data.sheets.find(s => s.properties.title === CREDS_TAB);
  if (!tab) { console.error(`Tab "${CREDS_TAB}" not found.`); process.exit(1); }
  const sheetId = tab.properties.sheetId;

  // Read all rows
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CREDS_TAB}!A:A`,
  });
  const rows = resp.data.values || [];

  // Find the 0-based row index of the target email
  const rowIdx = rows.findIndex(r => String(r[0] || '').toLowerCase().trim() === TARGET_EMAIL);
  if (rowIdx === -1) {
    console.log(`"${TARGET_EMAIL}" not found in the Credentials sheet — nothing to delete.`);
    process.exit(0);
  }

  console.log(`Found "${TARGET_EMAIL}" at sheet row ${rowIdx + 1}. Deleting…`);

  // Delete the row using batchUpdate (deleteDimension)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIdx,   // 0-based, inclusive
            endIndex:   rowIdx + 1, // exclusive
          },
        },
      }],
    },
  });

  console.log(`Done. Row deleted.`);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
