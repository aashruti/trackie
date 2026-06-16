import type { Status } from "./types";

/** Full rupee formatting: en-IN grouping, real minus sign, rounded. */
export function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0;
  const abs = Math.abs(Math.round(v));
  return `${neg ? "−" : ""}₹${new Intl.NumberFormat("en-IN").format(abs)}`;
}

/** Compact rupee formatting: Cr / L / K for dense dashboards. */
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0;
  const abs = Math.abs(v);
  // Round to `d` decimals then drop trailing zeros: 4.50 → 4.5, 4.12 → 4.12.
  const trim = (n: number, d: number) => parseFloat(n.toFixed(d)).toString();
  let out: string;
  if (abs >= 1e7) out = trim(abs / 1e7, abs >= 1e8 ? 0 : 2) + "Cr";
  else if (abs >= 1e5) out = trim(abs / 1e5, abs >= 1e6 ? 0 : 1) + "L";
  else if (abs >= 1e3) out = trim(abs / 1e3, 0) + "K";
  else out = String(Math.round(abs));
  return `${neg ? "−" : ""}₹${out}`;
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
