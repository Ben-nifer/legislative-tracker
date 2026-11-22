// Source statuses that mean a proposal is finished — used to power the
// "Pending only" filter. Based on the actual status values present in
// local_proposals (ZAP for ULURP, Street & Highway Capital Reconstruction
// for DOT) — not guessed.
export const COMPLETED_STATUSES = [
  'Completed',
  'Completed Project',
  'Substantial Completion',
  'Final Completion',
]

// Postgrest `not.in(...)` value list, e.g. ("Completed","Completed Project").
export const COMPLETED_STATUSES_FILTER = `(${COMPLETED_STATUSES.map((s) => `"${s}"`).join(',')})`
