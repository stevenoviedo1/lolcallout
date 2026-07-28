# Stripe setup for LOLCallout

**You do not need a “Stripe plugin”** for the marketing site or for me to wire checkout. Stripe is already in the API (`apps/api`). You only need a Stripe account + products + secret keys on the **API server**.

## What you do (about 10 minutes)

1. **Create a Stripe account** at [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. **Turn on test mode** first (toggle in the dashboard).
3. **Create products** (Product catalog → Add product):

| Product | Type | Amount | Env var |
|---------|------|--------|---------|
| LOLCallout | Recurring monthly | **$100 / month** | `STRIPE_PRICE_PRO=price_...` |
| LOLCallout Founders | Recurring monthly | **$50 / month** | `STRIPE_PRICE_FOUNDERS=price_...` |

Founders pay **$50 every month**. `FOUNDERS_ACCESS_MONTHS` (default **6**, set **12** when seats sell out) is how long that founders rate runs from activation.

   Copy each **Price ID** (`price_...`), not the Product ID.

4. **API keys** → Developers → API keys → copy **Secret key** (`sk_test_...` then later `sk_live_...`).

5. **Put env on the API host** (where `apps/api` runs — not only the static Vercel site):

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_FOUNDERS=price_...
APP_URL=https://lolcallout.com
```

6. **Optional webhook** (production):  
   Endpoint: `https://YOUR_API_HOST/v1/billing/webhook` (if you add one)  
   Or use the existing **session confirm** route after checkout redirect.

7. **Go live:** flip Stripe to live mode, create the same two prices in live mode, swap keys to `sk_live_...` / live `price_...`.

## What I can do once keys exist

- Wire env on the host if you paste keys or add them in the host dashboard
- Test checkout sessions (founders + standard)
- Confirm success URL grants access for 12 months (founders) / Pro monthly

## What you do **not** need

- No Vercel “Stripe plugin” for the static marketing site  
- No Shopify / WordPress Stripe app  
- No browser plugin for me  

If you use **Vercel Marketplace Stripe**, that can auto-inject env vars into a Vercel project — only useful if the **API also runs on Vercel**. Our billing lives in `apps/api`; put secrets wherever that API is deployed.

## Founders product wording in Stripe

- Name: `LOLCallout Founders`
- Description: `Founders (first 100). Full package at $50/month for 6 months from activation (12 months at $50/mo if founders sell out).`
- Price: `$50.00 USD` · **Recurring monthly**

## Standard product

- Name: `LOLCallout`
- Description: `Full live AI coach — voice, brain, draft, post-game. Everything included.`
- Price: `$100.00 USD` · **Recurring monthly**

## When founders sell out

Set on the API host:

```env
FOUNDERS_ACCESS_MONTHS=12
```

Founders keep the $50/mo rate for 12 months from activation.
