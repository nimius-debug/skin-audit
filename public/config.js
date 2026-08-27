/* ============================================================
   Fallback values, used only until the live count loads.

   Spots remaining is now COMPUTED from the database — it counts
   this week's real submissions and decrements itself. Laura never
   edits a number, and it resets on its own every Monday.

   To change the weekly cap, set SPOTS_PER_WEEK in wrangler.toml
   (and keep spotsTotal below in sync so the first paint matches).
   ============================================================ */
window.AUDIT_CONFIG = {

  // Weekly cap. Mirrors SPOTS_PER_WEEK in wrangler.toml.
  spotsTotal: 5,

  // What the page shows for the split second before /api/status answers.
  // Start optimistic — the live number corrects it immediately.
  spotsRemaining: 5,

  // Photo handling. Photos are resized in the browser before upload:
  // ~1600px keeps more detail than Instagram DMs preserve, at a
  // fraction of the bytes.
  maxPhotoDimension: 1600,
  photoQuality: 0.85,

  // Countdown shown in the urgency block.
  // Audits go out Friday, so submissions close Thursday night.
  // 0 = Sunday ... 4 = Thursday. Set showCountdown:false to hide it.
  showCountdown: true,
  cutoffWeekday: 4,
  cutoffHour: 23,
  cutoffMinute: 59
};
