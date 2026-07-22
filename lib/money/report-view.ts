import { CATEGORIES } from "@/lib/db/enums";
import { accountStatus } from "./compute";
import type { Category, Status } from "./types";

/**
 * The Reports page filters accounts by bill type. Filtering is a SUBSET SUM:
 * every account money field in `computeAccount` is a plain reduce over that
 * account's invoices, so bucketing bills by category and adding up the selected
 * buckets is exactly equivalent to recomputing from scratch.
 *
 * `status` is the one non-additive field exposed here — it is re-derived via
 * `accountStatus` from the filtered bills. `hasNegative` (compute.ts) is also
 * non-additive (a `.some()` over invoices, not a sum) but is deliberately NOT
 * part of `ReportMetrics` / exposed by this module — only `lib/dal/portfolio.ts`
 * and `lib/dal/accounts.ts` consume it. Don't assume every field but `status`
 * sums here.
 *
 * This module is deliberately PURE (no `server-only`): the client component uses
 * it for instant filtering and the export route uses it to build the workbook, so
 * the download can never disagree with the screen.
 */

/** The three bill types, straight from the DB enum — never re-declared. */
export const REPORT_CATEGORIES = CATEGORIES;
export type ReportCategory = Category;

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};

/**
 * "Old students · 1st sem" style label for an invoice stream. Takes plain
 * strings because DAL row types carry category/semester untyped; unknown
 * categories fall back to the raw value.
 */
export function streamLabel(category: string, semester: string): string {
  const base = CATEGORY_LABEL[category as ReportCategory] ?? category;
  return semester === "none" ? base : `${base} · ${semester === "1" ? "Odd" : "Even"} sem`;
}

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
  // Guard on the canonical (deduped) selection, not the raw input — otherwise a
  // repeated type would slip past the check and empty the selection.
  if (on && canonical(selected).length === 1) return canonical(selected); // last one — no-op
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

export type SortDir = "asc" | "desc";
/** Sortable ViewRow fields. `id` is excluded — it is a tie-break, not a column. */
export type SortKey = keyof ReportMetrics | "name" | "oem" | "status";

export interface ReportSort {
  key: SortKey;
  dir: SortDir;
}

/** Biggest billed first — the report's long-standing default. */
export const DEFAULT_SORT: ReportSort = { key: "billed", dir: "desc" };

const STRING_KEYS = new Set<SortKey>(["name", "oem", "status"]);
const SORT_KEYS = new Set<string>([...METRIC_KEYS, "name", "oem", "status"]);

/** Parse `?sort=&dir=`. Unknown key → the default sort; unknown dir → default dir. */
export function parseSort(key: string | null, dir: string | null): ReportSort {
  if (!key || !SORT_KEYS.has(key)) return DEFAULT_SORT;
  const d: SortDir = dir === "asc" || dir === "desc" ? dir : DEFAULT_SORT.dir;
  return { key: key as SortKey, dir: d };
}

export function sortRows(rows: ViewRow[], sort: ReportSort): ViewRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const cmp = STRING_KEYS.has(sort.key)
      // Collator PINNED to "en", not the ambient locale: the screen sorts in the
      // browser and the export sorts in Node, and an unpinned collator can order
      // the two differently ("IBM" vs "Yale" flips under lt-LT). Unlike the byOem
      // tie-break below, code-unit order is not an option here — it would put
      // "UOW" before "amity", which is not what a user means by A–Z.
      ? String(a[sort.key]).localeCompare(String(b[sort.key]), "en")
      : (a[sort.key] as number) - (b[sort.key] as number);
    // Tie-break always id-ascending, never sign-flipped: the accounts query has no
    // ORDER BY and the screen and export are independent requests, so ties must
    // resolve identically in both.
    return cmp !== 0 ? sign * cmp : a.id - b.id;
  });
}

export function selectReport(
  data: ReportData,
  selected: readonly ReportCategory[],
  sort: ReportSort = DEFAULT_SORT,
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

    // Aging mirrors, verbatim, the status-based bucketing the DAL used to do —
    // including the fact that nothing ever lands in d61_90. A real date-based
    // fix is out of scope — see the spec's follow-ups.
    for (const b of bills) {
      if (b.outstanding <= 1) continue;
      if (b.status === "overdue") aging.d90plus += b.outstanding;
      else if (b.status === "partially-paid") aging.d31_60 += b.outstanding;
      else aging.current += b.outstanding;
    }

    return { id: r.id, name: r.name, oem: r.oem, ...m, status: accountStatus(bills) };
  });

  // Sorting lives here, not in the DAL or the table: a raw row has no single
  // `billed`, only per-type buckets — and the screen and the export must agree on
  // order, so one definition serves both.
  const sorted = sortRows(rows, sort);
  // Deliberately code-unit order, NOT `localeCompare`: the screen sorts in the
  // browser's locale and the export sorts in Node, and a collator can order the
  // two differently (`"IBM".localeCompare("Yale")` flips sign under lt-LT). ICU
  // also calls distinct names equal when they differ only by an ignorable
  // character, and a 0 here would fall back to unordered DB row order. Code-unit
  // order is total and identical in both runtimes — worth more than collation
  // niceness for a tie-break that only fires on equal netMargin.
  const byOem = [...oemAgg.values()].sort(
    (x, y) => y.netMargin - x.netMargin || (x.oem < y.oem ? -1 : x.oem > y.oem ? 1 : 0),
  );
  return { rows: sorted, byOem, aging, totals };
}
