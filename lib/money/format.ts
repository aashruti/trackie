import type { Status } from "./types";

/** Full rupee formatting: en-IN grouping, real minus sign, whole rupees. */
export function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0;
  const abs = Math.abs(Math.round(v));
  return `${neg ? "−" : ""}₹${new Intl.NumberFormat("en-IN").format(abs)}`;
}

/**
 * Exact rupee formatting: en-IN grouping, real minus sign, no rounding.
 * Paise are shown only when non-zero. For the few places that label a value
 * they cannot print in full, such as chart segments.
 */
export function fmtExact(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0;
  const abs = Math.abs(v);
  const hasPaise = Math.round(abs * 100) % 100 !== 0;
  const body = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(abs);
  return `${neg ? "−" : ""}₹${body}`;
}

const STATUS: Record<Status, [string, string]> = {
  draft: ["neutral", "Draft"],
  raised: ["info", "Raised"],
  "partially-paid": ["pending", "Partially Paid"],
  paid: ["positive", "Paid"],
  overdue: ["negative", "Overdue"],
};

/** Maps a status to a [tone, label] pair for badge rendering. */
export function statusMeta(s: Status): [string, string] {
  return STATUS[s] ?? STATUS.draft;
}
