# Deploy LOLCallout API + turn on Stripe (walkthrough)

The marketing site is on **Vercel**. Checkout needs the **API** online at  
`https://api.lolcallout.com` with your Stripe keys.

**Easiest host for this API: [Railway](https://railway.app)** (Node Express, free trial / cheap).

---

## Step 1 — Create a Railway project

1. Open [https://railway.app](https://railway.app) → sign in (GitHub is fine).
2. **New Project** → **Deploy from GitHub repo**  
   - Pick the repo that has this code (`lolcallout` / `riftcoach`), **or**
3. **Empty Project** → **Add Service** → **GitHub Repo** (same).

If the monorepo isn’t on GitHub yet:

```powershell
cd C:\Users\steve\riftcoach
git status
# push to GitHub if needed, then connect Railway to that repo
```

---

## Step 2 — Tell Railway how to build (API only — not Electron)

The monorepo includes a **Windows Electron desktop app**. A plain `npm install` on Railway
often **fails** (Electron + Linux). Use the **Dockerfile** we ship:

### Recommended (Dockerfile)

Railway service → **Settings**:

| Setting | Value |
|--------|--------|
| **Root Directory** | *(blank — repo root)* |
| **Builder** | **Dockerfile** |
| **Dockerfile path** | `Dockerfile.api` |

`railway.toml` already points at `Dockerfile.api`.

### If you must use Nixpacks instead

| Setting | Value |
|--------|--------|
| **Build Command** | `npm install --include=dev -w @riftcoach/shared -w @riftcoach/prompts -w @riftcoach/api --include-workspace-root && npm run build:api` |
| **Start Command** | `npm run start:api` |

**Important:** must use `--include=dev` or TypeScript is missing and the build fails.

---

## Step 3 — Environment variables (critical)

Railway service → **Variables** → add **exactly** these  
(copy from your local `C:\Users\steve\riftcoach\.env` — do **not** paste secrets in chat):

```env
NODE_ENV=production
PORT=8787

STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_FOUNDERS=price_...
FOUNDERS_ACCESS_MONTHS=6
APP_URL=https://lolcallout.com

# AI (needed for coach; checkout still works without it)
XAI_API_KEY=...
XAI_MODEL=grok-4.5
XAI_TTS_VOICE=leo
TTS_PROVIDER=xai

# Auth / public URLs
API_PUBLIC_URL=https://api.lolcallout.com
AUTH_APP_URL=https://lolcallout.com
CORS_ORIGIN=https://lolcallout.com
```

Optional later:

```env
AUTH_REQUIRE_PAID=1
STRIPE_WEBHOOK_SECRET=whsec_...
```

Click **Deploy** / wait for build green.

---

## Step 4 — Get the public Railway URL

1. Railway service → **Settings** → **Networking** → **Generate Domain**  
   Example: `lolcallout-api-production.up.railway.app`
2. Open in browser:

```
https://YOUR-RAILWAY-DOMAIN/health
```

You want JSON like:

```json
{ "ok": true, "service": "lolcallout-api", "stripe": true, ... }
```

If `"stripe": false`, the secret key / prices are missing on Railway.

Also test:

```
https://YOUR-RAILWAY-DOMAIN/v1/billing/status
```

Should show `"stripeEnabled": true`.

---

## Step 5 — Point `api.lolcallout.com` at Railway

You use **Cloudflare** for DNS (see `apps/web/DNS.md`).

1. [Cloudflare](https://dash.cloudflare.com) → **lolcallout.com** → **DNS** → **Add record**

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| **CNAME** | `api` | `YOUR-RAILWAY-DOMAIN.up.railway.app` | **DNS only** (grey cloud) first |

2. Railway → **Settings** → **Networking** → **Custom Domain** → add `api.lolcallout.com`  
   (Railway will show you any extra CNAME/TXT if needed.)

3. Wait a few minutes. Test:

```
https://api.lolcallout.com/health
```

Must return `ok: true` and `stripe: true`.

---

## Step 6 — Try founders checkout on the site

1. Open [https://lolcallout.com](https://lolcallout.com) → hard refresh  
2. Founders form → enter **your** email → **Lock founders — $50/mo**  
3. You should jump to **Stripe Checkout** (live card = real charge!)

**Safe test:** use a real card or Stripe’s flow carefully — you are on **live** keys (`sk_live_`).  
For test cards, create a **test** key + test prices and use `sk_test_` on Railway temporarily.

---

## Step 7 — (Optional) Stripe webhook

When you want renewals / cancel handling:

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**  
2. URL: `https://api.lolcallout.com/v1/billing/webhook` (if route exists)  
3. Or keep using `/v1/billing/confirm` after redirect (already coded).

---

## Checklist

- [x] Railway service builds + starts  
- [x] `/health` shows `"stripe": true`  
- [ ] Cloudflare `api` CNAME → Railway (SSL)  
- [ ] `https://api.lolcallout.com/health` works  
- [x] Site founders form opens Stripe Checkout  
- [ ] Stripe webhook endpoint + `STRIPE_WEBHOOK_SECRET` on Railway  

Webhook URL example:

```text
https://lolcallout-production.up.railway.app/v1/billing/webhook
```

Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## If something fails

| Symptom | Fix |
|---------|-----|
| Site still “You’re on the list” | API not reachable in 12s — check `api.lolcallout.com/health` |
| `"stripe": false` | Missing `STRIPE_SECRET_KEY` on Railway |
| CORS error in browser console | Ensure `CORS_ORIGIN=https://lolcallout.com` and origins include lolcallout.com |
| Build fails monorepo | Use full build command from Step 2 from **repo root** |
| 502 on Railway | Check logs — often wrong start command or bind host |

---

## You’re done when

1. `https://api.lolcallout.com/health` → `stripe: true`  
2. Founders email on lolcallout.com → **Stripe payment page**  

That’s “Stripe enabled” for real customers.
