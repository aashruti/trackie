import { accountStatus } from "./compute";
import type { Status } from "./types";

/**
 * The Reports page filters accounts by bill type. Filtering is a SUBSET SUM:
 * every account-level money field in `computeAccount` is a plain reduce over the
 * account's invoices (compute.ts:120), so bucketing bills by category and adding
 * up the selected buckets is exactly equivalent to recomputing from scratch.
 *
 * `status` is the one field that does not sum — it is re-derived here via
 * `accountStatus` from the filtered bills.
 *
 * This module is deliberately PURE (no `server-only`): the client component uses
 * it for instant filtering and the export route uses it to build the workbook, so
 * the download can never disagree with the screen.
 */

export const REPORT_CATEGORIES = ["advance", "old", "new"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};

/** Every field here is Σ over bills — that is what makes subset filtering valid. */
export interface ReportMetrics {
  students: number;
  billed: number;
  received: number;
  outstanding: number;
  payable: number;
  paidToOem: number;
  outstandingToOem: number;
  netMargin: number;
  netGst: number;
  tdsReceivable: number;
  tdsPayable: number;
  advanceTdsCost: number;
}

/** The minimum per-bill facts needed to re-derive status AND aging on a subset. */
export interface BillLite {
  category: ReportCategory;
  status: Status;
  outstanding: number;
  received: number;
}

export interface ReportRow {
  id: number;
  name: string;
  oem: string;
  byCategory: Record<ReportCategory, ReportMetrics>;
  bills: BillLite[];
}

export interface ReportData {
  rows: ReportRow[];
}

export type ViewRow = { id: number; name: string; oem: string } & ReportMetrics & {
  status: Status;
};

export interface Aging {
  current: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface OemRollup {
  oem: string;
  billed: number;
  netMargin: number;
  payable: number;
}

export interface ReportView {
  rows: ViewRow[];
  byOem: OemRollup[];
  aging: Aging;
  totals: ReportMetrics;
}

export function emptyMetrics(): ReportMetrics {
  return {
    students: 0, billed: 0, received: 0, outstanding: 0, payable: 0,
    paidToOem: 0, outstandingToOem: 0, netMargin: 0, netGst: 0,
    tdsReceivable: 0, tdsPayable: 0, advanceTdsCost: 0,
  };
}

export function emptyByCategory(): Record<ReportCategory, ReportMetrics> {
  return { advance: emptyMetrics(), old: emptyMetrics(), new: emptyMetrics() };
}

const METRIC_KEYS = Object.keys(emptyMetrics()) as (keyof ReportMetrics)[];

function addInto(target: ReportMetrics, src: ReportMetrics): void {
  for (const k of METRIC_KEYS) target[k] += src[k];
}

/** Selection in canonical (REPORT_CATEGORIES) order, whatever order it came in. */
function canonical(selected: readonly ReportCategory[]): ReportCategory[] {
  return REPORT_CATEGORIES.filter((c) => selected.includes(c));
}

/** Toggle a type, keeping at least one selected so the report is never empty. */
export function toggleCategory(
  selected: readonly ReportCategory[],
  cat: ReportCategory,
): ReportCategory[] {
  const on = selected.includes(cat);
  if (on && selected.length === 1) return canonical(selected); // last one — no-op
  return canonical(on ? selected.filter((c) => c !== cat) : [...selected, cat]);
}

/** Human labels for a selection, e.g. "Advance bill, New students". */
export function categoryLabels(selected: readonly ReportCategory[]): string {
  return canonical(selected).map((c) => CATEGORY_LABEL[c]).join(", ");
}

/** Filename-safe slug for a selection: "all" | "advance+new". */
export function categorySlug(selected: readonly ReportCategory[]): string {
  const inOrder = canonical(selected);
  return inOrder.length === REPORT_CATEGORIES.length ? "all" : inOrder.join("+");
}

/** Parse a `?types=` param. Unknown values dropped; nothing valid → all types. */
export function parseCategories(raw: string | null): ReportCategory[] {
  if (!raw) return [...REPORT_CATEGORIES];
  const wanted = new Set(raw.split(",").map((s) => s.trim()));
  const hit = REPORT_CATEGORIES.filter((c) => wanted.has(c));
  return hit.length ? hit : [...REPORT_CATEGORIES];
}

export function selectReport(
  data: ReportData,
  selected: readonly ReportCategory[],
): ReportView {
  const picked = canonical(selected);
  const totals = emptyMetrics();
  const aging: Aging = { current: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  const oemAgg = new Map<string, OemRollup>();

  const rows: ViewRow[] = data.rows.map((r) => {
    const m = emptyMetrics();
    for (const c of picked) addInto(m, r.byCategory[c]);
    addInto(totals, m);

    const bills = r.bills.filter((b) => picked.includes(b.category));

    const agg = oemAgg.get(r.oem) ?? { oem: r.oem, billed: 0, netMargin: 0, payable: 0 };
    agg.billed += m.billed;
    agg.netMargin += m.netMargin;
    agg.payable += m.payable;
    oemAgg.set(r.oem, agg);

    // Aging: preserves the existing status-based mapping from reports.ts:126-131
    // verbatim, including the fact that nothing ever lands in d61_90. A real
    // date-based fix is out of scope — see the spec's follow-ups.
    for (const b of bills) {
      if (b.outstanding <= 1) continue;
      if (b.status === "overdue") aging.d90plus += b.outstanding;
      else if (b.status === "partially-paid") aging.d31_60 += b.outstanding;
      else aging.current += b.outstanding;
    }

    return { id: r.id, name: r.name, oem: r.oem, ...m, status: accountStatus(bills) };
  });

  // Sorting lives here, not in the DAL: a raw row has no single `billed`, only
  // per-type buckets — so row order responds to the filter.
  rows.sort((x, y) => y.billed - x.billed);
  const byOem = [...oemAgg.values()].sort((x, y) => y.netMargin - x.netMargin);
  return { rows, byOem, aging, totals };
}
