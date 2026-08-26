/* The Free Mom Skin Audit — page behavior.
   Everything tunable lives in config.js. */
(function () {
  "use strict";

  var CFG = Object.assign({
    spotsTotal: 5,
    spotsRemaining: 5,
    formEndpoint: "",
    waitlistEndpoint: "",
    showCountdown: true,
    cutoffWeekday: 4,
    cutoffHour: 23,
    cutoffMinute: 59
  }, window.AUDIT_CONFIG || {});

  var total = Math.max(0, Number(CFG.spotsTotal) || 0);
  var remaining = Math.min(total, Math.max(0, Number(CFG.spotsRemaining) || 0));
  var isFull = remaining === 0;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ---------- 1. Spot counts ---------- */
  $$("[data-spots-total]").forEach(function (el) { el.textContent = total; });
  $$("[data-spots-remaining]").forEach(function (el) { el.textContent = remaining; });

  var pips = $("[data-spot-pips]");
  if (pips) {
    for (var i = 0; i < total; i++) {
      var li = document.createElement("li");
      li.className = "pip" + (i < remaining ? " pip--open" : " pip--taken");
      pips.appendChild(li);
    }
  }

  /* ---------- 2. Form <-> waitlist swap ---------- */
  var formPanel = $('[data-panel="form"]');
  var waitlistPanel = $('[data-panel="waitlist"]');
  if (formPanel) formPanel.hidden = isFull;
  if (waitlistPanel) waitlistPanel.hidden = !isFull;

  if (isFull) {
    // Every "claim a spot" button becomes a "join the waitlist" button,
    // and every jump link points at whichever section is actually on the page.
    if (waitlistPanel && !waitlistPanel.id) waitlistPanel.id = "waitlist";
    $$('a[href="#claim"]').forEach(function (a) {
      a.setAttribute("href", "#waitlist");
      var arrow = a.querySelector("span[aria-hidden]");
      a.textContent = "Join the Waitlist ";
      if (arrow) a.appendChild(arrow);
      else a.insertAdjacentHTML("beforeend", '<span aria-hidden="true">→</span>');
    });
    $$("[data-spots-remaining]").forEach(function (el) { el.textContent = "0"; });
    var stickyCount = $("[data-stickybar] p");
    if (stickyCount) stickyCount.innerHTML = "<strong>Full this week.</strong> Next spots Monday.";
  }

  /* ---------- 3. Countdown to the weekly cutoff ---------- */
  var countdown = $("[data-countdown]");
  if (countdown && CFG.showCountdown && !isFull) {
    var valueEl = $("[data-countdown-value]", countdown);
    var tick = function () {
      var now = new Date();
      var cutoff = new Date(now);
      var days = (CFG.cutoffWeekday - now.getDay() + 7) % 7;
      cutoff.setDate(now.getDate() + days);
      cutoff.setHours(CFG.cutoffHour, CFG.cutoffMinute, 0, 0);
      if (cutoff <= now) cutoff.setDate(cutoff.getDate() + 7);

      var ms = cutoff - now;
      var d = Math.floor(ms / 86400000);
      var h = Math.floor(ms / 3600000) % 24;
      var m = Math.floor(ms / 60000) % 60;
      var s = Math.floor(ms / 1000) % 60;
      valueEl.textContent = (d > 0 ? d + "d " : "") + h + "h " + m + "m " + s + "s";
    };
    tick();
    setInterval(tick, 1000);
    countdown.hidden = false;
  }

  /* ---------- 4. Photo uploads: show the file name / thumbnail ---------- */
  $$("[data-upload]").forEach(function (box) {
    var input = $("input[type=file]", box);
    var state = $(".upload__state", box);
    if (!input || !state) return;
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) {
        box.classList.remove("upload--filled");
        state.textContent = "Tap to upload";
        box.style.removeProperty("--thumb");
        return;
      }
      box.classList.add("upload--filled");
      state.textContent = file.name.length > 22 ? file.name.slice(0, 19) + "…" : file.name;
      var url = URL.createObjectURL(file);
      box.style.setProperty("--thumb", 'url("' + url + '")');
    });
  });

  /* ---------- 5. Submission ---------- */
  function firstInvalid(form) {
    var groups = {};
    var missing = null;

    $$("[required]", form).forEach(function (el) {
      if (missing) return;
      if (el.type === "radio") {
        if (groups[el.name]) return;
        groups[el.name] = true;
        if (!$('input[name="' + el.name + '"]:checked', form)) missing = el;
        return;
      }
      if (el.type === "checkbox") { if (!el.checked) missing = el; return; }
      if (el.type === "file") { if (!el.files.length) missing = el; return; }
      if (!el.value.trim()) missing = el;
    });

    return missing;
  }

  function messageFor(el) {
    if (el.type === "file") return "Please add all four photos — they’re how I actually read your skin.";
    if (el.type === "checkbox") return "Please tick the box so I’m allowed to DM you your audit.";
    if (el.type === "radio") return "Please answer every question above — “I don’t know” counts.";
    return "Please fill in every question above so I can build your audit properly.";
  }

  function wire(form, endpoint, confirmPanel, storeKey) {
    if (!form) return;
    var errorEl = $("[data-form-error]", form);
    var button = $("button[type=submit]", form);

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var bad = firstInvalid(form);
      if (bad) {
        errorEl.textContent = messageFor(bad);
        errorEl.hidden = false;
        var focusable = bad.type === "file" ? bad.closest("[data-upload]") : bad;
        (focusable || bad).scrollIntoView({ behavior: "smooth", block: "center" });
        if (bad.focus) bad.focus({ preventScroll: true });
        return;
      }
      errorEl.hidden = true;

      var done = function () {
        form.hidden = true;
        if (confirmPanel) {
          confirmPanel.hidden = false;
          confirmPanel.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };

      var fail = function () {
        button.disabled = false;
        button.classList.remove("is-loading");
        errorEl.textContent = "Something went wrong sending that. Try once more — or DM me on Instagram and I’ll take it manually.";
        errorEl.hidden = false;
      };

      button.disabled = true;
      button.classList.add("is-loading");

      if (!endpoint) {
        // No endpoint configured yet: keep the answers locally so nothing a
        // tester types is silently thrown away, and show the confirmation.
        try {
          var plain = {};
          new FormData(form).forEach(function (v, k) {
            plain[k] = (v instanceof File) ? v.name : v;
          });
          localStorage.setItem(storeKey + ":" + Date.now(), JSON.stringify(plain));
        } catch (e) { /* private mode — nothing to do */ }
        done();
        return;
      }

      fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (res) { res.ok ? done() : fail(); })
        .catch(fail);
    });
  }

  wire($("#audit-form"), CFG.formEndpoint, $('[data-panel="confirm"]'), "skin-audit");
  wire($("#waitlist-form"), CFG.waitlistEndpoint, $('[data-panel="waitlist-confirm"]'), "skin-audit-waitlist");

  /* ---------- 6. Sticky mobile CTA, once the hero is out of view ---------- */
  var sticky = $("[data-stickybar]");
  var hero = $(".hero");
  if (sticky && hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      sticky.hidden = entries[0].isIntersecting;
    }, { rootMargin: "-80px 0px 0px 0px" }).observe(hero);
  }
})();
