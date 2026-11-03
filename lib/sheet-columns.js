// Makes sure a tab has enough columns (Sheet1: rejection codes Z, resubmission links AA/AB, brand/item fields AC-AF).
// Runs once per warm serverless instance; failures are non-fatal.
const ensured = {}; // tab -> column count already ensured

async function ensureColumns(sheets, spreadsheetId, tab, needed) {
  if ((ensured[tab] || 0) >= needed) return;
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
    ensured[tab] = needed;
  } catch (e) {
    console.warn('ensureColumns (non-fatal):', e.message);
  }
}

module.exports = { ensureColumns };
