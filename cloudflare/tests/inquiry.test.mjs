import { onRequestPost } from '../functions/api/inquiry.js';
let sent = [];
globalThis.fetch = async (u, o) => { sent.push({ u, o }); return new Response('{"id":"x"}', { status: 200 }); };
const env = { RESEND_API_KEY: 'test', MAIL_FROM: 'Site <a@b.com>', MAIL_TO: 'hello@weareregenera.com' };
const req = (body, h = {}) => new Request('https://weareregenera.com/api/inquiry', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: 'https://weareregenera.com', ...h } });
const good = { engage: 'Other', name: 'Ana <b>x</b>\r\nBcc: evil@x.com', email: 'ana@example.com', description: '<script>alert(1)</script>\nline2', link: 'https://x.org' };
const run = async (label, r) => { sent = []; const res = await onRequestPost({ request: r, env }); console.log(label, res.status, await res.text(), sent.length); return sent; };
const s = await run('good', req(good));
const p = JSON.parse(s[0].o.body);
console.log(' subject:', JSON.stringify(p.subject), '| escaped:', p.html.includes('&lt;script&gt;') && !p.html.includes('<script>'), '| reply_to:', p.reply_to);
await run('cross-origin', req(good, { Origin: 'https://evil.com' }));
await run('no origin', new Request('https://weareregenera.com/api/inquiry', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } }));
await run('honeypot', req({ ...good, website_hp: 'spam' }));
await run('bad email', req({ ...good, email: 'nope' }));
await run('bad engage', req({ ...good, engage: 'hack' }));
await run('js link', req({ ...good, link: 'javascript:alert(1)' }));
await run('too long', req({ ...good, description: 'x'.repeat(4001) }));
await run('form type', new Request('https://weareregenera.com/api/inquiry', { method: 'POST', body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://weareregenera.com' } }));
await run('bad json', new Request('https://weareregenera.com/api/inquiry', { method: 'POST', body: '{nope', headers: { 'Content-Type': 'application/json', Origin: 'https://weareregenera.com' } }));
env.TURNSTILE_SECRET = 's'; globalThis.fetch = async (u) => { sent.push({u}); return new Response(JSON.stringify({ success: false })); };
await run('turnstile fail', req(good));
