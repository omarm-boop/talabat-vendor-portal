// Thin Resend wrapper. Requires RESEND_API_KEY env var.
// Falls back silently if not configured.
async function sendEmail(to, subject, html) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Vendor Portal <noreply@talabat.com>';
  if (!key || !to || !String(to).includes('@')) return false;
  try {
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
  } catch (e) {
    console.error('email.js error:', e.message);
    return false;
  }
}

module.exports = { sendEmail };
