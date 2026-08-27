/* The Free Mom Skin Audit — index page behavior.
   The form itself lives on its own page (form.html / form.js).
   Everything tunable lives in config.js. */
(function () {
  "use strict";

  var CFG = Object.assign({
    spotsTotal: 5,
    spotsRemaining: 5,
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

  /* ---------- 2. When the week is full, every CTA becomes a waitlist CTA ---------- */
  /* The link always opens form.html — that page decides for itself whether to
     show the audit form or the waitlist, based on the same config. */
  if (isFull) {
    $$("a[data-cta]").forEach(function (a) {
      var arrow = a.querySelector("span[aria-hidden]");
      a.textContent = "Join the Waitlist ";
      if (arrow) a.appendChild(arrow);
      else a.insertAdjacentHTML("beforeend", '<span aria-hidden="true">→</span>');
    });
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

  /* ---------- 4. Sticky mobile CTA, once the hero is out of view ---------- */
  var sticky = $("[data-stickybar]");
  var hero = $(".hero");
  if (sticky && hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      sticky.hidden = entries[0].isIntersecting;
    }, { rootMargin: "-80px 0px 0px 0px" }).observe(hero);
  }
})();
