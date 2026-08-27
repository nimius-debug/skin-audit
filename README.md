# The Free Mom Skin Audit — Skin by Laura Lo

A static, no-build site. Open `index.html` in a browser and it works —
no npm install, no framework, no server required.

```
index.html    the offer page — sections numbered in comments, in offer order
form.html     the claim form — its own page, opens in a new tab, one step at a time
styles.css    all styling for both pages
config.js     ← the only file you edit week to week
script.js     index.html behavior: spot counters, countdown, sticky bar
form.js       form.html behavior: step navigation, uploads, submission, waitlist
assets/       placeholder images — replace with real photos
```

Every "Claim My Free Spot" button on `index.html` opens `form.html` in a new
tab — she keeps her place on the offer page and lands on a calm, focused form
with nothing else competing for attention.

## Weekly routine (30 seconds)

Open `config.js` and change one number:

```js
spotsRemaining: 3,   // 3 spots left this week
```

Every "X remaining" on both pages updates at once — hero, value stack, urgency
block, sticky bar, and the form page's header pill.

Set it to `0` and **`form.html` automatically shows the waitlist instead of
the form** — no separate page to manage. Every "Claim My Free Spot" button on
`index.html` becomes "Join the Waitlist" too. Monday morning, set it back to `5`.

## The form itself

`form.html` walks through the same 10 questions as one step per screen:

1. Where to send it (name, Instagram handle)
2. Your main concern (Q1, Q2)
3. What you've tried (Q3, Q4)
4. Your routine (Q5–Q8)
5. Your photos (privacy note, Q9, Q10)
6. Send it to Laura (opt-in, submit)

Each step only validates the questions on that screen, so nothing feels
blocked by a question three screens away. A progress bar and "Step X of 6"
keep it honest about how much is left. "I don't know" stays a valid answer
throughout.

## Replacing the photos

Placeholders live in `assets/` as `.svg` files. Drop your real photo in the
same folder and change the `src` in `index.html` (search for `REPLACE`):

| File | Where it appears | What it should be |
|---|---|---|
| `laura-hero.svg` | Hero, main tilted card | Laura with her baby, natural light, no studio polish. **Highest-leverage image on the page.** |
| `laura-before.svg` | Hero, small overlapping card + Before/After section | Laura with acne — bare skin, natural light, no filter |
| `laura-baby.svg` | Beside the "Why I'm doing this" story | Candid at home |
| `laura-after.svg` | Before/after, right | Laura with her family, clear skin |
| `shelfie-example.svg` | Linked from form question 10 | Example of a good "shelfie" |
| `photo-guide.svg` | Linked from form question 9 | Front / left / right guide — usable as-is, or swap for real photos |

Before and after only work if the framing matches: same distance, same window,
no filter on either. Mismatched shots read as a trick and cost more trust than
they buy. `laura-before.svg` is reused in both the hero's small overlapping
card and the full Before/After section — one real photo, two placements.

## Taking real submissions

Out of the box, submitting shows the confirmation and stashes the answers in
`localStorage` so you can click through the whole form while testing — but
**nothing is sent anywhere**. To go live, paste a form endpoint into `config.js`:

```js
formEndpoint: "https://formspree.io/f/XXXXXXXX",
waitlistEndpoint: "https://formspree.io/f/YYYYYYYY",
```

Any service that accepts a `multipart/form-data` POST works (Formspree, Basin,
Getform, Netlify Forms, your own endpoint). It must accept **file uploads** —
four photos per submission — or questions 9 and 10 arrive empty.

Because photos are involved, check the service's data-retention terms before
you point real submissions at it. "Your photos go to me and only me" is a
promise on the page, so the pipe behind it has to hold.

## Publishing

It's static — any host works. Drag the folder into Netlify, push to GitHub
Pages, or `vercel deploy`. No build step.

## Page order (index.html)

Each section exists to kill one objection. Reordering trades something away.

1. Hero — stop the scroll, state the outcome (with a "before" teaser)
2. The Pain — make her feel seen
3. Why Free — trust through shared identity
   - Before/After — proof on Laura's own face
4. What You Get — $425 value stack
5. How It Works — lower perceived effort
6. The Promises — remove remaining risk
7. Scarcity/Urgency — convert hesitation, links to → `form.html`
8. FAQ — mop up last objections

`form.html` (opened from any CTA above) auto-swaps between the claim form and
the waitlist based on `config.js` — see "Weekly routine" above.
