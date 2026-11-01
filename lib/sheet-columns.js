// Makes sure Sheet1 has enough columns for the rejection codes (Z) and resubmission links (AA, AB).
// Runs once per warm serverless instance; failures are non-fatal.
let ensured = false;

async function ensureColumns(sheets, spreadsheetId, tab, needed) {
  if (ensured) return;
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)',
    });
    const sh = (meta.data.sheets || []).find(s => s.properties.title === tab);
    const have = sh ? sh.properties.gridProperties.columnCount : needed;
    if (sh && have < needed) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ appendDimension: { sheetId: sh.properties.sheetId, dimension: 'COLUMNS', length: needed - have } }] },
      });
    }
    ensured = true;
  } catch (e) {
    console.warn('ensureColumns (non-fatal):', e.message);
  }
}

module.exports = { ensureColumns };
