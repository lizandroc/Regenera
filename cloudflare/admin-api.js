// Private inquiry dashboard: /admin (page) and /api/admin/* (data).
//
// Every request must carry a valid Cloudflare Access login. The Worker checks the signed
// token itself, so the dashboard stays closed on any hostname Access does not cover
// (for example the workers.dev address). Until Access is configured, everything here is closed.
//
// Settings (Worker → Settings → Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  text  e.g. https://regenera.cloudflareaccess.com
//   ACCESS_AUD          text  the Access application's "Application Audience (AUD) Tag"
//   DB                  binding  D1 database "regenera-inquiries"

const STATUSES = ['new', 'contacted', 'conversation', 'qualified', 'archived'];
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE },
});

/* ---------- Cloudflare Access token check ---------- */

let certCache = { at: 0, keys: [] };
const b64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function accessKeys(team) {
  if (Date.now() - certCache.at < 10 * 60 * 1000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs ' + res.status);
  certCache = { at: Date.now(), keys: (await res.json()).keys || [] };
  return certCache.keys;
}

// Returns the signed-in person's email, or null.
export async function accessUser(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  if (!team.startsWith('https://') || !env.ACCESS_AUD) return null;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (header.alg !== 'RS256') return null;
    const jwk = (await accessKeys(team)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || payload.iss !== team || !aud.includes(env.ACCESS_AUD) || !(payload.exp > now)) return null;
    return payload.email || 'signed-in user';
  } catch {
    return null;
  }
}

/* ---------- Routes ---------- */

export async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const user = await accessUser(request, env);
  if (!user) {
    return new Response('This page is private.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE } });
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
    const cols = ['id', 'created_at', 'status', 'engage', 'name', 'org', 'email', 'location', 'link', 'country', 'email_sent', 'description', 'notes'];
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
    if (!sets.length) return json(400, { ok: false, error: 'Nothing to change.' });
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
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
    } else if (body.action === 'status' && STATUSES.includes(body.status)) {
      await env.DB.prepare(`UPDATE inquiries SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (${marks})`).bind(body.status, ...ids).run();
    } else {
      return json(400, { ok: false, error: 'Unknown action.' });
    }
    return json(200, { ok: true, count: ids.length });
  }

  return json(404, { ok: false, error: 'Not found.' });
}
