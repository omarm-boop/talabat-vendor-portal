// Sends email for the portal. Two ways, tried in this order:
//   1. A Google Apps Script web app that sends from a company Google account (no domain setup needed).
//      Needs MAIL_WEBHOOK_URL (the web app's /exec link) and MAIL_WEBHOOK_SECRET (the same secret the script checks).
//      Setup steps: apps-script/engizni-mail.gs
//   2. Resend, only if RESEND_API_KEY is set (the older way; needs a verified sender domain).
// sendEmail never throws: it returns true when the mail was handed over, false otherwise (the reason is logged).

function emailConfigured() {
  return !!(process.env.MAIL_WEBHOOK_URL && process.env.MAIL_WEBHOOK_SECRET) || !!process.env.RESEND_API_KEY;
}

async function viaGoogle(to, subject, html) {
  const resp = await fetch(process.env.MAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // the script reads the body as text and parses it as JSON
    body: JSON.stringify({ secret: process.env.MAIL_WEBHOOK_SECRET, to, subject, html }),
    redirect: 'follow',                                          // Apps Script answers through a redirect
  });
  const txt = await resp.text().catch(() => '');
  let out = null; try { out = JSON.parse(txt); } catch (_) {}
  if (resp.ok && out && out.ok) return true;
  console.error('Google mail webhook failed:', resp.status, (out && out.error) || txt.slice(0, 200));
  return false;
}

async function viaResend(to, subject, html) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Vendor Portal <noreply@talabat.com>';
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error('Resend error:', resp.status, txt);
    return false;
  }
  return true;
}

async function sendEmail(to, subject, html) {
  if (!to || !String(to).includes('@')) return false;
  try {
    if (process.env.MAIL_WEBHOOK_URL && process.env.MAIL_WEBHOOK_SECRET) {
      if (await viaGoogle(to, subject, html)) return true;
      if (!process.env.RESEND_API_KEY) return false;   // nothing else to try
    }
    if (process.env.RESEND_API_KEY) return await viaResend(to, subject, html);
    return false;
  } catch (e) {
    console.error('email.js error:', e.message);
    return false;
  }
}

module.exports = { sendEmail, emailConfigured };
