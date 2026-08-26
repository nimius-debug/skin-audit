# The Free Mom Skin Audit — Skin by Laura Lo

A single-page, no-build landing page. Open `index.html` in a browser and it works —
no npm install, no framework, no server required.

```
index.html    the page (sections are numbered in comments, in offer order)
styles.css    all styling
config.js     ← the only file you edit week to week
script.js     spot counter, form/waitlist swap, uploads, submission
assets/       placeholder images — replace with real photos
```

## Weekly routine (30 seconds)

Open `config.js` and change one number:

```js
spotsRemaining: 3,   // 3 spots left this week
```

Every "X remaining" on the page updates at once — hero, value stack, urgency
block, form, sticky bar.

Set it to `0` and **the form is automatically replaced by the waitlist section**
(Section 9). Every "Claim My Free Spot" button becomes "Join the Waitlist" and
scrolls there instead. Monday morning, set it back to `5`.

## Replacing the photos

Placeholders live in `assets/` as `.svg` files. Drop your real photo in the same
folder and change the `src` in `index.html` (search for `REPLACE`):

| File | Where it appears | What it should be |
|---|---|---|
| `laura-hero.svg` | Hero, top right | Laura with her baby, natural light, no studio polish. **Highest-leverage image on the page.** |
| `laura-baby.svg` | Beside the "Why I'm doing this" story | Candid at home |
| `laura-before.svg` | Before/after, left | Laura with acne — bare skin, natural light, no filter |
| `laura-after.svg` | Before/after, right | Laura with her family, clear skin |
| `shelfie-example.svg` | Linked from form question 10 | Example of a good "shelfie" |
| `photo-guide.svg` | Linked from form question 9 | Front / left / right guide — usable as-is, or swap for real photos |

Before and after only work if the framing matches: same distance, same window,
no filter on either. Mismatched shots read as a trick and cost more trust than
they buy.

## Taking real submissions

Out of the box, submitting shows the confirmation and stashes the answers in
`localStorage` so you can click through the whole page while testing — but
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

## Page order

Each section exists to kill one objection. Reordering trades something away.

1. Hero — stop the scroll, state the outcome
2. The Pain — make her feel seen
3. Why Free — trust through shared identity
   - Before/After — proof on Laura's own face
4. What You Get — $425 value stack
5. How It Works — lower perceived effort
6. The Promises — remove remaining risk
7. Scarcity/Urgency — convert hesitation
8. The Form — convert
   - swaps to → 9. Waitlist — capture overflow
10. FAQ — mop up last objections
