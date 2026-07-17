# Reports Bill-Type Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users tick any combination of the three bill types (Advance bill / Old students / New students) on the Reports page, see every tab recompute instantly, and download the filtered report as a formatted XLSX.

**Architecture:** A new pure module `lib/money/report-view.ts` owns a `selectReport(data, types)` selector. The DAL stops emitting flat per-account totals and instead emits per-type buckets; the client sums the ticked buckets for instant filtering, and a new backend export route calls the *same* selector to build the workbook — so the download can never disagree with the screen. No migration; the money engine (`lib/money/compute.ts`) is not modified.

**Tech Stack:** Next.js App Router (Server Components + route handlers), TypeScript, Drizzle, Vitest, `xlsx` (already a dependency), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-17-reports-bill-type-filter-design.md`

---

## Background an engineer needs before starting

**Why filtering by subset is even valid.** In `lib/money/compute.ts:120-134`, `computeAccount` builds every account-level money field with `sum(k)` — a plain reduce over that account's invoices. `billing`, `received`, `outstanding`, `payable`, `paidToOem`, `outstandingToOem`, `netMargin`, `gstDiff`, `tdsIn`, `tdsOut`, `advanceTdsCost` are all pure sums. So "filter to advance + new" is arithmetically just "add up a subset of the bills". This is the load-bearing fact behind the whole design.

`status` is the sole exception — `accountStatus` (`compute.ts:101`) applies precedence rules (any overdue → overdue; else outstanding ≤ ₹1 → paid; else any received → partially-paid; else raised). It cannot be summed, so it is **re-derived** from the filtered subset of bills.

**Field-name mapping.** The report's names differ from the engine's. When bucketing, map:

| Report metric | Engine field on a computed invoice |
| --- | --- |
| `billed` | `billing` |
| `netGst` | `gstDiff` |
| `tdsReceivable` | `tdsIn` |
| `tdsPayable` | `tdsOut` |
| `students` | `students`, but **0 for advances** |

`received`, `outstanding`, `payable`, `paidToOem`, `outstandingToOem`, `netMargin`, `advanceTdsCost` keep their names.

**Advances carry no student count.** `lib/dal/reports.ts:104` already excludes advances from student totals. Preserve this: an advance is a token payment, not a headcount. Consequence: an advance-only view shows Students = 0. That is correct.

**Test setup.** Vitest. `npm test` runs everything. `vitest.config.ts` aliases `server-only` to an empty module so DAL files import cleanly, and sets `fileParallelism: false` because the DAL tests share one **real local Postgres** with seeded data. Pure tests (`lib/money/*.test.ts`) need no DB; `lib/dal/reports.test.ts` does — it queries the seeded year `"FY26–27"` (note: **en-dash**, not a hyphen).

---

## File Structure

**Create:**
- `lib/money/report-view.ts` — pure. Types, the `selectReport` selector, and the small pure helpers (`toggleCategory`, `parseCategories`, `categorySlug`, `categoryLabels`). Deliberately free of `server-only` so the client component and the route handler can both import it.
- `lib/money/report-view.test.ts` — pure unit tests. Where most of the value lives.
- `components/reports/type-filter.tsx` — the three chips. Presentational; the toggle rule lives in `report-view.ts` where it can be tested.
- `app/(app)/reports/export/route.ts` — backend XLSX export.

**Modify:**
- `lib/dal/reports.ts` — emit per-type buckets; drop `byOem`/`aging`/`totals`/sorting.
- `lib/dal/reports.test.ts:9-22` — update to the new shape.
- `components/reports/reports-tabs.tsx` — filter state, `selectReport`, download link.
- `components/reports/report-table.tsx:14-52` — strip the client CSV.

**Needs no change (but verify):** `app/(app)/reports/page.tsx`. It reads `data.rows.length` for the "N accounts · YEAR" line — still valid, and the account count is filter-independent so it belongs on the server. It passes `data` straight to `<ReportsTabs>`; the type is structurally identical, just imported from a new module. `npx tsc --noEmit` in Task 2 is the check.

**Not touched:** `lib/money/compute.ts`, `lib/money/types.ts`, the OEM drill-down (`app/(app)/reports/oem/[oem]/page.tsx`, `lib/dal/oem-report.ts`, `components/reports/oem-csv-button.tsx`), `components/reports/print-button.tsx`.

---

### Task 1: The pure selector module

This is the foundation. It is purely additive — nothing else imports it yet, so the build stays green throughout.

**Files:**
- Create: `lib/money/report-view.ts`
- Test: `lib/money/report-view.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/money/report-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  REPORT_CATEGORIES,
  categorySlug,
  emptyByCategory,
  emptyMetrics,
  parseCategories,
  selectReport,
  toggleCategory,
  type ReportMetrics,
  type ReportRow,
} from "./report-view";

const metrics = (p: Partial<ReportMetrics>): ReportMetrics => ({ ...emptyMetrics(), ...p });

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 1,
  name: "Pillai",
  oem: "IBM",
  byCategory: emptyByCategory(),
  bills: [],
  ...over,
});

describe("selectReport", () => {
  it("sums only the selected bill types", () => {
    const r = row({
      byCategory: {
        advance: metrics({ billed: 100, netMargin: -10 }),
        old: metrics({ billed: 200, netMargin: 20, students: 5 }),
        new: metrics({ billed: 400, netMargin: 40, students: 9 }),
      },
    });
    const v = selectReport({ rows: [r] }, ["advance", "new"]);
    expect(v.totals.billed).toBe(500);
    expect(v.totals.netMargin).toBe(30);
    expect(v.totals.students).toBe(9); // `old` excluded
  });

  it("the three slices sum back to the unfiltered total", () => {
    const data = {
      rows: [
        row({
          byCategory: {
            advance: metrics({ billed: 100, netMargin: -10 }),
            old: metrics({ billed: 200, netMargin: 20 }),
            new: metrics({ billed: 400, netMargin: 40 }),
          },
        }),
      ],
    };
    const all = selectReport(data, [...REPORT_CATEGORIES]);
    const sum = REPORT_CATEGORIES.reduce(
      (a, c) => a + selectReport(data, [c]).totals.netMargin,
      0,
    );
    expect(sum).toBe(all.totals.netMargin);
  });

  it("re-derives account status from the filtered bills only", () => {
    const r = row({
      bills: [
        { category: "new", status: "paid", outstanding: 0, received: 500 },
        { category: "advance", status: "overdue", outstanding: 100, received: 0 },
      ],
    });
    expect(selectReport({ rows: [r] }, [...REPORT_CATEGORIES]).rows[0].status).toBe("overdue");
    expect(selectReport({ rows: [r] }, ["new"]).rows[0].status).toBe("paid");
  });

  it("marks an account with no bills of the selected type as draft", () => {
    const r = row({ bills: [{ category: "new", status: "paid", outstanding: 0, received: 5 }] });
    expect(selectReport({ rows: [r] }, ["advance"]).rows[0].status).toBe("draft");
  });

  it("buckets aging from the filtered bills only", () => {
    const r = row({
      bills: [
        { category: "advance", status: "overdue", outstanding: 900, received: 0 },
        { category: "new", status: "partially-paid", outstanding: 500, received: 10 },
        { category: "old", status: "raised", outstanding: 300, received: 0 },
      ],
    });
    expect(selectReport({ rows: [r] }, [...REPORT_CATEGORIES]).aging).toEqual({
      current: 300,
      d31_60: 500,
      d61_90: 0,
      d90plus: 900,
    });
    expect(selectReport({ rows: [r] }, ["new"]).aging).toEqual({
      current: 0,
      d31_60: 500,
      d61_90: 0,
      d90plus: 0,
    });
  });

  it("ignores bills outstanding by ≤ ₹1 when aging", () => {
    const r = row({ bills: [{ category: "new", status: "raised", outstanding: 1, received: 0 }] });
    expect(selectReport({ rows: [r] }, ["new"]).aging.current).toBe(0);
  });

  it("regroups by OEM on the filtered numbers, sorted by net margin desc", () => {
    const a = row({
      id: 1,
      name: "A",
      oem: "IBM",
      byCategory: { ...emptyByCategory(), new: metrics({ billed: 10, netMargin: 5 }) },
    });
    const b = row({
      id: 2,
      name: "B",
      oem: "AAFM",
      byCategory: { ...emptyByCategory(), new: metrics({ billed: 20, netMargin: 50 }) },
    });
    const v = selectReport({ rows: [a, b] }, ["new"]);
    expect(v.byOem.map((o) => o.oem)).toEqual(["AAFM", "IBM"]);
    expect(v.byOem[0].netMargin).toBe(50);
  });

  it("sorts rows by filtered billed, so order responds to the filter", () => {
    const a = row({
      id: 1,
      name: "A",
      byCategory: { advance: metrics({ billed: 900 }), old: emptyMetrics(), new: metrics({ billed: 1 }) },
    });
    const b = row({
      id: 2,
      name: "B",
      byCategory: { advance: metrics({ billed: 1 }), old: emptyMetrics(), new: metrics({ billed: 900 }) },
    });
    expect(selectReport({ rows: [a, b] }, ["advance"]).rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(selectReport({ rows: [a, b] }, ["new"]).rows.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

describe("toggleCategory", () => {
  it("adds and removes, keeping canonical order", () => {
    expect(toggleCategory(["advance"], "new")).toEqual(["advance", "new"]);
    expect(toggleCategory(["advance", "old", "new"], "old")).toEqual(["advance", "new"]);
  });

  it("refuses to unselect the last remaining type", () => {
    expect(toggleCategory(["new"], "new")).toEqual(["new"]);
  });
});

describe("parseCategories", () => {
  it("defaults to all types", () => {
    expect(parseCategories(null)).toEqual(["advance", "old", "new"]);
    expect(parseCategories("")).toEqual(["advance", "old", "new"]);
  });

  it("drops unknown values and dedupes, keeping canonical order", () => {
    expect(parseCategories("new,bogus,advance,new")).toEqual(["advance", "new"]);
  });

  it("falls back to all when nothing valid remains", () => {
    expect(parseCategories("bogus")).toEqual(["advance", "old", "new"]);
  });
});

describe("categorySlug", () => {
  it("collapses a full selection to 'all'", () => {
    expect(categorySlug(["advance", "old", "new"])).toBe("all");
  });

  it("joins a partial selection in canonical order", () => {
    expect(categorySlug(["new", "advance"])).toBe("advance+new");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/money/report-view.test.ts`
Expected: FAIL — `Failed to resolve import "./report-view"`.

- [ ] **Step 3: Write the implementation**

Create `lib/money/report-view.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/money/report-view.test.ts`
Expected: PASS — 15 tests (8 `selectReport`, 2 `toggleCategory`, 3 `parseCategories`, 2 `categorySlug`).

- [ ] **Step 5: Commit**

```bash
git add lib/money/report-view.ts lib/money/report-view.test.ts
git commit -m "feat(reports): pure bill-type selector for report filtering

Every account money field in computeAccount is a sum over its bills, so
filtering by bill type is a subset sum. selectReport buckets accordingly
and re-derives status (the one non-additive field) from the filtered set.

Pure by design: the client filters with it and the export route will build
its workbook with it, so the download cannot disagree with the screen."
```

---

### Task 2: Reshape the DAL to emit per-type buckets

A pure refactor: after this task the app renders **exactly** as before, but on the new plumbing. `reports-tabs.tsx` is adapted minimally (it selects all three types) so the build stays green; the actual filter UI arrives in Task 4.

**Files:**
- Modify: `lib/dal/reports.ts` (whole file)
- Modify: `lib/dal/reports.test.ts`
- Modify: `components/reports/reports-tabs.tsx` (minimal adaptation only)

- [ ] **Step 1: Write the failing test**

Replace `lib/dal/reports.test.ts` entirely:

```ts
import { describe, it, expect } from "vitest";
import { getReportData } from "./reports";
import { getPortfolioForUser } from "./portfolio";
import { REPORT_CATEGORIES, selectReport } from "@/lib/money/report-view";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

describe("getReportData", () => {
  it("per-account rows aggregate to the same totals as the portfolio", async () => {
    const data = await getReportData(SUPER, YEAR);
    const r = selectReport(data, REPORT_CATEGORIES);
    const p = await getPortfolioForUser(SUPER, YEAR);

    expect(r.rows.length).toBe(p.counts.accounts);
    expect(Math.round(r.totals.netMargin)).toBe(Math.round(p.totals.netMargin));
    expect(Math.round(r.totals.billed)).toBe(Math.round(p.totals.billed));
    expect(Math.round(r.totals.outstanding)).toBe(Math.round(p.totals.outstanding));
    expect(r.byOem.some((o) => o.oem === "IBM")).toBe(true);
    // Reserves present.
    expect(r.totals.netGst).toBeGreaterThan(0);
    expect(r.totals.tdsReceivable).toBeGreaterThan(0);
  });

  it("the three bill-type slices sum back to the unfiltered totals", async () => {
    const data = await getReportData(SUPER, YEAR);
    const all = selectReport(data, REPORT_CATEGORIES);
    const slices = REPORT_CATEGORIES.map((c) => selectReport(data, [c]));

    for (const k of ["billed", "netMargin", "outstanding", "netGst"] as const) {
      const summed = slices.reduce((a, s) => a + s.totals[k], 0);
      expect(Math.round(summed)).toBe(Math.round(all.totals[k]));
    }
  });

  it("advances carry no student count", async () => {
    const data = await getReportData(SUPER, YEAR);
    expect(selectReport(data, ["advance"]).totals.students).toBe(0);
    // Sanity: the seeded year does have students on non-advance bills.
    expect(selectReport(data, REPORT_CATEGORIES).totals.students).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dal/reports.test.ts`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'advance')`.

Why that specific error: Vitest transpiles TypeScript with esbuild, which strips types **without typechecking** — so a type mismatch alone will not fail a test. This fails at *runtime* because the old `getReportData` returns flat rows with no `byCategory`, and `selectReport` does `addInto(m, r.byCategory[c])`. If you instead see a passing suite, the test is not exercising what you think it is.

> **Requires a local Postgres** with seed data (`npm run db:seed`). If the suite errors on connection rather than shape, fix the DB first — this file is an integration test.

- [ ] **Step 3: Rewrite the DAL**

Replace `lib/dal/reports.ts` entirely:

```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus } from "@/lib/money/types";
import {
  emptyByCategory,
  type BillLite,
  type ReportCategory,
  type ReportData,
  type ReportRow,
} from "@/lib/money/report-view";
import { scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { loadPaymentLites } from "./payments";
import { loadCohortPricing } from "./cohort-pricing";

/**
 * Raw, UNFILTERED report data: per account, money bucketed by bill type.
 *
 * Totals, by-OEM rollups, aging and row order are NOT computed here — they all
 * depend on which bill types the viewer ticked, and live in `selectReport`
 * (lib/money/report-view.ts). Keeping server copies would just be a second
 * source of truth that drifts from the screen.
 */
export async function getReportData(
  user: SessionUser,
  yearLabel: string,
): Promise<ReportData> {
  const empty: ReportData = { rows: [] };

  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return empty;

  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db
    .select({ id: accounts.id, name: accounts.name, oem: oems.name, isSelf: oems.isSelf })
    .from(accounts)
    .innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  if (!accRows.length) return empty;

  const accountIds = accRows.map((a) => a.id);
  const allInvRows = await db
    .select()
    .from(invoices)
    .where(and(inArray(invoices.accountId, accountIds), eq(invoices.yearId, year.id)));

  const invsByAccount = new Map<number, typeof allInvRows>();
  for (const inv of allInvRows) {
    const list = invsByAccount.get(inv.accountId) ?? [];
    list.push(inv);
    invsByAccount.set(inv.accountId, list);
  }

  const allInvIds = allInvRows.map((r) => r.id);
  const [lites, cohortPx] = await Promise.all([
    loadPaymentLites(allInvIds),
    loadCohortPricing(allInvIds),
  ]);

  const rows: ReportRow[] = [];

  for (const a of accRows) {
    const invRows = invsByAccount.get(a.id) ?? [];
    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category, semester: r.semester, students: r.students,
      priceToUni: Number(r.priceToUni), priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate), tdsRate: Number(r.tdsRate), advanceAdj: Number(r.advanceAdj),
      status: r.status, payments: lites.get(r.id)?.receipts ?? [],
      oemPayments: lites.get(r.id)?.oemPayments ?? [], selfSupplied: a.isSelf,
      cohortPricing: cohortPx.get(r.id),
    }));

    // One computeAccount call per account, exactly as before — the engine is
    // untouched. It already returns each invoice computed and tagged with its
    // category, so bucketing is a pure JS pass over a result we already have.
    const c = computeAccount(inputs);
    const byCategory = emptyByCategory();
    const bills: BillLite[] = [];

    for (const inv of c.invoices) {
      const cat = inv.category as ReportCategory;
      const m = byCategory[cat];
      // An advance is a token payment, not a headcount (preserves the old
      // `filter(i => i.category !== "advance")` student total).
      m.students += cat === "advance" ? 0 : inv.students;
      m.billed += inv.billing;
      m.received += inv.received;
      m.outstanding += inv.outstanding;
      m.payable += inv.payable;
      m.paidToOem += inv.paidToOem;
      m.outstandingToOem += inv.outstandingToOem;
      m.netMargin += inv.netMargin;
      m.netGst += inv.gstDiff;
      m.tdsReceivable += inv.tdsIn;
      m.tdsPayable += inv.tdsOut;
      m.advanceTdsCost += inv.advanceTdsCost;

      bills.push({
        category: cat,
        status: inv.status,
        outstanding: inv.outstanding,
        received: inv.received,
      });
    }

    rows.push({ id: a.id, name: a.name, oem: a.oem, byCategory, bills });
  }

  return { rows };
}
```

- [ ] **Step 4: Adapt `reports-tabs.tsx` minimally to keep the build green**

In `components/reports/reports-tabs.tsx`, change **only** the imports and the first two lines of the component body. The filter UI comes in Task 4.

Replace the import on line 7-8:

```tsx
import { ReportTable, type Column } from "./report-table";
import type { ReportData, ReportRow } from "@/lib/dal/reports";
```

with:

```tsx
import { ReportTable, type Column } from "./report-table";
import {
  REPORT_CATEGORIES,
  selectReport,
  type ReportData,
  type ViewRow,
} from "@/lib/money/report-view";
```

Then inside the component, replace:

```tsx
  const [tab, setTab] = useState<Tab>("Margin");
  const t = data.totals;
```

with:

```tsx
  const [tab, setTab] = useState<Tab>("Margin");
  const view = selectReport(data, REPORT_CATEGORIES);
  const t = view.totals;
```

Now update every reference that used to read off `data`:
- Each `Column<ReportRow>[]` becomes `Column<ViewRow>[]` (three of them: `marginCols`, `reserveCols`, `oemSettleCols`).
- `byOemCols` becomes `Column<(typeof view.byOem)[number]>[]`.
- `data.aging.current` / `data.aging.d31_60` / `data.aging.d61_90` / `data.aging.d90plus` → `view.aging.*`.
- Every `rows={data.rows}` → `rows={view.rows}`.
- `rows={data.byOem}` → `rows={view.byOem}`.
- `data.byOem.map(...)` in the By OEM tab's link list → `view.byOem.map(...)`.

- [ ] **Step 5: Verify the whole suite and the types**

Run: `npm test`
Expected: PASS, including the three `getReportData` tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify the page still renders identically**

Start the dev server and load `/reports`. The page must look **exactly** as it did before this task — same rows, same order, same totals. This is a refactor checkpoint: no behaviour change.

- [ ] **Step 7: Commit**

```bash
git add lib/dal/reports.ts lib/dal/reports.test.ts components/reports/reports-tabs.tsx
git commit -m "refactor(reports): DAL emits per-bill-type buckets

getReportData now returns money bucketed by bill type plus the minimal
per-bill facts needed to re-derive status and aging on a subset. Totals,
by-OEM, aging and row order move to selectReport, since all four depend on
which types are ticked.

Query count unchanged; computeAccount still called once per account. No
behaviour change — the tabs select all three types."
```

---

### Task 3: The bill-type filter chips

**Files:**
- Create: `components/reports/type-filter.tsx`

The toggle rule (never unselect the last type) already lives in `toggleCategory` and is tested in Task 1, so this component stays presentational. Note `vitest.config.ts` sets `environment: "node"` with no jsdom — there is no component-test setup in this repo, which is exactly why the rule was put in the pure module.

- [ ] **Step 1: Write the component**

Create `components/reports/type-filter.tsx`:

```tsx
"use client";

import {
  CATEGORY_LABEL,
  REPORT_CATEGORIES,
  type ReportCategory,
} from "@/lib/money/report-view";

export function TypeFilter({
  selected,
  onToggle,
}: {
  selected: ReportCategory[];
  onToggle: (c: ReportCategory) => void;
}) {
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-muted">Bill types</span>
      {REPORT_CATEGORIES.map((c) => {
        const on = selected.includes(c);
        // The last selected chip is locked: an empty report is a dead end.
        const locked = on && selected.length === 1;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            aria-pressed={on}
            disabled={locked}
            title={locked ? "At least one bill type must stay selected" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? "border-[var(--primary-text)] bg-[var(--primary-subtle)] text-[var(--primary-text)]"
                : "border-border-strong text-text-secondary hover:bg-surface-hover"
            } ${locked ? "cursor-default" : ""}`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors. (The component is unused until Task 4 — that is fine.)

- [ ] **Step 3: Commit**

```bash
git add components/reports/type-filter.tsx
git commit -m "feat(reports): bill-type filter chips

Presentational only — the never-unselect-the-last rule lives in
toggleCategory where it is unit-tested."
```

---

### Task 4: Wire the filter in and strip the client CSV

**Files:**
- Modify: `components/reports/reports-tabs.tsx`
- Modify: `components/reports/report-table.tsx:14-52`

- [ ] **Step 1: Strip the CSV export from `report-table.tsx`**

Delete the `csvCell` function (lines 14-17), the `exportCsv` function (lines 34-52), the `filename` prop from both the type signature and the destructure, and the `action={...}` button on the `CardHeader`. The result:

```tsx
"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export interface Column<T> {
  key: keyof T;
  label: string;
  money?: boolean;
  tone?: "default" | "positive" | "negative" | "pending" | "info" | "auto";
  align?: "left" | "right";
}

export function ReportTable<T extends object>({
  title,
  subtitle,
  columns,
  rows,
  totals,
}: {
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  rows: T[];
  totals?: Partial<Record<keyof T, number>> & { label?: string };
}) {
  return (
    <Card className="print-card">
      <CardHeader title={title} subtitle={subtitle} />
      {/* …the rest of the file (the <table>) is unchanged… */}
```

Leave everything from `<div className="overflow-x-auto">` onward exactly as it is.

- [ ] **Step 2: Wire filter state into `reports-tabs.tsx`**

Update the imports to add `useMemo`, the filter helpers, and the chips:

```tsx
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { ReportTable, type Column } from "./report-table";
import { TypeFilter } from "./type-filter";
import {
  REPORT_CATEGORIES,
  selectReport,
  toggleCategory,
  type ReportCategory,
  type ReportData,
  type ViewRow,
} from "@/lib/money/report-view";
```

Replace the Task 2 stopgap:

```tsx
  const view = selectReport(data, REPORT_CATEGORIES);
  const t = view.totals;
```

with real filter state:

```tsx
  const [types, setTypes] = useState<ReportCategory[]>([...REPORT_CATEGORIES]);
  const view = useMemo(() => selectReport(data, types), [data, types]);
  const t = view.totals;

  const exportHref = `/reports/export?year=${encodeURIComponent(year)}&types=${types.join(",")}`;
```

Remove the now-dead `filename={...}` prop from all four `<ReportTable>` usages (`trackie-margin-…`, `trackie-gst-tds-…`, `trackie-oem-settlement-…`, `trackie-margin-by-oem-…`).

- [ ] **Step 3: Render the filter row above the tab strip**

Replace the opening of the returned JSX:

```tsx
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-lg border border-border bg-surface p-0.5">
```

with:

```tsx
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TypeFilter selected={types} onToggle={(c) => setTypes((s) => toggleCategory(s, c))} />
        <a
          href={exportHref}
          className="no-print rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
        >
          Download report
        </a>
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-border bg-surface p-0.5">
```

The `<a>` needs no `download` attribute — the route sets `Content-Disposition: attachment`.

- [ ] **Step 4: Verify types and tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Verify in the browser**

Load `/reports`. Check:
- All three chips start ticked and the numbers match Task 2's checkpoint.
- Unticking "Old students" changes Billed/Net margin and may reorder rows.
- Ticking only "Advance bill" shows **Students = 0** (expected — see Background).
- Clicking the last remaining ticked chip does nothing.
- Every tab (Margin, GST & TDS, OEM settlement, By OEM, Aging) responds to the chips.
- "Download report" 404s for now — the route lands in Task 5.

- [ ] **Step 6: Commit**

```bash
git add components/reports/reports-tabs.tsx components/reports/report-table.tsx
git commit -m "feat(reports): filter every tab by bill type

Chips drive selectReport through useMemo, so all five tabs recompute
instantly with no round trip. Drops the in-browser CSV builder from
report-table in favour of the backend export landing next."
```

---

### Task 5: Backend XLSX export route

**Files:**
- Create: `app/(app)/reports/export/route.ts`

Mirrors the house pattern at `app/(app)/hr/payroll/export/route.ts`. Read that file first.

**On testing this task.** The spec (§8) asks for coverage of `types` parsing, missing-`year` → 400, and filename naming. The first and third are already covered by automated tests — they live in `parseCategories` and `categorySlug`, unit-tested in Task 1, which is precisely why that logic was put in the pure module rather than inlined here. What is left in the route itself is auth, param plumbing, and workbook assembly. This repo has **no route-handler test infrastructure** (no session mocking, `environment: "node"`, no supertest), so those are verified manually in Step 3 rather than automated. Building that harness for one route is not worth it; the risk is contained because the route holds no business logic.

**Two gotchas:**
1. **Sanitise the year for the filename.** Year labels contain an **en-dash** (`"FY26–27"`). A non-ASCII `Content-Disposition` filename is not portable — slug it to ASCII, the same way `oem-csv-button.tsx:66` does.
2. **Sheet names** are capped at 31 chars by Excel and cannot contain `: \ / ? * [ ]`. The five used here are safe.

- [ ] **Step 1: Write the route**

Create `app/(app)/reports/export/route.ts`:

```ts
import * as XLSX from "xlsx";
import { auth } from "@/lib/auth/config";
import { getReportData } from "@/lib/dal/reports";
import {
  categoryLabels,
  categorySlug,
  parseCategories,
  selectReport,
} from "@/lib/money/report-view";

/**
 * Filtered Reports export.
 *
 * Calls the SAME getReportData + selectReport the page uses, so (a) the workbook
 * can never disagree with the screen, and (b) the DAL's scopeAccountIds applies
 * identically — a user cannot export accounts they cannot see.
 */
export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  // proxy.ts already redirects the unauthenticated; this is defence in depth.
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year");
  if (!year) return new Response("Bad request: year is required", { status: 400 });

  const types = parseCategories(url.searchParams.get("types"));
  const data = await getReportData({ id: Number(user.id), role: user.role }, year);
  const v = selectReport(data, types);
  const labels = categoryLabels(types);

  // Every sheet restates the year and the filter, so an extracted sheet still
  // says what it is.
  const head = (section: string) => [
    [`Trackie — ${section}`],
    ["Academic year", year],
    ["Bill types", labels],
    [],
  ];

  const wb = XLSX.utils.book_new();
  const add = (name: string, aoa: (string | number)[][], cols: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  add(
    "Margin",
    [
      ...head("Margin & collections"),
      ["Account", "OEM", "Students", "Billed", "Received", "Outstanding", "Net margin"],
      ...v.rows.map((r) => [r.name, r.oem, r.students, r.billed, r.received, r.outstanding, r.netMargin]),
      [],
      ["TOTAL", "", v.totals.students, v.totals.billed, v.totals.received, v.totals.outstanding, v.totals.netMargin],
    ],
    [28, 14, 10, 14, 14, 14, 14],
  );

  add(
    "GST & TDS",
    [
      ...head("GST & TDS — set aside for government (reserves, not profit)"),
      ["Account", "Net GST payable", "TDS receivable", "TDS payable", "Advance TDS cost"],
      ...v.rows.map((r) => [r.name, r.netGst, r.tdsReceivable, r.tdsPayable, r.advanceTdsCost]),
      [],
      ["TOTAL", v.totals.netGst, v.totals.tdsReceivable, v.totals.tdsPayable, v.totals.advanceTdsCost],
    ],
    [28, 16, 16, 16, 16],
  );

  add(
    "OEM settlement",
    [
      ...head("OEM settlement — what we owe and have paid each OEM"),
      ["Account", "OEM", "Payable", "Paid to OEM", "Outstanding to OEM"],
      ...v.rows.map((r) => [r.name, r.oem, r.payable, r.paidToOem, r.outstandingToOem]),
      [],
      ["TOTAL", "", v.totals.payable, v.totals.paidToOem, v.totals.outstandingToOem],
    ],
    [28, 14, 16, 16, 18],
  );

  add(
    "By OEM",
    [
      ...head("Margin by OEM — net to Datagami"),
      ["OEM", "Billed", "Payable", "Net margin"],
      ...v.byOem.map((o) => [o.oem, o.billed, o.payable, o.netMargin]),
    ],
    [22, 16, 16, 16],
  );

  add(
    "Aging",
    [
      ...head("Receivables aging — outstanding by bucket"),
      ["Bucket", "Outstanding"],
      ["Current", v.aging.current],
      ["31–60 days", v.aging.d31_60],
      ["61–90 days", v.aging.d61_90],
      ["90+ days", v.aging.d90plus],
      [],
      ["Total outstanding", v.totals.outstanding],
    ],
    [22, 16],
  );

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Year labels carry an en-dash ("FY26–27"); slug to ASCII for the header.
  const safeYear = year.replace(/[^a-z0-9]+/gi, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trackie-report-${categorySlug(types)}-${safeYear}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the route end-to-end**

With the dev server running and a logged-in session, from `/reports`:
- All three chips ticked → "Download report" saves `trackie-report-all-FY26-27.xlsx`.
- Untick "Old students" → the file is `trackie-report-advance+new-FY26-27.xlsx`.
- Open the workbook: five sheets (Margin, GST & TDS, OEM settlement, By OEM, Aging); each header block states the year and `Bill types: Advance bill, New students`.
- **The workbook's Margin TOTAL must equal the on-screen Margin total for the same chips.** This is the check that matters — it proves both consumers agree.

Then check the guards:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/reports/export"
```
Expected: `307` (proxy.ts redirects the unauthenticated to `/login`) — **not** a 500. Authenticated-but-no-`year` returns 400; verify in the browser at `/reports/export` while logged in.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/reports/export/route.ts"
git commit -m "feat(reports): backend XLSX export honouring the bill-type filter

Follows the payroll export pattern: auth, ?year=&types= params, one
workbook with a sheet per section. Calls the same getReportData +
selectReport as the page, so scoping applies identically and the file
cannot disagree with the screen."
```

---

### Task 6: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS. Report the actual count; do not claim success without reading the output.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds, and `/reports/export` appears in the route list as a dynamic function.

- [ ] **Step 4: Confirm no dead references**

```bash
grep -rn "filename=" components/reports/ | grep -v oem-csv-button
grep -rn "from \"@/lib/dal/reports\"" components/ app/
```
Expected: the first prints nothing (the `filename` prop is gone from `ReportTable`); the second shows only `app/(app)/reports/page.tsx` importing `getReportData`.

- [ ] **Step 5: Confirm the regression guard held**

The Task 2 test `"per-account rows aggregate to the same totals as the portfolio"` passing is the proof that all-types-selected still reproduces the validated numbers. Confirm it appears in the passing output by name.

---

## Follow-ups deliberately left out (from the spec's §9)

- `CATEGORY_LABEL` now exists in **eight** places — `today-panel.tsx:9`, `add-invoice.tsx:19`, `detail-tabs.tsx:25`, `invoice-ladder.tsx:15`, `account-report.tsx:6`, `rollover-wizard.tsx:13`, `oem-report.ts:57`, and now `report-view.ts`. They have **already drifted**: `rollover-wizard.tsx:13` says `"Advance"` where the rest say `"Advance bill"`. Consolidating touches seven files this feature does not otherwise need, so it stays out — but `report-view.ts` is the first pure, client-and-server-importable home the map has had, making it the natural landing spot.
- Aging's `d61_90` bucket remains permanently zero — a real fix needs date arithmetic against `dueDate`.
- The OEM drill-down (`/reports/oem/[oem]`) stays unfiltered and keeps its client-side CSV.
