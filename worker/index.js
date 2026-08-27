/* The Free Mom Skin Audit — API + Laura's admin dashboard.
 *
 * Routes:
 *   GET  /api/status          → { total, remaining, full }
 *   POST /api/submit          → store an audit submission (+ 4 photos in R2)
 *   POST /api/waitlist        → store a waitlist signup
 *   GET  /admin               → Laura's dashboard (basic auth)
 *   GET  /admin/export.csv    → spreadsheet export (basic auth)
 *   GET  /admin/photo/<key>   → private photo, streamed from R2 (basic auth)
 *   POST /admin/status        → mark a submission new/reviewed/sent (basic auth)
 *
 * Everything else falls through to the static site in /public.
 */

const SPOTS_PER_WEEK = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;   // 8 MB per photo, after client-side compression
const PHOTO_FIELDS = ["photo_front", "photo_left", "photo_right", "photo_shelfie"];

const TEXT_FIELDS = [
  "name", "handle", "concern", "duration", "tried", "result",
  "morning_routine", "night_routine", "after_wash", "lifestyle"
];

/* ---------- helpers ---------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

/** Monday of the current week, as YYYY-MM-DD — the bucket spots are counted in. */
function weekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;          // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

async function spotsLeft(env) {
  const week = weekOf();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM submissions WHERE week_of = ?"
  ).bind(week).first();
  const used = (row && row.n) || 0;
  const total = Number(env.SPOTS_PER_WEEK || SPOTS_PER_WEEK);
  return { total, remaining: Math.max(0, total - used), full: used >= total };
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

async function handleSubmit(request, env) {
  const status = await spotsLeft(env);
  if (status.full) {
    return json({ error: "full", message: "This week's spots are already taken." }, 409);
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

  if (!data.name || !data.handle) {
    return json({ error: "missing_contact", message: "Name and Instagram handle are required." }, 400);
  }
  if (!form.get("optin")) {
    return json({ error: "missing_optin", message: "The DM opt-in is required." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const week = weekOf(now);

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
      const key = `${week}/${id}/${field}.${ext}`;
      await env.PHOTOS.put(key, file.stream(), {
        httpMetadata: { contentType: file.type }
      });
      written.push(key);
      keys[field] = key;
    }

    await env.DB.prepare(
      `INSERT INTO submissions
         (id, created_at, week_of, status, name, handle, concern, duration, tried, result,
          morning_routine, night_routine, after_wash, lifestyle, optin,
          photo_front, photo_left, photo_right, photo_shelfie)
       VALUES (?,?,?,'new',?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`
    ).bind(
      id, now.toISOString(), week,
      data.name, data.handle, data.concern, data.duration, data.tried, data.result,
      data.morning_routine, data.night_routine, data.after_wash, data.lifestyle,
      keys.photo_front, keys.photo_left, keys.photo_right, keys.photo_shelfie
    ).run();
  } catch (err) {
    // Roll the photos back so failed attempts don't accumulate in storage.
    for (const key of written) {
      try { await env.PHOTOS.delete(key); } catch (e) { /* best effort */ }
    }
    return json({ error: "server_error", message: "Could not save that. Please try again." }, 500);
  }

  const after = await spotsLeft(env);
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
:root{--wine:#37231f;--rose:#a55448;--cream:#fbf7f0;--paper:#fffdf9;--beige:#eadfd5;
--blush:#f8eee9;--muted:#6a5853;--border:rgba(55,35,31,.16)}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--wine);
font-family:"Avenir Next",Avenir,"Helvetica Neue",Arial,sans-serif;font-size:15px}
header{background:var(--wine);color:#fff8f4;padding:20px 24px;display:flex;
align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
header h1{font-family:Georgia,serif;font-size:22px;margin:0;font-weight:700}
header .meta{font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.bar{padding:16px 24px;border-bottom:1px solid var(--border);display:flex;gap:12px;
align-items:center;flex-wrap:wrap;background:var(--paper)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--wine);color:#fff8f4;
text-decoration:none;font-size:11px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;
padding:12px 20px;border:0;cursor:pointer}
.btn:hover{background:var(--rose)}
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
.tag--new{background:var(--rose);color:#fff8f4}
.tag--reviewed{background:var(--beige);color:var(--wine)}
.tag--sent{background:var(--wine);color:#fff8f4}
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
`;

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
  <span class="meta">${status.remaining} of ${status.total} spots left &middot; week of ${weekOf()}</span>
</header>

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
      { key: "handle", label: "Instagram / email" }
    ]);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="waitlist-${weekOf()}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM submissions ORDER BY created_at DESC"
  ).all();

  const origin = new URL(request.url).origin;
  const rows = results.map(s => Object.assign({}, s, {
    photos: PHOTO_FIELDS
      .map(f => s[f] ? `${origin}/admin/photo/${s[f]}` : "")
      .filter(Boolean).join("  ")
  }));

  const csv = toCsv(rows, [
    { key: "created_at", label: "Submitted" },
    { key: "status", label: "Status" },
    { key: "name", label: "Name" },
    { key: "handle", label: "Instagram" },
    { key: "concern", label: "1. Main concern" },
    { key: "duration", label: "2. How long" },
    { key: "tried", label: "3. Already tried" },
    { key: "result", label: "4. What happened" },
    { key: "morning_routine", label: "5. Morning routine" },
    { key: "night_routine", label: "6. Night routine" },
    { key: "after_wash", label: "7. 1hr after washing" },
    { key: "lifestyle", label: "8. Typical day" },
    { key: "photos", label: "Photo links" }
  ]);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skin-audits-${weekOf()}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}

/* ---------- routing ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/api/status") return json(await spotsLeft(env));

      if (path === "/api/submit") {
        if (request.method !== "POST") return json({ error: "method" }, 405);
        return await handleSubmit(request, env);
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

        return new Response("Not found", { status: 404 });
      }
    } catch (err) {
      return json({ error: "server_error", message: String(err && err.message || err) }, 500);
    }

    // Everything else: the static site.
    return env.ASSETS.fetch(request);
  }
};
