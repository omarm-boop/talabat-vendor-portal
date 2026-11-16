// Retries a Google Sheets call that was refused for being too busy (429) or hit a Google hiccup (5xx).
// A burst of vendors submitting at once can pass Google's per-minute limit; waiting a moment and trying again
// is enough. Total wait is capped (about 5 s) so the serverless function never reaches its time limit.
const DELAYS = [600, 1400, 3000];

function isBusy(err) {
  const code = Number(err && (err.code || (err.response && err.response.status)));
  if (code === 429 || (code >= 500 && code <= 599)) return true;
  return /quota|rate limit|too many requests|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err && err.message));
}

async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (err) {
      if (i >= DELAYS.length || !isBusy(err)) throw err;
      await new Promise(r => setTimeout(r, DELAYS[i] + Math.floor(Math.random() * 400)));
    }
  }
}

module.exports = { withRetry, isBusy };
