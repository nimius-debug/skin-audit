# The Free Mom Skin Audit — Skin by Laura Lo

Landing page, multi-step claim form, and Laura's admin dashboard.
Runs entirely on Cloudflare's free tier.

```
public/          the site (static — served from the edge, costs nothing)
  index.html     the offer page
  form.html      the claim form — opens in a new tab, one step at a time
  styles.css     the whole design system
  script.js      landing page: live spot counter, countdown, sticky CTA
  form.js        form: step navigation, photo compression, submission
  config.js      fallback values + photo settings
  assets/        placeholder images — replace with real photos
worker/index.js  the API, photo storage, and Laura's dashboard
wrangler.toml    bindings (D1 + R2 + static assets)
schema.sql       database schema (already applied)
```

## What's already provisioned

| Resource | Name | ID |
|---|---|---|
| D1 database | `skin-audit-db` | `d143f936-892f-4f35-a5a8-ee52af82d55d` |
| R2 bucket | `skin-audit-photos` | needs one-time enable (see below) |

Tables `submissions` and `waitlist` are live in D1 already.

## Requirements

**Node.js 22 or newer** — Wrangler 4 refuses to run on anything older.
`.nvmrc` pins it, so with nvm installed:

```bash
nvm use        # reads .nvmrc
# or, the first time:
nvm install 22
```

Check with `node -v`. Cloudflare's build system reads `.nvmrc` too, so
dashboard builds get the same version.

## Deploying

**1. Enable R2 once** (Cloudflare requires accepting R2 terms in the dashboard
before the API will create buckets):

Dashboard → **R2 Object Storage** → **Enable R2**. Then:

```bash
npx wrangler r2 bucket create skin-audit-photos
```

**2. Set Laura's dashboard password:**

```bash
npx wrangler secret put ADMIN_USER       # e.g. laura
npx wrangler secret put ADMIN_PASSWORD   # something long
```

Without `ADMIN_PASSWORD` set, `/admin` returns 503 and stays shut — it fails
closed on purpose, so a missing secret can never expose submissions.

**3. Deploy:**

```bash
npm install
npx wrangler deploy
```

That gives you `skin-audit.<your-subdomain>.workers.dev`. Add a custom domain
in the dashboard under Workers → skin-audit → Settings → Domains.

## Laura's dashboard

`https://<your-domain>/admin` — browser asks for the username and password.

- Every submission, newest first. Click one to expand all 10 answers plus the four photos.
- **Download spreadsheet (CSV)** — opens straight in Excel or Google Sheets, one row per mom, with direct photo links.
- Mark each one **new / reviewed / sent** so she can track what she's answered.
- Waitlist table and its own CSV underneath.

## The spot counter runs itself

There is no number to edit each week. The Worker counts real submissions
against the current week (Monday–Sunday) and every counter on the site reads
from that:

- Landing page, form page, announcement bar all fetch `/api/status`.
- Hitting 5 flips every CTA to "Join the Waitlist" and swaps the form for the waitlist panel automatically.
- It resets on its own every Monday.
- If a sixth person is mid-form when the last spot goes, her submit is refused cleanly and she's moved to the waitlist instead of losing her answers.

To change the weekly cap, edit `SPOTS_PER_WEEK` in `wrangler.toml` (and
`spotsTotal` in `public/config.js` so the first paint matches), then redeploy.

## Photos

Resized to 1600px and JPEG-encoded **in the browser before upload** — measured
at **88% smaller** on a full-size 8 MB phone photo. Real face photos land
around 250–450 KB each, so roughly 1–2 MB per submission.

Storage is the only meter that can ever bill, and it's 10 GB free:

| | Per submission | Fits in 10 GB free |
|---|---|---|
| Realistic photos | ~1–2 MB | **~6,000–10,000 submissions** |
| Worst case measured (pure noise) | 4 MB | ~2,500 submissions |

At 5 a week that's well over a decade. Past 10 GB it's $0.015/GB-month —
doubling to 20 GB of photos costs about 15¢/month.

**Privacy.** The R2 bucket is private with no public URL. Photos are only ever
reachable through `/admin/photo/<key>`, behind the same password as the
dashboard — that's what makes "your photos go to me and only me" true
technically, not just as copy on the page.

## Local development

```bash
npx wrangler d1 execute skin-audit-db --local --file=schema.sql   # once
npx wrangler dev
```

Create a `.dev.vars` (gitignored) for local admin access:

```
ADMIN_USER=laura
ADMIN_PASSWORD=localtest
```

`wrangler dev` uses local emulated D1 and R2, so nothing you test touches
real data. To run against the real database instead, add `--remote`.

## Replacing the photos

Placeholders live in `public/assets/` as `.svg`. Drop the real photo in the
same folder and update the `src` in `public/index.html` (search `REPLACE`):

| File | Where | What it should be |
|---|---|---|
| `laura-hero.svg` | Hero, main tilted card | Laura with her baby, natural light, no studio polish |
| `laura-before.svg` | Hero small card + Before/After | Laura with acne — bare skin, natural light, no filter |
| `laura-baby.svg` | Beside the story | Candid at home |
| `laura-after.svg` | Before/After, right | Laura + family, clear skin |
| `shelfie-example.svg` | Linked from form Q10 | Example "shelfie" |
| `photo-guide.svg` | Linked from form Q9 | Front/left/right guide — usable as-is |

Before and after only work if the framing matches: same distance, same window,
no filter on either.

## Page order (index.html)

1. Hero — stop the scroll, state the outcome (with the "before" teaser)
2. The Pain — make her feel seen
3. Why Free — trust through shared identity
   - Before/After — proof on Laura's own face
4. What You Get — $425 value stack
5. How It Works — lower perceived effort
6. The Promises — remove remaining risk
7. Scarcity/Urgency — convert hesitation
8. FAQ — mop up last objections
