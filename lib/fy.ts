// Shared financial-year / batch-label helpers. Client-safe — no "server-only"
// import, so DAL code and client components may both use these.
//
// Canonical label form everywhere: "FY26–27" — "FY" prefix, two-digit years,
// EN-DASH (–, U+2013). This matches academic_years.label exactly; a batch is
// named by the year label of its intake year.

/** Academic-year start, e.g. "FY26–27" → 2026, "2024-25" → 2024. */
export function batchStartYear(label: string): number | null {
  const m = label.match(/(\d{4})|(?:FY)?(\d{2})\D/);
  if (m?.[1]) return parseInt(m[1], 10);
  if (m?.[2]) return 2000 + parseInt(m[2], 10);
  return null;
}

/** Next FY label, e.g. "FY26–27" → "FY27–28". Unparseable input gets " (next)". */
export function nextFyLabel(label: string): string {
  const m = label.match(/(\d{2})\D+(\d{2})/);
  if (!m) return label + " (next)";
  const a = (parseInt(m[1], 10) + 1) % 100;
  const b = (parseInt(m[2], 10) + 1) % 100;
  return `FY${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
}

/** Previous FY label, e.g. "FY26–27" → "FY25–26". Unparseable input gets " (prev)". */
export function prevFyLabel(label: string): string {
  const m = label.match(/(\d{2})\D+(\d{2})/);
  if (!m) return label + " (prev)";
  const a = (parseInt(m[1], 10) + 99) % 100;
  const b = (parseInt(m[2], 10) + 99) % 100;
  return `FY${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
}

/**
 * Normalize a batch label to canonical FY form:
 *   "2024-25" | "24-25" | "FY24-25" | "FY 24-25" | "fy24–25"  →  "FY24–25"
 * Anything unrecognized is returned unchanged (trimmed) — free-text labels stay.
 */
export function normalizeBatchLabel(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^(?:FY\s?)?(\d{2}|\d{4})[-–—](\d{2})$/i);
  if (!m) return s;
  const start = m[1].length === 4 ? m[1].slice(2) : m[1];
  return `FY${start}–${m[2]}`;
}

/** Ordinal year of study for an enrollment batch in the current year, e.g. "3rd year". */
export function yearOfStudy(enrollmentYear: string, currentYear: string): string | null {
  const enroll = batchStartYear(enrollmentYear);
  const cur = batchStartYear(currentYear);
  if (enroll == null || cur == null) return null;
  const n = cur - enroll + 1;
  if (n < 1) return null;
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][n] ?? `${n}th`;
  return `${ord} year`;
}
