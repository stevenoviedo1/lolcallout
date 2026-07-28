# Connect lolcallout.com → Vercel

Your domain is registered / managed on **Cloudflare** nameservers:

- `guy.ns.cloudflare.com`
- `rayne.ns.cloudflare.com`

Vercel expects either **nameserver change** or **DNS records**.

## Option A (recommended) — DNS records in Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select **lolcallout.com**
3. **DNS → Records → Add**

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| **A** | `@` | `76.76.21.21` | **DNS only** (grey cloud) initially |
| **CNAME** | `www` | `cname.vercel-dns.com` | DNS only |

4. Save. Wait 1–30 minutes.
5. Open Vercel → project **lolcallout** → **Settings → Domains**
6. Confirm `lolcallout.com` and `www.lolcallout.com` show **Valid**

After SSL is green, you can turn Cloudflare proxy (orange cloud) on if you want — or leave grey for simplest setup.

## Option B — Vercel nameservers

At Cloudflare, change nameservers to:

- `ns1.vercel-dns.com`
- `ns2.vercel-dns.com`

Then Vercel fully manages DNS.

## Live right now (no DNS wait)

https://lolcallout-steven-oviedos-projects.vercel.app

(Or latest production URL from `vercel ls lolcallout`)
