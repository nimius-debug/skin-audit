/* The Free Mom Skin Audit — index page behavior.
   The form itself lives on its own page (form.html / form.js).
   Spot counts come from the Worker (/api/status), set from /admin —
   there's no fixed schedule here, so everything is data-driven. */
(function () {
  "use strict";

  var CFG = Object.assign({
    spotsTotal: 5,
    spotsRemaining: 5
  }, window.AUDIT_CONFIG || {});

  var total = Math.max(0, Number(CFG.spotsTotal) || 0);
  var remaining = Math.min(total, Math.max(0, Number(CFG.spotsRemaining) || 0));
  var isFull = remaining === 0;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ---------- 1. Spot counts ---------- */
  function paint() {
    isFull = remaining === 0;

    $$("[data-spots-total]").forEach(function (el) { el.textContent = total; });
    $$("[data-spots-remaining]").forEach(function (el) { el.textContent = remaining; });

    var pips = $("[data-spot-pips]");
    if (pips) {
      pips.innerHTML = "";
      for (var i = 0; i < total; i++) {
        var li = document.createElement("li");
        li.className = "pip" + (i < remaining ? " pip--open" : " pip--taken");
        pips.appendChild(li);
      }
    }

    /* When the round is full, every CTA becomes a waitlist CTA. The link
       always opens form.html — that page decides which panel to show. */
    if (isFull) {
      $$("a[data-cta]").forEach(function (a) {
        if (a.dataset.swapped) return;
        a.dataset.swapped = "1";
        var arrow = a.querySelector("span[aria-hidden]");
        a.textContent = "Join the Waitlist ";
        if (arrow) a.appendChild(arrow);
        else a.insertAdjacentHTML("beforeend", '<span aria-hidden="true">→</span>');
      });
      var stickyCount = $("[data-stickybar] p");
      if (stickyCount) stickyCount.innerHTML = "<strong>Full for now.</strong> Join the waitlist for the next round.";
      var announce = $(".announce__inner span:last-child");
      if (announce) announce.textContent = "Full for now — waitlist open";
    }
  }

  paint();

  /* Correct the static default against the live count from the Worker. */
  fetch("/api/status")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (!s) return;
      total = s.total;
      remaining = s.remaining;
      paint();
    })
    .catch(function () { /* previewing the file directly — keep the default */ });

  /* ---------- 2. Sticky mobile CTA, once the hero is out of view ---------- */
  var sticky = $("[data-stickybar]");
  var hero = $(".hero");
  if (sticky && hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      sticky.hidden = entries[0].isIntersecting;
    }, { rootMargin: "-80px 0px 0px 0px" }).observe(hero);
  }
})();
