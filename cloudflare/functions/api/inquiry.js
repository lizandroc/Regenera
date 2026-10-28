// POST /api/inquiry — receives the Regenera inquiry form and emails it through Resend.
//
// Secrets and settings (Cloudflare Pages → Settings → Variables and Secrets):
//   RESEND_API_KEY    secret   Resend API key with "sending access" only
//   MAIL_FROM         text     e.g. "Regenera website <inquiries@weareregenera.com>" (verified Resend domain)
//   MAIL_TO           text     inbox that receives inquiries, e.g. hello@weareregenera.com
//   TURNSTILE_SECRET  secret   optional; when set, every request must pass Cloudflare Turnstile
//   ALLOWED_ORIGINS   text     optional; extra origins allowed to post, comma separated
//   RATE_LIMITER      binding  optional; Workers rate limiting binding (keyed by visitor IP)

const ENGAGE = new Set([
  'I have a property',
  'I am interested in investing',
  'I am an operator',
  'I represent an institution',
  'I am a specialist or collaborator',
  'Other',
]);
const LIMITS = { name: 120, org: 160, email: 254, location: 160, description: 4000, link: 500 };
const MAX_BODY = 16 * 1024;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const json = (status, data) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Strip control characters; single-line fields also lose line breaks (no header injection).
const clean = (v, multiline = false) => String(v ?? '')
  .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ')
  .trim();

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = new Set([url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
  if (!origin || !allowed.has(origin)) return json(403, { ok: false, error: 'Forbidden.' });

  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return json(415, { ok: false, error: 'Unsupported content type.' });
  }
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json(413, { ok: false, error: 'Request too large.' });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key: `inquiry:${ip}` });
    if (!success) return json(429, { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'Request too large.' });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'Please check the form and try again.' }); }
  if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'Please check the form and try again.' });

  // Honeypot: people never see this field. Bots that fill it get a quiet success and no email.
  if (clean(body.website_hp)) return json(200, { ok: true });

  const f = {
    engage: clean(body.engage),
    name: clean(body.name),
    org: clean(body.org),
    email: clean(body.email).toLowerCase(),
    location: clean(body.location),
    description: clean(body.description, true),
    link: clean(body.link),
  };
  const problems = [];
  if (!ENGAGE.has(f.engage)) problems.push('choose how you would like to engage');
  if (!f.name) problems.push('add your name');
  if (!EMAIL_RE.test(f.email)) problems.push('add a valid email address');
  if (f.link) {
    try { const u = new URL(f.link); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { problems.push('check the website link'); }
  }
  for (const [k, max] of Object.entries(LIMITS)) if (f[k].length > max) problems.push(`shorten the ${k} field`);
  if (problems.length) return json(400, { ok: false, error: 'Please ' + problems.join(', ') + '.' });

  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', clean(body.turnstile));
    if (ip) form.append('remoteip', ip);
    const tv = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
      .then(r => r.json()).catch(() => ({ success: false }));
    if (!tv.success) return json(400, { ok: false, error: 'Please complete the security check and try again.' });
  }

  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.MAIL_TO) {
    console.error('inquiry: missing RESEND_API_KEY, MAIL_FROM or MAIL_TO');
    return json(503, { ok: false, error: 'The inbox is not available right now.' });
  }

  const rows = [
    ['Engagement', f.engage], ['Name', f.name], ['Organization', f.org || '-'], ['Email', f.email],
    ['Location', f.location || '-'], ['Link', f.link || '-'],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + (f.description || '(no description)') +
    `\n\n---\nSent from ${url.host} on ${new Date().toISOString()}`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#26292b">
<h2 style="font-weight:600;font-size:18px;margin:0 0 12px">New inquiry from the Regenera website</h2>
<table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><th align="left" style="color:#5f6b70;font-weight:600;padding-right:16px">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>
<p style="white-space:pre-wrap;margin-top:16px">${escapeHtml(f.description || '(no description)')}</p>
<p style="color:#5f6b70;font-size:12px">Sent from ${escapeHtml(url.host)}. Reply to this email to answer ${escapeHtml(f.name)} directly.</p></div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: env.MAIL_TO.split(',').map(s => s.trim()).filter(Boolean),
      reply_to: f.email,
      subject: `Website inquiry: ${f.engage} · ${f.name}`.slice(0, 200),
      text,
      html,
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    console.error('inquiry: Resend rejected the message', res ? res.status : 'network error');
    return json(502, { ok: false, error: 'We could not send your inquiry just now.' });
  }
  return json(200, { ok: true });
}

export function onRequest() {
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}
