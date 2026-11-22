// Working-hours SLA maths, the same rules as the dashboard: Fridays, Saturdays and Egyptian public holidays do not count.
// 24 working hours per request, 8 for high priority. Add the next year's holidays to the list when they are announced
// (the Islamic dates move every year).
const EG_HOLIDAYS = new Set([
  '2025-01-07','2025-01-25','2025-04-25','2025-05-01','2025-06-30','2025-07-23','2025-10-06',
  '2025-03-30','2025-03-31','2025-04-01','2025-06-06','2025-06-07','2025-06-08','2025-06-09','2025-06-27','2025-09-04',
  '2026-01-07','2026-01-25','2026-04-25','2026-05-01','2026-06-30','2026-07-23','2026-10-06',
  '2026-03-20','2026-03-21','2026-03-22','2026-05-27','2026-05-28','2026-05-29',
  '2027-01-07','2027-01-25','2027-04-25','2027-05-01','2027-06-30','2027-07-23','2027-10-06',
]);

function isWorkingDay(d) {
  const day = d.getUTCDay();   // 5 = Friday, 6 = Saturday
  if (day === 5 || day === 6) return false;
  return !EG_HOLIDAYS.has(d.toISOString().slice(0, 10));
}

function workingHoursSince(iso, nowMs) {
  const start = new Date(iso);
  const now = new Date(nowMs || Date.now());
  if (isNaN(start) || now <= start) return 0;
  let ms = 0, cursor = new Date(start);
  while (cursor < now) {
    const dayEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), 23, 59, 59, 999));
    const periodEnd = dayEnd < now ? new Date(dayEnd.getTime() + 1) : now;
    if (isWorkingDay(cursor)) ms += periodEnd - cursor;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }
  return ms / 3600000;
}

module.exports = { isWorkingDay, workingHoursSince };
