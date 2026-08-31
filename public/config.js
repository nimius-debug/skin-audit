/* ============================================================
   Fallback values, used only until the live count loads.

   Spots (total, remaining, open/closed) are set from /admin and stored
   in D1 — not on a calendar schedule. Nothing here resets automatically;
   a round stays open until Laura closes it from the dashboard.
   ============================================================ */
window.AUDIT_CONFIG = {

  // What the page shows for the split second before /api/status answers.
  // Start optimistic — the live numbers correct it immediately.
  spotsTotal: 5,
  spotsRemaining: 5,

  // Photo handling. Photos are resized in the browser before upload:
  // ~1600px keeps more detail than Instagram DMs preserve, at a
  // fraction of the bytes.
  maxPhotoDimension: 1600,
  photoQuality: 0.85
};
