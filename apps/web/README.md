# lolcallout.com

Marketing site for **LOLCallout**.

## Local preview

```bash
cd apps/web
npx --yes serve -l 4321 .
```

Open http://localhost:4321

Or from repo root:

```bash
npm run dev:web
```

## Deploy to lolcallout.com

Point the domain to any static host:

| Host | Notes |
|------|--------|
| **Vercel** | Import `apps/web` or root with output dir |
| **Cloudflare Pages** | Upload `apps/web` or connect repo |
| **Netlify** | Publish directory = `apps/web` |

No build step required — pure HTML/CSS/JS.

### DNS
- `A` / `CNAME` per your host’s docs
- Enable HTTPS

### Before Stripe
1. Confirm site looks good on mobile
2. Set mailbox: `founders@lolcallout.com`
3. Lawyer pass on Terms / Privacy
