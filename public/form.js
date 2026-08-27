/* Claim Your Spot — the form's own page.
   Steps through one question group at a time; validation only checks
   the step on screen, so nothing feels blocked by a question three
   screens away. Photos are resized in the browser before upload. */
(function () {
  "use strict";

  var CFG = Object.assign({
    spotsTotal: 5,
    spotsRemaining: 5,
    maxPhotoDimension: 1600,
    photoQuality: 0.85
  }, window.AUDIT_CONFIG || {});

  var total = Math.max(0, Number(CFG.spotsTotal) || 0);
  var remaining = Math.min(total, Math.max(0, Number(CFG.spotsRemaining) || 0));

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

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

  function paintCounts() {
    $$("[data-spots-total]").forEach(function (el) { el.textContent = total; });
    $$("[data-spots-remaining]").forEach(function (el) { el.textContent = remaining; });
  }

  /* ---------- Validation ---------- */
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

  /* ---------- Photo handling ----------
     Phone photos are 3–5 MB each and four of them per submission adds up fast.
     Resizing to ~1600px keeps far more detail than Laura needs (and more than
     Instagram DMs preserve anyway) at roughly a tenth of the bytes. */
  var originals = {};

  async function compress(file) {
    if (!file.type || file.type.indexOf("image/") !== 0) return file;
    if (typeof createImageBitmap !== "function") return file;

    try {
      var bitmap = await createImageBitmap(file);
      var maxDim = CFG.maxPhotoDimension;
      var scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      var w = Math.round(bitmap.width * scale);
      var h = Math.round(bitmap.height * scale);

      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();

      var blob = await new Promise(function (res) {
        canvas.toBlob(res, "image/jpeg", CFG.photoQuality);
      });

      // If compressing didn't actually help, keep the original.
      if (!blob || blob.size >= file.size) return file;

      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: Date.now()
      });
    } catch (e) {
      return file;   // HEIC or an odd codec — send it as-is and let the Worker cope
    }
  }

  $$("[data-upload]").forEach(function (box) {
    var input = $("input[type=file]", box);
    var state = $(".upload__state", box);
    if (!input || !state) return;

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) {
        delete originals[input.name];
        box.classList.remove("upload--filled");
        state.textContent = "Tap to upload";
        box.style.removeProperty("--thumb");
        return;
      }
      originals[input.name] = file;
      box.classList.add("upload--filled");
      state.textContent = file.name.length > 22 ? file.name.slice(0, 19) + "…" : file.name;
      box.style.setProperty("--thumb", 'url("' + URL.createObjectURL(file) + '")');
    });
  });

  /* ---------- Submission ---------- */
  async function buildPayload(form) {
    var fd = new FormData(form);
    // Swap each raw photo for its resized version.
    var fields = Object.keys(originals);
    for (var i = 0; i < fields.length; i++) {
      var name = fields[i];
      var smaller = await compress(originals[name]);
      fd.set(name, smaller, smaller.name);
    }
    return fd;
  }

  function wire(form, endpoint, onDone, usePhotos) {
    if (!form) return;
    var errorEl = $("[data-form-error]", form) || $("[data-form-error]");
    var button = $("button[type=submit]", form) ||
                 document.querySelector('[form="' + form.id + '"]');

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var bad = firstInvalid(form);
      if (bad) { showError(errorEl, bad); return; }
      if (errorEl) errorEl.hidden = true;

      var label = button ? button.innerHTML : "";
      if (button) {
        button.disabled = true;
        button.classList.add("is-loading");
        button.textContent = usePhotos ? "Sending your photos…" : "Sending…";
      }

      var fail = function (msg) {
        if (button) {
          button.disabled = false;
          button.classList.remove("is-loading");
          button.innerHTML = label;
        }
        errorEl.textContent = msg ||
          "Something went wrong sending that. Try once more — or DM me on Instagram and I’ll take it manually.";
        errorEl.hidden = false;
      };

      try {
        var body = usePhotos ? await buildPayload(form) : new FormData(form);
        var res = await fetch(endpoint, { method: "POST", body: body });
        var data = await res.json().catch(function () { return {}; });

        if (!res.ok) {
          if (data.error === "full") {
            // Someone claimed the last spot while she was filling this in.
            remaining = 0;
            paintCounts();
            startWaitlist();
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          fail(data.message);
          return;
        }

        if (typeof data.remaining === "number") {
          remaining = data.remaining;
          paintCounts();
        }
        onDone();
      } catch (e) {
        fail();
      }
    });
  }

  /* ---------- The wizard ---------- */
  var started = {};

  function startWizard() {
    if (started.wizard) { show("wizard"); return; }
    started.wizard = true;

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

    wire(form, "/api/submit", function () {
      show("confirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, true);

    show("wizard");
    render();
  }

  function startWaitlist() {
    if (started.waitlist) { show("waitlist"); return; }
    started.waitlist = true;

    wire($("#waitlist-form"), "/api/waitlist", function () {
      show("waitlistConfirm");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, false);
    show("waitlist");
  }

  /* ---------- Boot ----------
     Render from the config default immediately, then correct it against the
     live count so the page is never blank while the request is in flight. */
  paintCounts();
  if (remaining === 0) startWaitlist(); else startWizard();

  fetch("/api/status")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (!s) return;
      total = s.total;
      remaining = s.remaining;
      paintCounts();
      // Swap panels only if the live count disagrees with what we opened on,
      // and never once she has already submitted.
      var onConfirm = panels.confirm && !panels.confirm.hidden;
      var onWaitlistConfirm = panels.waitlistConfirm && !panels.waitlistConfirm.hidden;
      if (onConfirm || onWaitlistConfirm) return;

      var showingWizard = panels.wizard && !panels.wizard.hidden;
      if (s.full && showingWizard) startWaitlist();
      else if (!s.full && !showingWizard) startWizard();
    })
    .catch(function () { /* offline or previewing the file directly — keep the default */ });
})();
