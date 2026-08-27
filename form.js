/* Claim Your Spot — the form's own page.
   Steps through one question group at a time; validation only checks
   the step on screen, so nothing feels blocked by a question three
   screens away. Everything tunable lives in config.js. */
(function () {
  "use strict";

  var CFG = Object.assign({
    spotsTotal: 5,
    spotsRemaining: 5,
    formEndpoint: "",
    waitlistEndpoint: ""
  }, window.AUDIT_CONFIG || {});

  var total = Math.max(0, Number(CFG.spotsTotal) || 0);
  var remaining = Math.min(total, Math.max(0, Number(CFG.spotsRemaining) || 0));
  var isFull = remaining === 0;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  $$("[data-spots-total]").forEach(function (el) { el.textContent = total; });
  $$("[data-spots-remaining]").forEach(function (el) { el.textContent = remaining; });

  var panels = {
    wizard: $('[data-panel="wizard"]'),
    confirm: $('[data-panel="confirm"]'),
    waitlist: $('[data-panel="waitlist"]'),
    waitlistConfirm: $('[data-panel="waitlist-confirm"]')
  };

  function show(name) {
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== name;
    });
  }

  /* ---------- Shared validation helpers ---------- */
  function firstInvalid(scope) {
    var groups = {};
    var missing = null;

    $$("[required]", scope).forEach(function (el) {
      if (missing) return;
      if (el.type === "radio") {
        if (groups[el.name]) return;
        groups[el.name] = true;
        if (!$('input[name="' + el.name + '"]:checked', scope)) missing = el;
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

  function showError(errorEl, bad) {
    errorEl.textContent = messageFor(bad);
    errorEl.hidden = false;
    var focusable = bad.type === "file" ? bad.closest("[data-upload]") : bad;
    (focusable || bad).scrollIntoView({ behavior: "smooth", block: "center" });
    if (bad.focus) bad.focus({ preventScroll: true });
  }

  /* ---------- Photo uploads: show a thumbnail once picked ---------- */
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
      box.style.setProperty("--thumb", 'url("' + URL.createObjectURL(file) + '")');
    });
  });

  /* ---------- Generic submit wiring (used by both forms) ---------- */
  function wire(form, endpoint, onDone, storeKey) {
    if (!form) return;
    var errorEl = $("[data-form-error]", form) || $("[data-form-error]");
    var button = $("button[type=submit]", form) || document.querySelector('[form="' + form.id + '"]');

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var bad = firstInvalid(form);
      if (bad) { showError(errorEl, bad); return; }
      if (errorEl) errorEl.hidden = true;

      var fail = function () {
        if (button) { button.disabled = false; button.classList.remove("is-loading"); }
        errorEl.textContent = "Something went wrong sending that. Try once more — or DM me on Instagram and I’ll take it manually.";
        errorEl.hidden = false;
      };

      if (button) { button.disabled = true; button.classList.add("is-loading"); }

      if (!endpoint) {
        try {
          var plain = {};
          new FormData(form).forEach(function (v, k) {
            plain[k] = (v instanceof File) ? v.name : v;
          });
          localStorage.setItem(storeKey + ":" + Date.now(), JSON.stringify(plain));
        } catch (e) { /* private mode — nothing to do */ }
        onDone();
        return;
      }

      fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
        .then(function (res) { res.ok ? onDone() : fail(); })
        .catch(fail);
    });
  }

  /* ---------- The wizard ---------- */
  if (!isFull && panels.wizard) {
    var form = $("#audit-form");
    var steps = $$("[data-step]", form);
    var bar = $("[data-fx-bar]");
    var stepLabel = $("[data-fx-step-label]");
    var stepName = $("[data-fx-step-name]");
    var backBtn = $("[data-fx-back]");
    var nextBtn = $("[data-fx-next]");
    var submitBtn = $("[data-fx-submit]");
    var errorEl = $("[data-form-error]", form);
    var current = 0;

    function render() {
      steps.forEach(function (s, i) { s.classList.toggle("is-active", i === current); });
      bar.style.width = ((current + 1) / steps.length * 100) + "%";
      stepLabel.textContent = "Step " + (current + 1) + " of " + steps.length;
      stepName.textContent = steps[current].dataset.stepName || "";
      backBtn.hidden = current === 0;
      var last = current === steps.length - 1;
      nextBtn.hidden = last;
      submitBtn.hidden = !last;
      errorEl.hidden = true;
      panels.wizard.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    nextBtn.addEventListener("click", function () {
      var bad = firstInvalid(steps[current]);
      if (bad) { showError(errorEl, bad); return; }
      current = Math.min(current + 1, steps.length - 1);
      render();
    });

    backBtn.addEventListener("click", function () {
      current = Math.max(current - 1, 0);
      render();
    });

    wire(form, CFG.formEndpoint, function () {
      show("confirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, "skin-audit");

    show("wizard");
    render();
  }

  /* ---------- The waitlist ---------- */
  if (isFull) {
    wire($("#waitlist-form"), CFG.waitlistEndpoint, function () {
      show("waitlistConfirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, "skin-audit-waitlist");
    show("waitlist");
  }
})();
