# SEO checklist — LOLCallout

On-site SEO is live on [lolcallout.com](https://lolcallout.com). Search engines still need **you** to claim the property once.

## Already on the site

- Title + meta description + keywords
- Canonical URL, robots meta, Open Graph, Twitter cards
- Perfect-circle logo assets (`logo-circle.png`, `logo-512.png`, favicons, `logo-mark.svg`)
- JSON-LD: Organization, WebSite, SoftwareApplication, FAQPage
- `robots.txt` + `sitemap.xml` + `site.webmanifest`
- Legal pages with canonicals and descriptions

## Do this once (free, ~15 minutes)

### Google

1. Open [Google Search Console](https://search.google.com/search-console)
2. Add property: `https://lolcallout.com`
3. Verify (DNS TXT or HTML meta — Vercel domain DNS is fine)
4. **Sitemaps** → submit `https://lolcallout.com/sitemap.xml`
5. Optional: [Rich Results Test](https://search.google.com/test/rich-results) on the homepage
6. Optional: Business / brand — Organization logo uses `https://lolcallout.com/logo-512.png` (square 512×512)

### Bing (also covers Yahoo / DuckDuckGo partly)

1. [Bing Webmaster Tools](https://www.bing.com/webmasters)
2. Import from Google Search Console **or** add site + verify
3. Submit sitemap: `https://lolcallout.com/sitemap.xml`

### Optional

- Yandex Webmaster if you care about RU traffic
- Keep `og:image` / hero updated when branding changes
- When you have social profiles, add them to JSON-LD `sameAs` in `index.html`

## Logo for Google results

Google shows a **square** logo for Organization (we serve `logo-512.png`).  
Browsers and many UIs use the **circle** mark (`logo-circle.png`, `apple-touch-icon.png`).  
Circle logo is also linked as `image` / favicon so search & bookmarks stay on-brand.

Ranking is not instant — crawl + authority take days to weeks after indexing.
