/* ============================================================
   THE ONLY FILE LAURA NEEDS TO EDIT WEEK TO WEEK.
   Change a number, save, refresh. Nothing else to touch.
   ============================================================ */
window.AUDIT_CONFIG = {

  // How many spots you open each week.
  spotsTotal: 5,

  // How many are still open RIGHT NOW.
  // Set this to 0 and the form is automatically replaced
  // by the waitlist section. Set it back above 0 on Monday.
  spotsRemaining: 5,

  // Where completed forms go.
  // Leave "" while you're testing — submissions are held in the
  // browser and the confirmation still shows, so you can click
  // through the whole page. Paste a Formspree / Basin / Getform
  // endpoint here when you're ready to take real submissions.
  formEndpoint: "",
  waitlistEndpoint: "",

  // Countdown shown in the urgency block.
  // Audits go out Friday, so submissions close Thursday night.
  // 0 = Sunday ... 4 = Thursday. Set showCountdown:false to hide it.
  showCountdown: true,
  cutoffWeekday: 4,
  cutoffHour: 23,
  cutoffMinute: 59
};
