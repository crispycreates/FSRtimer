// Vercel serverless function: GET /api/countdown?token=<uuid>
// Returns an SVG that shows the live remaining time for the countdown
// identified by the share_token. Each request recalculates from now(),
// so when an email client refetches the image, the count updates.

const SUPABASE_URL = 'https://wurgfbjgatezlmtzoylm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1cmdmYmpnYXRlemxtdHpveWxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMDg5OTgsImV4cCI6MjA5Mjg4NDk5OH0.wxrrY6ZL5CcFCfziarIf-imG6jXadxmVKb4FLD6u2Vg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[c]);
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

function sendSvg(res, svg, status = 200) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(status).send(svg);
}

function errorSvg(message) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 120" width="600" height="120">
  <rect width="600" height="120" rx="16" fill="#0b1121" stroke="#ff4d8d" stroke-width="1"/>
  <text x="30" y="55" fill="#ecf4ff" font-family="-apple-system,Segoe UI,sans-serif" font-size="18" font-weight="700">Countdown unavailable</text>
  <text x="30" y="82" fill="#9db4d8" font-family="-apple-system,Segoe UI,sans-serif" font-size="13">${escapeXml(message)}</text>
</svg>`;
}

function countdownSvg({ title, days, hours, minutes, seconds, complete }) {
  const dStr = pad(days, 3);
  const tStr = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const safeTitle = escapeXml(String(title || 'Countdown').slice(0, 40).toUpperCase());
  const label = complete ? 'COMPLETE' : 'DAYS LEFT';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="600" height="220">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1121"/>
      <stop offset="100%" stop-color="#04060c"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#52f7ff"/>
      <stop offset="55%" stop-color="#9b6bff"/>
      <stop offset="100%" stop-color="#ff4d8d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="1.1" r="0.8">
      <stop offset="0%" stop-color="rgba(82,247,255,0.18)"/>
      <stop offset="60%" stop-color="rgba(82,247,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="600" height="220" rx="20" fill="url(#bg)" stroke="rgba(126,175,255,0.22)" stroke-width="1"/>
  <rect width="600" height="220" rx="20" fill="url(#glow)"/>
  <rect x="0" y="0" width="600" height="3" fill="url(#accent)"/>
  <text x="30" y="48" fill="#9db4d8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" letter-spacing="3" font-weight="700">${safeTitle}</text>
  <text x="30" y="138" fill="#ecf4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="80" font-weight="900" letter-spacing="-2" font-variant-numeric="tabular-nums">${dStr}</text>
  <text x="30" y="168" fill="#52f7ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="13" letter-spacing="4" font-weight="700">${label}</text>
  <text x="570" y="138" fill="#ecf4ff" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="36" font-weight="700" text-anchor="end" font-variant-numeric="tabular-nums">${tStr}</text>
  <text x="570" y="168" fill="#6780a8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10" letter-spacing="2" text-anchor="end">HOURS &#183; MINUTES &#183; SECONDS</text>
  <text x="30" y="200" fill="#6780a8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="10">Refreshes each time this email is reopened</text>
</svg>`;
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !UUID_RE.test(token)) {
      return sendSvg(res, errorSvg('Missing or malformed share token.'));
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_countdown_by_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ t: token })
    });

    if (!r.ok) {
      return sendSvg(res, errorSvg(`Service error (${r.status}). Try again shortly.`));
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return sendSvg(res, errorSvg('No countdown found for this token.'));
    }
    const timer = rows[0];

    const targetMs = new Date(timer.target_at).getTime();
    const diff = Math.max(targetMs - Date.now(), 0);
    const totalSec = Math.floor(diff / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    return sendSvg(
      res,
      countdownSvg({
        title: timer.title,
        days, hours, minutes, seconds,
        complete: diff === 0
      })
    );
  } catch (err) {
    return sendSvg(res, errorSvg('Unexpected error.'));
  }
};
