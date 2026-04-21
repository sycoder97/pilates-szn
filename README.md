# pilates szn

Honest London pilates studio directory. Pricing auto-refreshes weekly from each studio's own website via Gemini-powered extraction.

## Architecture

- **Frontend:** static HTML/CSS/JS. Lives on Netlify. Deploys on every push.
- **Data:** `studios.json` is the source of truth the site renders from.
- **Auto-refresh:** a GitHub Action runs every Monday 08:00 UTC. It fetches each studio's site, asks Gemini to extract pricing, writes the result to `studios.json`, and commits. Netlify auto-deploys the change.
- **Overrides:** anything you put in `overrides.json` always wins over the scraper.

```
┌──────────────────┐    weekly cron    ┌──────────────────┐
│ GitHub Actions   │ ────────────────▶ │ Gemini API       │
│ refresh-pricing  │ ◀──── JSON ───── │ (pricing extract) │
└────────┬─────────┘                    └──────────────────┘
         │ git commit
         ▼
┌──────────────────┐  push   ┌──────────────────┐
│ GitHub repo      │ ──────▶ │ Netlify          │
│ studios.json     │         │ pilateszn.app    │
└──────────────────┘         └──────────────────┘
```

## One-time setup

1. **Push this repo to GitHub.**
   ```bash
   cd pilates-szn
   git init && git add -A && git commit -m "initial"
   gh repo create pilates-szn --private --source=. --push
   ```

2. **Get a free Gemini API key** at [aistudio.google.com](https://aistudio.google.com/app/apikey). Free tier covers our weekly usage comfortably (~60 calls/week, free tier = 15 RPM, 1M tokens/day).

3. **Add it as a GitHub secret.**
   ```bash
   gh secret set GEMINI_API_KEY
   # paste the key when prompted
   ```

4. **Connect Netlify to the repo.** Netlify → Add new site → Import existing project → pick the repo. No build command, publish directory = `.`

5. **Point your domain (`pilateszn.netlify.app`) at the new site** in Netlify's domain settings.

## Updating pricing

### Automatically (default)
Nothing to do. Every Monday the Action runs, commits any price changes, Netlify deploys. You'll see the commits appear in your repo.

### Manually trigger a refresh
In GitHub → Actions → "Refresh pricing" → Run workflow. Optionally enter a partial studio name to refresh just one studio.

### Locally (for testing)
```bash
npm install
export GEMINI_API_KEY=your-key-here
npm run refresh:dry           # preview without writing
npm run refresh               # write studios.json
node scripts/refresh-pricing.mjs --only "Heartcore"  # just one studio
```

### Override a studio permanently
The scraper occasionally gets a price wrong (e.g. pulls a private-session rate instead of a group one). Pin the correct values in `overrides.json`:

```json
{
  "studios": {
    "Heartcore": {
      "intro": "3 for £45",
      "packages": "5 for £140 · 10 for £250 · Unlimited £220/mo"
    }
  }
}
```

Overrides are applied on top of the scraper's output on every run.

## Affiliate links

When you sign an affiliate deal with a studio, add its tracking URL to `config.js`:

```js
window.PILATES_CONFIG = {
  affiliates: {
    "Heartcore": "https://weareheartcore.com/?via=pilateszn",
    "Ten Health & Fitness": "https://ten.co.uk/?ref=pilateszn",
  },
  // ...
};
```

Studios without an affiliate URL still get UTM-tagged outbound links so you can negotiate based on proven referral traffic.

## Adding a new studio

Add an entry to the `studios` array in `studios.json`. Required fields:

```json
{
  "name": "Studio Name",
  "zone": "C",
  "areas": "Soho, Covent Garden",
  "types": ["Reformer"],
  "lat": 51.513,
  "lng": -0.133,
  "intro": "3 for £45",
  "packages": "Single £28 · 10 for £250",
  "review": "One-line take.",
  "rating": 4.6,
  "website": "https://studio.com",
  "lastVerified": "2026-04-21"
}
```

Next scraper run will verify/update pricing.

## Which studios won't have auto-priced data

About 10-15 studios hide pricing behind Mindbody/Momence/ClassPass booking widgets that render client-side. The scraper will:
1. Flag them with a `confidence < 0.4` in `refresh.log`
2. Leave existing data untouched
3. The card's "Book" button still works — it links through to the studio where the booking widget *does* show pricing

If you want 100% coverage, install Playwright and adapt `scripts/refresh-pricing.mjs` to render JS before extracting (see commented section in the script).

## File map

| File | Purpose |
|---|---|
| `index.html` | The page |
| `styles.css` | Design system + layout |
| `app.js` | Loads `studios.json`, renders cards, filters, modal |
| `config.js` | Affiliate link overrides + UTM params (safe to commit — no secrets) |
| `studios.json` | The data |
| `overrides.json` | Manual pins (always win over the scraper) |
| `scripts/refresh-pricing.mjs` | The scraper |
| `.github/workflows/refresh.yml` | Weekly schedule |
| `netlify.toml` | Netlify deploy config |
| `refresh.log` | Last scraper run output (regenerated each run) |
