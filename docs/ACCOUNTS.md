# LOLCallout accounts (cloud-only product)

Standalone desktop uses **one global account API**. There is no local account authority in production.

## User flow (in the app only)

1. **Create account** — email + password (8+, letter + number)
2. **Sign in** — same email/password on any PC worldwide
3. **Remember me** — saves email + long session token (never the password)
4. **Change password** — Settings → Account
5. Website is **marketing / Stripe checkout only** — not required for day-to-day coach use

## Server persistence (Railway — required)

Without a volume, `users.json` is wiped on every deploy.

1. Railway → API service → **Volumes** → add volume mounted at `/data`
2. Variables:
   - `DATA_DIR=/data`
   - Optional: `BOOTSTRAP_PRO_EMAILS=you@email.com:24`
   - Optional: `ADMIN_SECRET=...` for `POST /v1/auth/admin-grant`
3. Redeploy, then check `GET /health` → `accounts.persistent: true`

## Health check

```json
"accounts": {
  "userCount": 3,
  "persistent": true,
  "dataDirConfigured": true,
  "writable": true
}
```

If `persistent` is false in production, attach a volume before onboarding real users.

## Desktop wiring

- Packaged app: `api` / `authApi` / `cloudApi` → production Railway (or `api.lolcallout.com` when DNS is set)
- Live Client **agent** stays on `127.0.0.1` (must talk to League locally)
- Local API is **not** started in packaged builds and is **not** used for login
