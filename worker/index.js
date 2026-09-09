/* The Free Mom Skin Audit — API + Laura's admin dashboard.
 *
 * Routes:
 *   GET  /api/status          → { total, remaining, claimed, full, isOpen }
 *   POST /api/submit          → store an audit submission (+ 4 photos in R2)
 *   POST /api/waitlist        → store a waitlist signup
 *   GET  /admin               → Laura's dashboard (basic auth)
 *   GET  /admin/export.csv    → spreadsheet export (basic auth)
 *   GET  /admin/photo/<key>   → private photo, streamed from R2 (basic auth)
 *   POST /admin/status        → mark a submission new/reviewed/sent (basic auth)
 *   POST /admin/settings      → set the spot cap and open/closed (basic auth) —
 *                               "remaining" is always calculated, never set
 *
 * Everything else falls through to the static site in /public.
 */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;   // 8 MB per photo, after client-side compression
const PHOTO_FIELDS = ["photo_front", "photo_left", "photo_right", "photo_shelfie"];

const TEXT_FIELDS = [
  "name", "handle", "concern", "duration", "tried", "result",
  "morning_routine", "night_routine", "after_wash", "lifestyle"
];

const PRODUCT_FIELDS = {
  cleanser: "product_cleanser",
  barSoap: "product_bar_soap",
  exfoliant: "product_exfoliant",
  toner: "product_toner",
  serums: "product_serums",
  moisturizers: "product_moisturizers",
  sunscreen: "product_sunscreen",
  eyeProducts: "product_eye",
  lipProducts: "product_lip"
};

const INTAKE_TEXT_FIELDS = [
  "allergies", "medications", "active_use", "active_details",
  "acne_medication_use", "acne_medication_details", "health_details",
  "supplements_other", "smoking_status", "high_caffeine", "birth_control",
  "birth_control_type", "pregnancy_status"
];

const REQUIRED_ACKNOWLEDGMENTS = [
  "adult_acknowledgment", "scope_acknowledgment", "safety_acknowledgment",
  "results_acknowledgment", "privacy_acknowledgment"
];

const CONSENT_VERSION = "2026-09-09";

/* ---------- helpers ---------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

/** Emails Laura the moment a real submission lands. Called via ctx.waitUntil()
 *  so it never delays the mom's confirmation screen, and never throws —
 *  a failed notification must not affect a submission that's already saved. */
async function notifyLaura(env, { name, handle }) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;   // not configured yet — skip quietly

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "Skin Audit <onboarding@resend.dev>",
        to: env.NOTIFY_EMAIL,
        subject: `New skin audit — ${name} (${handle})`,
        text: `${name} (${handle}) just claimed a spot.\n\nView it: https://audit.skinbylauralo.com/admin`
      })
    });
    if (!res.ok) console.error("notifyLaura: Resend returned", res.status, await res.text());
  } catch (err) {
    console.error("notifyLaura failed:", err);
  }
}

/** Spots are a single row Laura controls from /admin — not a calendar bucket.
 *  Nothing resets on its own; a round stays open until she closes it or the
 *  count hits zero, and she decides when the next round starts. */
async function getSettings(env) {
  const row = await env.DB.prepare(
    "SELECT total_spots, is_open, round_started_at FROM settings WHERE id = 1"
  ).first();
  if (row) return row;

  // First run — seed the one settings row.
  const seed = { total_spots: 5, is_open: 1, round_started_at: "1970-01-01T00:00:00.000Z" };
  await env.DB.prepare(
    "INSERT INTO settings (id, total_spots, is_open, round_started_at) VALUES (1, ?, ?, ?)"
  ).bind(seed.total_spots, seed.is_open, seed.round_started_at).run();
  return seed;
}

/** How many real submissions count toward the current round — everything
 *  since the last "Refill & reopen". This is the only source of truth for
 *  "remaining": there's no separate counter that can fall out of sync with
 *  what actually landed in the submissions table. */
async function claimedCount(env, roundStartedAt) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM submissions WHERE created_at >= ?"
  ).bind(roundStartedAt).first();
  return row ? Number(row.n) || 0 : 0;
}

async function spotsLeft(env) {
  const s = await getSettings(env);
  const total = Math.max(0, Number(s.total_spots) || 0);
  const claimed = await claimedCount(env, s.round_started_at);
  const remaining = Math.max(0, total - claimed);
  return { total, remaining, claimed, full: !s.is_open || remaining <= 0, isOpen: !!s.is_open };
}

/** Timing-safe string compare, so the admin password can't be probed byte by byte. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(a || "");
  const bb = enc.encode(b || "");
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function requireAdmin(request, env) {
  const expectedUser = env.ADMIN_USER;
  const expectedPass = env.ADMIN_PASSWORD;

  // Fail closed: with no configured password the dashboard stays shut.
  if (!expectedPass) {
    return new Response("Admin access is not configured yet.", { status: 503 });
  }

  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch (e) { decoded = ""; }
    const i = decoded.indexOf(":");
    const user = i < 0 ? "" : decoded.slice(0, i);
    const pass = i < 0 ? "" : decoded.slice(i + 1);
    const userOk = safeEqual(user, expectedUser || "laura");
    const passOk = safeEqual(pass, expectedPass);
    if (userOk && passOk) return null;   // authorised
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Skin Audit admin", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ---------- POST /api/submit ---------- */

async function handleSubmit(request, env, ctx) {
  const status = await spotsLeft(env);
  if (status.full) {
    return json({ error: "full", message: "This round's spots are already taken." }, 409);
  }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: "bad_request", message: "Could not read that submission." }, 400);
  }

  const data = {};
  for (const field of TEXT_FIELDS) {
    data[field] = String(form.get(field) || "").trim().slice(0, 4000);
  }

  const currentProducts = {};
  for (const [key, field] of Object.entries(PRODUCT_FIELDS)) {
    currentProducts[key] = String(form.get(field) || "").trim().slice(0, 1000);
  }

  const intake = { currentProducts };
  for (const field of INTAKE_TEXT_FIELDS) {
    intake[field] = String(form.get(field) || "").trim().slice(0, 4000);
  }
  intake.health_conditions = form.getAll("health_conditions")
    .map(value => String(value).trim().slice(0, 200)).filter(Boolean).slice(0, 30);
  intake.supplements = form.getAll("supplements")
    .map(value => String(value).trim().slice(0, 200)).filter(Boolean).slice(0, 30);

  if (!data.name || !data.handle) {
    return json({ error: "missing_contact", message: "Name and Instagram handle or email are required." }, 400);
  }
  if (!form.get("optin")) {
    return json({ error: "missing_optin", message: "The DM opt-in is required." }, 400);
  }
  if (REQUIRED_ACKNOWLEDGMENTS.some(field => !form.get(field))) {
    return json({ error: "missing_acknowledgment", message: "Please complete every required service acknowledgment." }, 400);
  }
  const signatureName = String(form.get("signature_name") || "").trim().slice(0, 300);
  if (!signatureName) {
    return json({ error: "missing_signature", message: "Please type your full name as your electronic acknowledgment." }, 400);
  }

  const requiredIntake = [
    intake.allergies, intake.medications, intake.active_use, intake.acne_medication_use,
    intake.health_details, intake.smoking_status, intake.high_caffeine,
    intake.birth_control, intake.pregnancy_status
  ];
  if (requiredIntake.some(value => !value) || !intake.health_conditions.length || !intake.supplements.length) {
    return json({ error: "missing_intake", message: "Please complete every required health and skincare question." }, 400);
  }
  if (intake.active_use === "Yes, currently using" && !intake.active_details) {
    return json({ error: "missing_active_details", message: "Please specify the active product you currently use." }, 400);
  }
  if (intake.acne_medication_use === "Yes" && !intake.acne_medication_details) {
    return json({ error: "missing_acne_medication_details", message: "Please specify the acne medication and when you last used it." }, 400);
  }
  if (intake.birth_control === "Yes" && !intake.birth_control_type) {
    return json({ error: "missing_birth_control_type", message: "Please specify the type of birth control." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const submittedDate = now.toISOString().slice(0, 10);   // just a label — not a gating bucket

  // Validate every photo before writing anything, so a bad upload can't
  // leave half a submission's images orphaned in the bucket.
  const photos = {};
  for (const field of PHOTO_FIELDS) {
    const file = form.get(field);
    if (!file || typeof file === "string" || !file.size) {
      return json({ error: "missing_photo", message: `Missing photo: ${field}.` }, 400);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return json({ error: "photo_too_large", message: "One of those photos is too large." }, 413);
    }
    if (!(file.type || "").startsWith("image/")) {
      return json({ error: "bad_photo_type", message: "Photos must be image files." }, 415);
    }
    photos[field] = file;
  }

  const keys = {};
  const written = [];
  try {
    for (const field of PHOTO_FIELDS) {
      const file = photos[field];
      const ext = (file.type.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
      const key = `${submittedDate}/${id}/${field}.${ext}`;
      await env.PHOTOS.put(key, file.stream(), {
        httpMetadata: { contentType: file.type }
      });
      written.push(key);
      keys[field] = key;
    }

    await env.DB.prepare(
      `INSERT INTO submissions
         (id, created_at, week_of, status, name, handle, concern, duration, tried, result,
          morning_routine, night_routine, after_wash, lifestyle, optin, intake_details,
          service_acknowledgment, photo_marketing_consent, signature_name, consent_version,
          consented_at, photo_front, photo_left, photo_right, photo_shelfie)
       VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, now.toISOString(), submittedDate,
      data.name, data.handle, data.concern, data.duration, data.tried, data.result,
      data.morning_routine, data.night_routine, data.after_wash, data.lifestyle,
      JSON.stringify(intake), form.get("photo_marketing_consent") ? 1 : 0,
      signatureName, CONSENT_VERSION, now.toISOString(),
      keys.photo_front, keys.photo_left, keys.photo_right, keys.photo_shelfie
    ).run();

    // Recount instead of decrementing a separate counter, so "remaining" can
    // never drift from what's actually in the submissions table. If this
    // insert pushed the round over its cap (someone else grabbed the last
    // spot while this one was uploading photos), back it out rather than
    // accept a sixth person into a five-spot round.
    const settings = await getSettings(env);
    const claimed = await claimedCount(env, settings.round_started_at);
    const total = Math.max(0, Number(settings.total_spots) || 0);
    if (!settings.is_open || claimed > total) {
      await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();
      for (const key of written) {
        try { await env.PHOTOS.delete(key); } catch (e) { /* best effort */ }
      }
      return json({ error: "full", message: "This round's spots are already taken." }, 409);
    }
  } catch (err) {
    // Roll the photos back so failed attempts don't accumulate in storage.
    for (const key of written) {
      try { await env.PHOTOS.delete(key); } catch (e) { /* best effort */ }
    }
    return json({ error: "server_error", message: "Could not save that. Please try again." }, 500);
  }

  const after = await spotsLeft(env);
  ctx.waitUntil(notifyLaura(env, { name: data.name, handle: data.handle }));
  return json({ ok: true, id, remaining: after.remaining });
}

/* ---------- POST /api/waitlist ---------- */

async function handleWaitlist(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: "bad_request" }, 400);
  }

  const name = String(form.get("name") || "").trim().slice(0, 200);
  const handle = String(form.get("handle") || "").trim().slice(0, 200);
  if (!name || !handle) {
    return json({ error: "missing_fields", message: "Name and handle are required." }, 400);
  }

  await env.DB.prepare(
    "INSERT INTO waitlist (id, created_at, name, handle) VALUES (?,?,?,?)"
  ).bind(crypto.randomUUID(), new Date().toISOString(), name, handle).run();

  return json({ ok: true });
}

/* ---------- GET /admin ---------- */

const ADMIN_CSS = `
:root{--wine:#2c3424;--rose:#7a5f2a;--rose-deep:#5e4820;--cream:#f1eada;--paper:#faf7ef;
--beige:#e9e1ce;--blush:#e4eade;--muted:#4c583e;--brass:#c6a45c;--brass-hi:#e3cb92;
--brass-deep:#8c6b33;--border:rgba(44,52,36,.18)}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--wine);
font-family:"Avenir Next",Avenir,"Helvetica Neue",Arial,sans-serif;font-size:15px}
header{background:var(--wine);color:#f1eada;padding:20px 24px;display:flex;
align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
header h1{font-family:Georgia,serif;font-size:25px;margin:0;font-weight:400;letter-spacing:-.025em}
header .meta{font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.bar{padding:16px 24px;border-bottom:1px solid var(--border);display:flex;gap:12px;
align-items:center;flex-wrap:wrap;background:var(--paper)}
.btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--brass-deep),var(--brass) 48%,var(--brass-hi));color:var(--wine);
text-decoration:none;font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;
padding:12px 20px;border:0;cursor:pointer;transition:transform .2s ease,filter .2s ease}
.btn:hover{transform:translateY(-2px);filter:brightness(1.05)}
.btn--ghost{background:var(--paper);color:var(--wine);border:1px solid var(--border)}
.wrap{padding:24px;overflow-x:auto}
table{width:100%;border-collapse:collapse;background:var(--paper);
border:1px solid var(--border);min-width:820px}
th{background:var(--beige);text-align:left;font-size:10px;letter-spacing:.1em;
text-transform:uppercase;padding:12px 14px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--border);vertical-align:top;font-size:14px}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;font-size:10px;font-weight:750;letter-spacing:.08em;
text-transform:uppercase;padding:4px 9px}
.tag--new{background:var(--brass-deep);color:#f1eada}
.tag--reviewed{background:var(--beige);color:var(--wine)}
.tag--sent{background:var(--wine);color:#f1eada}
details{background:var(--paper);border:1px solid var(--border);margin-bottom:10px}
summary{cursor:pointer;padding:16px 18px;font-weight:700;display:flex;gap:12px;
align-items:center;flex-wrap:wrap;justify-content:space-between}
.body{padding:0 18px 18px}
.qa{margin:0 0 14px}
.qa dt{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.qa dd{margin:0;white-space:pre-wrap;line-height:1.6}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:16px}
.shots a{display:block;border:1px solid var(--border)}
.shots img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.shots span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;
padding:6px 8px;background:var(--blush);text-align:center}
.empty{padding:60px 24px;text-align:center;color:var(--muted)}
form.inline{display:inline}
.settings{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--paper);
display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap}
.settings form{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}
.settings label{display:flex;flex-direction:column;gap:6px;font-size:10px;
letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
.settings input[type=number]{width:90px;font-size:15px;font-family:inherit;color:var(--wine);
background:var(--cream);border:1px solid var(--border);padding:9px 10px}
.settings .toggle{flex-direction:row;align-items:center;gap:8px;font-size:12px}
.settings .toggle input{width:auto}
.settings-note{font-size:12px;color:var(--muted);line-height:1.6;max-width:280px}
.status-pill{font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;
padding:5px 12px}
.status-pill--open{background:linear-gradient(135deg,var(--brass-deep),var(--brass-hi));color:var(--wine)}
.status-pill--closed{background:var(--border);color:var(--wine)}
`;

const PRODUCT_LABELS = {
  cleanser: "Cleanser / face wash",
  barSoap: "Bar soap",
  exfoliant: "Face scrub / exfoliant",
  toner: "Toner",
  serums: "Serum(s)",
  moisturizers: "Moisturizer(s)",
  sunscreen: "Sunscreen",
  eyeProducts: "Eye product(s)",
  lipProducts: "Lip product(s)"
};

function parseIntake(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function formatCurrentProducts(products) {
  if (!products || typeof products !== "object") return "";
  return Object.entries(PRODUCT_LABELS)
    .map(([key, label]) => products[key] ? `${label}: ${products[key]}` : "")
    .filter(Boolean).join("\n");
}

function submissionRow(s) {
  const shot = (key, label) => key
    ? `<a href="/admin/photo/${encodeURI(key)}" target="_blank" rel="noopener">
         <img src="/admin/photo/${encodeURI(key)}" alt="${esc(label)}" loading="lazy">
         <span>${esc(label)}</span></a>`
    : "";

  const qa = (label, value) => value
    ? `<div class="qa"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "";

  const when = new Date(s.created_at).toLocaleString("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York"
  });
  const intake = parseIntake(s.intake_details);

  return `<details>
    <summary>
      <span><strong>${esc(s.name)}</strong> &nbsp;<span style="color:var(--muted)">${esc(s.handle)}</span></span>
      <span>
        <span class="tag tag--${esc(s.status)}">${esc(s.status)}</span>
        &nbsp;<span style="color:var(--muted);font-weight:400;font-size:12px">${esc(when)}</span>
      </span>
    </summary>
    <div class="body">
      <dl>
        ${qa("1. Main concern", s.concern)}
        ${qa("2. How long", s.duration)}
        ${qa("3. Already tried", s.tried)}
        ${qa("4. What happened", s.result)}
        ${qa("5. Morning routine", s.morning_routine)}
        ${qa("6. Night routine", s.night_routine)}
        ${qa("7. 1 hour after washing", s.after_wash)}
        ${qa("8. Typical day", s.lifestyle)}
        ${qa("Current products", formatCurrentProducts(intake.currentProducts))}
        ${qa("Known allergies / sensitivities / reactions", intake.allergies)}
        ${qa("Current medications", intake.medications)}
        ${qa("Retinoids, exfoliating acids, or other strong actives", intake.active_use)}
        ${qa("Current active product", intake.active_details)}
        ${qa("Acne medication history", intake.acne_medication_use)}
        ${qa("Acne medication and date last used", intake.acne_medication_details)}
        ${qa("Health conditions", Array.isArray(intake.health_conditions) ? intake.health_conditions.join(", ") : "")}
        ${qa("Health details", intake.health_details)}
        ${qa("Supplements", Array.isArray(intake.supplements) ? intake.supplements.join(", ") : "")}
        ${qa("Other supplements", intake.supplements_other)}
        ${qa("Smoking", intake.smoking_status)}
        ${qa("More than 4 caffeinated beverages daily", intake.high_caffeine)}
        ${qa("Birth control", intake.birth_control)}
        ${qa("Birth control type", intake.birth_control_type)}
        ${qa("Pregnancy / breastfeeding", intake.pregnancy_status)}
        ${qa("Service acknowledgment", s.service_acknowledgment ? `Accepted — version ${s.consent_version || "unknown"} at ${s.consented_at || s.created_at}` : "Not recorded")}
        ${qa("Electronic acknowledgment", s.signature_name)}
        ${qa("Optional marketing photo permission", s.photo_marketing_consent ? "Yes" : "No")}
      </dl>
      <div class="shots">
        ${shot(s.photo_front, "Front")}
        ${shot(s.photo_left, "Left")}
        ${shot(s.photo_right, "Right")}
        ${shot(s.photo_shelfie, "Shelfie")}
      </div>
      <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
        ${["new", "reviewed", "sent"].map(st => `
          <form class="inline" method="POST" action="/admin/status">
            <input type="hidden" name="id" value="${esc(s.id)}">
            <input type="hidden" name="status" value="${st}">
            <button class="btn btn--ghost" type="submit"${s.status === st ? " disabled" : ""}>
              Mark ${st}
            </button>
          </form>`).join("")}
      </div>
    </div>
  </details>`;
}

async function handleAdmin(request, env) {
  const { results: subs } = await env.DB.prepare(
    "SELECT * FROM submissions ORDER BY created_at DESC"
  ).all();
  const { results: wait } = await env.DB.prepare(
    "SELECT * FROM waitlist ORDER BY created_at DESC"
  ).all();
  const status = await spotsLeft(env);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Skin Audit — Admin</title><style>${ADMIN_CSS}</style></head><body>
<header>
  <h1>The Free Mom Skin Audit</h1>
  <span class="meta">
    <span class="status-pill ${status.isOpen ? "status-pill--open" : "status-pill--closed"}">
      ${status.isOpen ? "Open" : "Closed"}
    </span>
    &middot; ${status.remaining} of ${status.total} spots left
  </span>
</header>

<div class="settings">
  <form method="POST" action="/admin/settings">
    <label>Spots this round
      <input type="number" name="total_spots" min="0" max="9999" value="${status.total}">
    </label>
    <label class="toggle">
      <input type="checkbox" name="is_open" ${status.isOpen ? "checked" : ""}>
      Open for new submissions
    </label>
    <button class="btn" type="submit">Save</button>
  </form>
  <span class="settings-note">
    ${status.claimed} claimed this round &middot; ${status.remaining} remaining
    <br>Remaining is calculated automatically from real submissions — nothing to type in.
  </span>
  <form method="POST" action="/admin/settings" class="inline">
    <input type="hidden" name="total_spots" value="${status.total}">
    <input type="hidden" name="is_open" value="on">
    <input type="hidden" name="reset_round" value="1">
    <button class="btn btn--ghost" type="submit">Refill to ${status.total} &amp; reopen</button>
  </form>
</div>

<div class="bar">
  <a class="btn" href="/admin/export.csv">Download spreadsheet (CSV)</a>
  <a class="btn btn--ghost" href="/admin/export.csv?type=waitlist">Waitlist CSV</a>
  <span style="color:var(--muted);font-size:13px">
    ${subs.length} submission${subs.length === 1 ? "" : "s"} &middot; ${wait.length} on the waitlist
  </span>
</div>

<div class="wrap">
  ${subs.length ? subs.map(submissionRow).join("") : '<p class="empty">No submissions yet.</p>'}

  ${wait.length ? `
  <h2 style="font-family:Georgia,serif;margin:36px 0 14px">Waitlist</h2>
  <table>
    <thead><tr><th>Name</th><th>Handle</th><th>Joined</th></tr></thead>
    <tbody>${wait.map(w => `<tr>
      <td>${esc(w.name)}</td><td>${esc(w.handle)}</td>
      <td>${esc(new Date(w.created_at).toLocaleDateString("en-US", { timeZone: "America/New_York" }))}</td>
    </tr>`).join("")}</tbody>
  </table>` : ""}
</div>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

/* ---------- GET /admin/export.csv ---------- */

function toCsv(rows, columns) {
  // Prefix formula-triggering characters so Excel treats them as text, not code.
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = columns.map(c => cell(c.label)).join(",");
  const body = rows.map(r => columns.map(c => cell(r[c.key])).join(",")).join("\r\n");
  return "﻿" + head + "\r\n" + body;   // BOM so Excel reads UTF-8 correctly
}

async function handleExport(request, env) {
  const type = new URL(request.url).searchParams.get("type");

  if (type === "waitlist") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM waitlist ORDER BY created_at DESC"
    ).all();
    const csv = toCsv(results, [
      { key: "created_at", label: "Joined" },
      { key: "name", label: "Name" },
      { key: "handle", label: "Instagram / Email" }
    ]);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="waitlist-${new Date().toISOString().slice(0,10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM submissions ORDER BY created_at DESC"
  ).all();

  const origin = new URL(request.url).origin;
  const rows = results.map(s => {
    const intake = parseIntake(s.intake_details);
    return Object.assign({}, s, {
      current_products: formatCurrentProducts(intake.currentProducts),
      allergies: intake.allergies || "",
      medications: intake.medications || "",
      active_use: intake.active_use || "",
      active_details: intake.active_details || "",
      acne_medication_use: intake.acne_medication_use || "",
      acne_medication_details: intake.acne_medication_details || "",
      health_conditions: Array.isArray(intake.health_conditions) ? intake.health_conditions.join(", ") : "",
      health_details: intake.health_details || "",
      supplements: Array.isArray(intake.supplements) ? intake.supplements.join(", ") : "",
      supplements_other: intake.supplements_other || "",
      smoking_status: intake.smoking_status || "",
      high_caffeine: intake.high_caffeine || "",
      birth_control: intake.birth_control || "",
      birth_control_type: intake.birth_control_type || "",
      pregnancy_status: intake.pregnancy_status || "",
      service_acknowledgment: s.service_acknowledgment ? "Yes" : "No",
      photo_marketing_consent: s.photo_marketing_consent ? "Yes" : "No",
      photos: PHOTO_FIELDS
        .map(f => s[f] ? `${origin}/admin/photo/${s[f]}` : "")
        .filter(Boolean).join("  ")
    });
  });

  const csv = toCsv(rows, [
    { key: "created_at", label: "Submitted" },
    { key: "status", label: "Status" },
    { key: "name", label: "Name" },
    { key: "handle", label: "Instagram / Email" },
    { key: "concern", label: "1. Main concern" },
    { key: "duration", label: "2. How long" },
    { key: "tried", label: "3. Already tried" },
    { key: "result", label: "4. What happened" },
    { key: "morning_routine", label: "5. Morning routine" },
    { key: "night_routine", label: "6. Night routine" },
    { key: "after_wash", label: "7. 1hr after washing" },
    { key: "lifestyle", label: "8. Typical day" },
    { key: "current_products", label: "Current products" },
    { key: "allergies", label: "Allergies / sensitivities / reactions" },
    { key: "medications", label: "Current medications" },
    { key: "active_use", label: "Strong active use" },
    { key: "active_details", label: "Current active product" },
    { key: "acne_medication_use", label: "Acne medication history" },
    { key: "acne_medication_details", label: "Acne medication details" },
    { key: "health_conditions", label: "Health conditions" },
    { key: "health_details", label: "Health details" },
    { key: "supplements", label: "Supplements" },
    { key: "supplements_other", label: "Other supplements" },
    { key: "smoking_status", label: "Smoking" },
    { key: "high_caffeine", label: "More than 4 caffeinated drinks daily" },
    { key: "birth_control", label: "Birth control" },
    { key: "birth_control_type", label: "Birth control type" },
    { key: "pregnancy_status", label: "Pregnancy / breastfeeding" },
    { key: "service_acknowledgment", label: "Service acknowledgment" },
    { key: "signature_name", label: "Electronic acknowledgment" },
    { key: "consent_version", label: "Consent version" },
    { key: "consented_at", label: "Consented at" },
    { key: "photo_marketing_consent", label: "Marketing photo permission" },
    { key: "photos", label: "Photo links" }
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skin-audits-${new Date().toISOString().slice(0,10)}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}

/* ---------- routing ---------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/status") return json(await spotsLeft(env));

      if (path === "/api/submit") {
        if (request.method !== "POST") return json({ error: "method" }, 405);
        return await handleSubmit(request, env, ctx);
      }

      if (path === "/api/waitlist") {
        if (request.method !== "POST") return json({ error: "method" }, 405);
        return await handleWaitlist(request, env);
      }

      if (path === "/admin" || path.startsWith("/admin/")) {
        const denied = requireAdmin(request, env);
        if (denied) return denied;

        if (path === "/admin" || path === "/admin/") return await handleAdmin(request, env);
        if (path === "/admin/export.csv") return await handleExport(request, env);

        if (path.startsWith("/admin/photo/")) {
          const key = decodeURIComponent(path.slice("/admin/photo/".length));
          const object = await env.PHOTOS.get(key);
          if (!object) return new Response("Not found", { status: 404 });
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set("etag", object.httpEtag);
          headers.set("Cache-Control", "private, max-age=3600");
          return new Response(object.body, { headers });
        }

        if (path === "/admin/status" && request.method === "POST") {
          const form = await request.formData();
          const id = String(form.get("id") || "");
          const next = String(form.get("status") || "");
          if (!["new", "reviewed", "sent"].includes(next)) {
            return new Response("Bad status", { status: 400 });
          }
          await env.DB.prepare("UPDATE submissions SET status = ? WHERE id = ?")
            .bind(next, id).run();
          return Response.redirect(url.origin + "/admin", 303);
        }

        if (path === "/admin/settings" && request.method === "POST") {
          const form = await request.formData();
          const total = Math.max(0, Math.min(9999, parseInt(form.get("total_spots"), 10) || 0));
          const isOpen = form.get("is_open") ? 1 : 0;
          const resetRound = form.get("reset_round") ? 1 : 0;
          await getSettings(env);   // make sure the row exists before updating it
          if (resetRound) {
            // "Refill & reopen" — start a fresh round. Submissions before this
            // moment stop counting against the cap, so remaining goes back to total.
            await env.DB.prepare(
              "UPDATE settings SET total_spots = ?, is_open = ?, round_started_at = ? WHERE id = 1"
            ).bind(total, isOpen, new Date().toISOString()).run();
          } else {
            await env.DB.prepare(
              "UPDATE settings SET total_spots = ?, is_open = ? WHERE id = 1"
            ).bind(total, isOpen).run();
          }
          return Response.redirect(url.origin + "/admin", 303);
        }

        return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      return json({ error: "server_error", message: String(err && err.message || err) }, 500);
    }

    // Everything else: the static site.
    return env.ASSETS.fetch(request);
  }
};

