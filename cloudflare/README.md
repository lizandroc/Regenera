# Regenera on Cloudflare

```
public/               static site (built by build.py from the reviewed page)
functions/api/        /api/inquiry: validates the form and emails it through Resend
worker.js             Worker entry: routes /api/inquiry, serves everything else from public/
wrangler.jsonc        Worker config
_headers              security headers copied into public/
build.py              rebuilds public/ from the reviewed page
tests/                node tests/inquiry.test.mjs (mocked Resend, no network)
```

## 1. Resend
1. Add the domain `weareregenera.com` in Resend and add the DNS records it lists (SPF, DKIM) in Cloudflare DNS. Wait until it shows **Verified**.
2. Create an API key with **Sending access** only, limited to that domain. Do not paste it into chat, code, or GitHub.

## 2. Cloudflare Worker
The site runs as a Worker with static assets (`wrangler.jsonc`): `public/` is served as files and
`worker.js` handles `/api/inquiry`. Dashboard drag-and-drop uploads do not run the form code.

- **Git:** Workers & Pages → the `regenera` Worker → Settings → Build. Repository `lizandroc/Regenera`,
  root directory `cloudflare`, deploy command `npx wrangler deploy`.
  Daikon is not in the public repo, so this serves the Quicksand fallback.
- **From your computer (keeps Daikon):** add the two Daikon `.ttf` files to `public/fonts/`, then run
  `npx wrangler deploy` from this folder.

Then, in the Worker:
1. Settings → Variables and Secrets (Production):
   - `RESEND_API_KEY` (type **Secret**)
   - `MAIL_FROM` = `Regenera website <inquiries@weareregenera.com>`
   - `MAIL_TO` = `hello@weareregenera.com`
2. Settings → Domains & Routes → Add → Custom domain: `weareregenera.com`, then `www.weareregenera.com`.
3. SSL/TLS → Full (strict), Always Use HTTPS on, minimum TLS 1.2.

## 3. Spam and abuse protection
- **Turnstile** (recommended): create a widget for the domain. Put the *site key* in `public/index.html` (`<meta name="turnstile-sitekey" content="...">`) and the *secret key* as the `TURNSTILE_SECRET` secret.
- **Rate limit**: Security → WAF → Rate limiting rules → path equals `/api/inquiry`, 5 requests per minute per IP, action Block.
- The hidden honeypot field silently drops simple bots.

## Fonts
Daikon is a licensed font. Keep the `.ttf` files out of a public repository; upload them with a direct deploy, or the site falls back to Quicksand.

## 4. Inquiry dashboard (/admin)
Every form submission is saved in the D1 database `regenera-inquiries` (bound as `DB`), even when
the email alert fails. The dashboard at `/admin` lists, filters, annotates and exports them.

Access is by link plus a shared dashboard password, separate from any Cloudflare account:
1. Worker → Settings → Variables and Secrets → add `ADMIN_PASSWORD` as a **Secret**
   (at least 12 characters). Until it is set, `/admin` stays closed.
2. Share https://weareregenera.com/admin and the password with the team. Each person enters
   their name, which the dashboard records as "responded by".
3. To revoke everyone's access, change `ADMIN_PASSWORD`; all sessions end at once.

Protection: 5 wrong passwords from one connection lock it out for 15 minutes (table
`login_attempts`), each wrong try is slowed down, sessions last 12 hours, and every change
must come from the dashboard page itself. Schema: `schema.sql`.
