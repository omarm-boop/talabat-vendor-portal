/**
 * Engizni mail sender (Google Apps Script).
 *
 * The portal sends its emails (assignment, status updates, password reset codes) by calling this web app,
 * which sends them from the Google account that owns the script. No domain or DNS setup is needed.
 *
 * Setup: see engizni-mail-setup.md. In short: paste this code, change SECRET, run testMail once to allow
 * access, then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone) and put the
 * /exec link and the SECRET in Vercel as MAIL_WEBHOOK_URL and MAIL_WEBHOOK_SECRET.
 */

// Any long random text. It must be exactly the same as MAIL_WEBHOOK_SECRET in Vercel. Keep it private.
const SECRET = 'PASTE_A_LONG_RANDOM_TEXT_HERE';

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (SECRET === 'PASTE_A_LONG_RANDOM_TEXT_HERE' || !d || d.secret !== SECRET) return reply_({ ok: false, error: 'bad secret' });
    const to = String(d.to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return reply_({ ok: false, error: 'bad address' });
    if (MailApp.getRemainingDailyQuota() < 1) return reply_({ ok: false, error: 'daily mail limit reached' });
    MailApp.sendEmail({
      to: to,
      subject: String(d.subject || 'Engizni').slice(0, 200),
      htmlBody: String(d.html || ''),
      name: 'Engizni',
    });
    return reply_({ ok: true });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor: it asks for permission, then sends a test email to yourself.
function testMail() {
  const me = Session.getActiveUser().getEmail();
  MailApp.sendEmail(me, 'Engizni test email', '<p>If you can read this, Engizni can send email from this account.</p>');
  Logger.log('Sent to ' + me + '. Emails left today: ' + MailApp.getRemainingDailyQuota());
}
