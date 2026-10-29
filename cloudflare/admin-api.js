// Inquiry dashboard: /admin (page) and /api/admin/* (data).
//
// Anyone with the link sees a password screen. The dashboard password is its own secret,
// separate from any Cloudflare account. Visitors also give their name, which is recorded
// as "responded by". Guessing is limited: 5 wrong passwords from one connection lock it
// out for 15 minutes, and each wrong try is slowed down.
//
// Settings (Worker → Settings → Variables and Secrets):
//   ADMIN_PASSWORD  secret   at least 12 characters; changing it signs everyone out
//   DB              binding  D1 database "regenera-inquiries"

const STATUSES = ['new', 'contacted', 'conversation', 'qualified', 'archived'];
const VIAS = ['', 'email', 'call', 'meeting', 'other'];
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const MIN_PASSWORD = 12, MAX_TRIES = 5, LOCK_MINUTES = 15;

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE },
});

/* ---------- Dashboard password ---------- */

const COOKIE = 'rg_admin';
const SESSION_HOURS = 12;
const enc = new TextEncoder();
const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

// The signing key comes from the password itself, so changing ADMIN_PASSWORD ends every session.
async function hmac(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode('regenera-admin|' + env.ADMIN_PASSWORD),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64e(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// Returns the name stored in a valid session cookie, or null.
async function sessionName(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !sig || !same(sig, await hmac(env, body))) return null;
  try {
    const [name, exp] = b64d(body).split('|');
    return name && Number(exp) > Date.now() ? name : null;
  } catch { return null; }
}

async function sessionCookie(env, name) {
  const body = b64e(enc.encode(`${name}|${Date.now() + SESSION_HOURS * 3600 * 1000}`));
  return `${COOKIE}=${body}.${await hmac(env, body)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

function passwordPage(error, status = 200, name = '') {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const invalid = error ? ' aria-describedby="err" aria-invalid="true"' : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Inquiries · Regenera</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400&family=Quicksand:wght@400;600;700&display=swap">
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;color:#26292b;font-family:Quicksand,system-ui,sans-serif;padding:20px}
  .card{width:min(420px,100%);background:#fff;border:1px solid #dcd8cd;border-radius:14px;padding:34px 30px}
  h1{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;font-size:38px;line-height:1.05;color:#1f3a2f;margin:0 0 6px}
  p{margin:0 0 20px;color:#5f676a;font-size:14px} label{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#5f676a;margin:16px 0 8px}
  input{width:100%;font:inherit;font-size:16px;padding:13px 14px;border:1px solid #dcd8cd;border-radius:8px;background:#f6f4ef}
  input:focus{outline:2px solid #1f3a2f;outline-offset:2px;background:#fff}
  button{margin-top:22px;width:100%;font:inherit;font-weight:700;font-size:14px;padding:13px;border:0;border-radius:999px;background:#1f3a2f;color:#fff;cursor:pointer}
  .err{color:#9b3b24;font-size:14px;margin:14px 0 0}
</style></head><body><main class="card">
<h1>Regenera inquiries</h1><p>Enter your name and the dashboard password.</p>
<form method="post" action="/admin/login">
<label for="nm">Your name</label><input id="nm" name="name" autocomplete="name" maxlength="60" required value="${esc(name)}"${name ? '' : ' autofocus'}>
<label for="pw">Dashboard password</label><input id="pw" name="password" type="password" autocomplete="current-password" required${name ? ' autofocus' : ''}${invalid}>
${error ? `<p class="err" id="err" role="alert">${esc(error)}</p>` : ''}
<button type="submit">Open dashboard</button></form>
</main></body></html>`;
  return new Response(html, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', ...NO_STORE,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', // no-referrer would make the login POST arrive with Origin: null
  } });
}

// Failed-login counter per connection, kept in D1 so it holds across Worker instances.
async function recentFailures(env, ip) {
  if (!env.DB) return 0;
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?`)
    .bind(ip, Date.now() - LOCK_MINUTES * 60000).first().catch(() => null);
  return row ? row.n : 0;
}
async function recordFailure(env, ip) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()),
    env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(Date.now() - 24 * 3600000),
  ]).catch(() => {});
}

/* ---------- Routes ---------- */

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const pw = String(env.ADMIN_PASSWORD || '');
  if (pw.length < MIN_PASSWORD) {
    return new Response(`This page is private.\n\nSetup: add a Secret named ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) to the Worker under Settings → Variables and Secrets.`,
      { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } });
  }

  if (url.pathname === '/admin/logout') {
    return new Response(null, { status: 303, headers: { Location: '/admin/', 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, ...NO_STORE } });
  }

  if (url.pathname === '/admin/login' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return passwordPage('Please try again.', 403);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const form = await request.formData().catch(() => null);
    const name = String((form && form.get('name')) || '').replace(/[\u0000-\u001F\u007F|<>]/g, '').trim().slice(0, 60);
    const given = String((form && form.get('password')) || '');
    if (await recentFailures(env, ip) >= MAX_TRIES) {
      return passwordPage(`Too many attempts. Try again in ${LOCK_MINUTES} minutes.`, 429, name);
    }
    if (!name) return passwordPage('Please enter your name.', 400);
    // Compare signatures rather than the raw strings, so timing reveals nothing about the password.
    if (given && same(await hmac(env, 'pw|' + given), await hmac(env, 'pw|' + pw))) {
      return new Response(null, { status: 303, headers: { Location: '/admin/', 'Set-Cookie': await sessionCookie(env, name), ...NO_STORE } });
    }
    await recordFailure(env, ip);
    await new Promise(r => setTimeout(r, 1200)); // slow down guessing
    console.warn('admin: wrong dashboard password', ip);
    return passwordPage('That password is not correct.', 401, name);
  }

  const user = await sessionName(request, env);
  if (!user) {
    return url.pathname.startsWith('/api/admin/') ? json(401, { ok: false, error: 'Password required.' }) : passwordPage();
  }

  if (!url.pathname.startsWith('/api/admin/')) {
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(NO_STORE)) out.headers.set(k, v);
    return out;
  }

  if (!env.DB) return json(503, { ok: false, error: 'Database is not connected.' });

  // Changes must come from the dashboard page itself.
  if (request.method !== 'GET') {
    if (request.headers.get('Origin') !== url.origin) return json(403, { ok: false, error: 'Forbidden.' });
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json(415, { ok: false, error: 'Unsupported content type.' });
  }

  const path = url.pathname.replace('/api/admin/', '');

  if (path === 'inquiries' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 2000').all();
    return json(200, { ok: true, user, items: results });
  }

  if (path === 'inquiries.csv' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM inquiries ORDER BY created_at DESC').all();
    const cols = ['id', 'created_at', 'status', 'engage', 'name', 'org', 'email', 'location', 'link', 'country', 'email_sent', 'responded_at', 'responded_by', 'responded_via', 'description', 'notes'];
    // Quote every cell; a leading = + - @ is neutralised so spreadsheets never run it as a formula.
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = [cols.join(','), ...results.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
    return new Response('﻿' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="regenera-inquiries-${new Date().toISOString().slice(0, 10)}.csv"`, ...NO_STORE },
    });
  }

  const one = path.match(/^inquiries\/(\d+)$/);
  if (one && request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const sets = [], vals = [];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return json(400, { ok: false, error: 'Unknown status.' });
      sets.push('status = ?'); vals.push(body.status);
    }
    if (body.notes !== undefined) {
      const notes = String(body.notes).slice(0, 5000);
      sets.push('notes = ?'); vals.push(notes);
    }
    if (body.via !== undefined) {
      if (!VIAS.includes(body.via)) return json(400, { ok: false, error: 'Unknown response method.' });
      sets.push('responded_via = ?'); vals.push(body.via);
    }
    // Ticking "responded" records who (the name given at sign-in) and when; a new inquiry moves to Contacted.
    if (body.responded === true) {
      sets.push(`responded_at = CASE WHEN responded_at = '' THEN ${NOW} ELSE responded_at END`);
      sets.push("responded_by = CASE WHEN responded_by = '' THEN ? ELSE responded_by END"); vals.push(user);
      if (body.status === undefined) sets.push("status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END");
    } else if (body.responded === false) {
      sets.push("responded_at = ''", "responded_by = ''", "responded_via = ''");
    }
    if (!sets.length) return json(400, { ok: false, error: 'Nothing to change.' });
    sets.push(`updated_at = ${NOW}`);
    const row = await env.DB.prepare(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...vals, Number(one[1])).first();
    return row ? json(200, { ok: true, item: row }) : json(404, { ok: false, error: 'Not found.' });
  }

  if (path === 'inquiries/bulk' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
    if (!ids.length) return json(400, { ok: false, error: 'Nothing selected.' });
    const marks = ids.map(() => '?').join(',');
    if (body.action === 'delete') {
      await env.DB.prepare(`DELETE FROM inquiries WHERE id IN (${marks})`).bind(...ids).run();
    } else if (body.action === 'responded') {
      await env.DB.prepare(`UPDATE inquiries SET responded_at = CASE WHEN responded_at = '' THEN ${NOW} ELSE responded_at END,
        responded_by = CASE WHEN responded_by = '' THEN ? ELSE responded_by END,
        status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = ${NOW} WHERE id IN (${marks})`).bind(user, ...ids).run();
    } else if (body.action === 'status' && STATUSES.includes(body.status)) {
      await env.DB.prepare(`UPDATE inquiries SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${marks})`).bind(body.status, ...ids).run();
    } else {
      return json(400, { ok: false, error: 'Unknown action.' });
    }
    return json(200, { ok: true, count: ids.length });
  }

  return json(404, { ok: false, error: 'Not found.' });
}
