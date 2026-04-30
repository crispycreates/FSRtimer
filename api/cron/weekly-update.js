// Vercel cron handler: GET /api/cron/weekly-update
// Runs once per week. For every saved countdown timer, emails the owner
// with the current days-remaining number. Auth is via Bearer CRON_SECRET
// (Vercel automatically sends this header for cron jobs when CRON_SECRET
// is set as an environment variable).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wurgfbjgatezlmtzoylm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Resend's verified test sender. Works without verifying a domain.
const FROM_ADDRESS = 'Neon Rain Countdown <onboarding@resend.dev>';
const APP_URL = 'https://fsrtimer.vercel.app';

function escapeHtml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function formatLong(date) {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function buildEmail({ title, days, hours, target_at, share_token }) {
  const safeTitle = escapeHtml(title || 'Countdown');
  const targetPretty = escapeHtml(formatLong(target_at));
  const liveImg = `${APP_URL}/api/countdown?token=${encodeURIComponent(share_token)}`;
  const subject = days > 0
    ? `${days} days left on "${title}"`
    : `"${title}" — countdown complete`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#04060c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#ecf4ff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
    <tr><td style="padding-bottom:16px;">
      <p style="margin:0;font-size:13px;letter-spacing:3px;color:#9db4d8;text-transform:uppercase;">Your weekly countdown</p>
    </td></tr>
    <tr><td>
      <img src="${liveImg}" alt="${safeTitle}: ${days} days left" width="600" height="220" style="display:block;width:100%;max-width:600px;height:auto;border-radius:20px;"/>
    </td></tr>
    <tr><td style="padding:24px 8px 8px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ecf4ff;">${days > 0 ? `${days} days to go` : 'Countdown complete'}</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#9db4d8;">
        ${days > 0
          ? `"${safeTitle}" wraps on <strong style="color:#52f7ff;">${targetPretty}</strong>. The image above pulls a fresh count whenever you reopen this email.`
          : `"${safeTitle}" reached its target on <strong style="color:#52f7ff;">${targetPretty}</strong>. Time to set a new one.`}
      </p>
      <p style="margin:24px 0 0;">
        <a href="${APP_URL}" style="display:inline-block;padding:12px 22px;border-radius:14px;background:linear-gradient(90deg,#52f7ff,#9b6bff);color:#04060c;font-weight:700;text-decoration:none;">Open the app</a>
      </p>
    </td></tr>
    <tr><td style="padding:32px 8px 0;border-top:1px solid rgba(126,175,255,0.12);margin-top:24px;">
      <p style="margin:24px 0 0;font-size:11px;color:#6780a8;line-height:1.5;">
        Sent automatically every Monday morning. Manage your countdown at <a href="${APP_URL}" style="color:#52f7ff;">${APP_URL.replace('https://', '')}</a>.
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text = days > 0
    ? `${days} days left on "${title}".\n\nTarget date: ${formatLong(target_at)}.\n\nOpen the app: ${APP_URL}\nLive image: ${liveImg}`
    : `"${title}" reached its target on ${formatLong(target_at)}. Set a new one: ${APP_URL}`;

  return { subject, html, text };
}

async function fetchAllTimers() {
  // Use the service role key to read both auth.users emails and countdown_timers.
  // Service role bypasses RLS, which is exactly what a cron job needs.
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  // 1. Pull all timer rows
  const tRes = await fetch(`${SUPABASE_URL}/rest/v1/countdown_timers?select=user_id,title,total_days,target_at,share_token`, { headers });
  if (!tRes.ok) throw new Error(`Timer fetch failed: ${tRes.status} ${await tRes.text()}`);
  const timers = await tRes.json();
  if (!Array.isArray(timers) || timers.length === 0) return [];

  // 2. Look up the matching user emails. Service role can query auth.users via the admin endpoint.
  const userIds = [...new Set(timers.map(t => t.user_id))];
  const userMap = {};
  for (const id of userIds) {
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers });
    if (uRes.ok) {
      const u = await uRes.json();
      if (u && u.email) userMap[id] = u.email;
    }
  }

  // 3. Combine
  return timers
    .filter(t => userMap[t.user_id])
    .map(t => ({ ...t, email: userMap[t.user_id] }));
}

async function sendEmail({ to, subject, html, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html,
      text
    })
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Resend ${r.status}: ${body}`);
  }
  return r.json();
}

module.exports = async function handler(req, res) {
  // Auth: Vercel cron sends "Authorization: Bearer ${CRON_SECRET}" automatically
  // when CRON_SECRET is set as a project env var. Reject any request without it.
  const auth = req.headers.authorization || '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    return res.status(500).json({ error: 'missing env vars' });
  }

  try {
    const rows = await fetchAllTimers();
    const results = [];

    for (const row of rows) {
      const targetMs = new Date(row.target_at).getTime();
      const diff = Math.max(targetMs - Date.now(), 0);
      const totalSec = Math.floor(diff / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);

      const email = buildEmail({
        title: row.title,
        days,
        hours,
        target_at: row.target_at,
        share_token: row.share_token
      });

      try {
        const sent = await sendEmail({
          to: row.email,
          subject: email.subject,
          html: email.html,
          text: email.text
        });
        results.push({ to: row.email, ok: true, id: sent.id || null, days });
      } catch (err) {
        results.push({ to: row.email, ok: false, error: String(err.message || err), days });
      }
    }

    return res.status(200).json({
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
