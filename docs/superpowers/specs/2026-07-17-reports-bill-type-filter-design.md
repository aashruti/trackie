# Reports — Filter by Bill Type + Backend XLSX Export

**Date:** 2026-07-17
**Status:** Approved for implementation (user confirmed: account rows recomputed — not a
bill-level list; instant client-side filtering; backend XLSX export covering all sections)
**Depends on:** money engine (`lib/money/compute.ts`), reports module

## 1. Problem

Reports currently show one row per **account**, with every bill for that account rolled
up by `computeAccount`. There is no way to ask "what do these numbers look like for
advance bills only?" or "for new students only?".

Users want to tick any combination of the three bill types — **Advance bill**, **Old
students**, **New students** — and have the whole Reports page reflect only the ticked
types, then download the filtered report.

The three types already exist as the `category` enum (`advance` | `old` | `new`,
`lib/db/enums.ts`) and are already labelled with exactly these words in the accounts UI.
Nothing new is persisted; no migration.

## 2. What "filter" means here (confirmed with user)

Rows stay **one per account** across all existing tabs (Margin, GST & TDS, OEM
settlement, By OEM, Aging). Ticking types narrows which bills feed each account's
numbers. The filter is a **lens over the whole page**, not a new bill-level listing.

This is mathematically sound because of a property of the money engine
(`compute.ts:120-134`): **every money field on an account is a pure sum over its bills.**
`billing`, `received`, `outstanding`, `payable`, `paidToOem`, `outstandingToOem`,
`netMargin`, `gstDiff`, `tdsIn`, `tdsOut`, `advanceTdsCost` — all `sum(k)`. So filtering
by type is exactly "add up a subset", and no engine change is required.

`status` is the **only** non-additive field (`accountStatus`, `compute.ts:101`). It is
re-derived from the filtered subset of bills.

## 3. Approaches considered

**A. Server pre-computes per-type subtotals; client sums the ticked ones (CHOSEN).**
`getReportData` buckets each account's bills by category and returns per-type subtotals.
The client adds up the selected buckets. Chip toggles are instant, query count is
unchanged, and `accountStatus()` is reused rather than reimplemented.
*Cons:* `ReportData`'s shape changes, so the page and tabs both move.

**B. URL search param, server recomputes.** `?types=advance,new` filters the invoice rows
in the query. Simplest code, and the filter becomes shareable/bookmarkable.
*Rejected:* every chip toggle is a full server round trip re-running the whole report
(all accounts, invoices, payments, cohorts) — sluggish for a filter that should feel
instant.

**C. Ship raw bills to the client and run `compute.ts` in the browser.** Most flexible.
*Rejected:* sends every bill's pricing to the client and duplicates the engine's entry
point on both sides.

### Export: backend route vs client CSV

The existing per-tab "Export CSV" builds a raw CSV string **in the browser**
(`report-table.tsx:34`). The house pattern for a real report download is
`app/(app)/hr/payroll/export/route.ts`: authenticate, read filters from search params,
call the DAL, stream a formatted XLSX (`xlsx` is already a dependency).

**Backend XLSX export CHOSEN**, replacing the per-tab client CSV, because it gives:
formatted output with column widths; scoping enforced server-side via the DAL; one
workbook covering every section (which per-tab CSV cannot do); and a plain URL download
with no blob hack.

*Note:* there was never an "endpoint" constraining the data format. Reports is a Server
Component calling `getReportData()` directly — the app has **no read-for-UI endpoints**.
All three existing route handlers are non-UI: Auth.js, a Neon keep-warm ping, and the
payroll **file export** cited above; UI reads go through Server Components and mutations
through Server Actions. The DAL's return type is a plain TypeScript signature, reshaped
freely here. Adding an export route follows the payroll precedent rather than breaking
the convention: it serves a file, not UI data.

## 4. Architecture

The pure selector is the spine: **`selectReport(data, types)` defines exactly once what
"filtered to advance + new" means, and both consumers call it** — the browser for instant
toggling, the export route for the workbook. The download can never disagree with the
screen.

```
lib/dal/reports.ts  (server-only)          getReportData → ReportData (per-type buckets)
        │                                                       │
        ├── app/(app)/reports/page.tsx ──── ReportData ──→ reports-tabs.tsx (client)
        │                                                       │  selectReport(data, ticked)
        │                                                       ▼
        │                                                  ReportView → tabs render
        │
        └── app/(app)/reports/export/route.ts ── selectReport(data, ?types) → XLSX
```

`lib/money/report-view.ts` is **pure** (no `server-only`) precisely so both the client
component and the route handler can import the same selector.

## 5. Modules

### `lib/money/report-view.ts` (new, pure)

- `REPORT_CATEGORIES = ["advance", "old", "new"] as const`; `ReportCategory`
- `CATEGORY_LABEL: Record<ReportCategory, string>` — "Advance bill" / "Old students" /
  "New students"
- `ReportMetrics` — the 12 additive fields: `students`, `billed`, `received`,
  `outstanding`, `payable`, `paidToOem`, `outstandingToOem`, `netMargin`, `netGst`,
  `tdsReceivable`, `tdsPayable`, `advanceTdsCost`
- `BillLite { category, status, outstanding, received }` — the minimum needed to
  re-derive **both** account status and aging on a subset
- `ReportRow { id, name, oem, byCategory: Record<ReportCategory, ReportMetrics>,
  bills: BillLite[] }`
- `ReportData { rows: ReportRow[] }`
- `ViewRow = { id, name, oem } & ReportMetrics & { status: Status }`
- `ReportView { rows: ViewRow[], byOem, aging, totals }`
- `selectReport(data: ReportData, selected: ReportCategory[]): ReportView`

`selectReport` does, per row: sum `byCategory` over `selected` → metrics; filter `bills`
to `selected` → `accountStatus()` → status. Then `totals` = Σ rows; `byOem` = group by
oem summing billed/payable/netMargin, sorted by netMargin desc; `aging` = bucket every
filtered bill.

**Sorting moves here.** `reports.ts:134` currently sorts rows by `billed` desc, but a raw
row no longer *has* a single `billed` — only per-type buckets. So the DAL stops sorting
and `selectReport` sorts on the **filtered** `billed` desc, meaning row order responds to
the ticked types. Same rule as today, applied to what's on screen.

### `lib/dal/reports.ts` (reshaped)

Still calls `computeAccount(inputs)` once per account — **the money engine is untouched.**
`computeAccount` already returns `invoices: (InvoiceComputed & { status })[]`, each
carrying its `category`, so bucketing is a pure JS pass over a result we already have:

```ts
const c = computeAccount(inputs);
for (const inv of c.invoices) {
  const m = byCategory[inv.category];
  m.students += inv.category === "advance" ? 0 : inv.students;  // preserves reports.ts:104
  m.billed += inv.billing;
  m.netGst += inv.gstDiff;
  m.tdsReceivable += inv.tdsIn;
  m.tdsPayable += inv.tdsOut;
  // …the remaining additive fields
}
```

Query count unchanged (no N+1, per house rules). `byOem`, `aging`, and `totals` are
**removed** from the DAL — all three are derivable from filtered rows, so server copies
would only be a second source of truth that drifts.

### `app/(app)/reports/export/route.ts` (new)

Mirrors `hr/payroll/export/route.ts`.

- `auth()` → 401 if no session (defence in depth; `proxy.ts` already redirects).
- `?year=` **required** → 400 if absent. An unknown year yields an empty report, matching
  the page's behaviour (`getReportData` returns `empty` when the year lookup misses).
- `?types=` parsed by splitting on `,`, filtering to `REPORT_CATEGORIES`, deduping. Empty
  after filtering → all three. Forgiving, and matches the UI's "at least one" invariant.
- `getReportData(user, year)` → `selectReport(data, types)` → workbook.
- Five sheets: **Margin**, **GST & TDS**, **OEM settlement**, **By OEM**, **Aging**.
  Each sheet is self-describing — `["Trackie — <section>"]`, `["Academic year", year]`,
  `["Bill types", <labels>]`, blank, header, body, blank, TOTAL — so an extracted sheet
  still states its filter.
- `Content-Disposition: attachment; filename="trackie-report-<types>-<year>.xlsx"`
  (e.g. `trackie-report-advance+new-2025-26.xlsx`; all three ticked → `-all-`).
  `Cache-Control: no-store`.

### `components/reports/type-filter.tsx` (new)

Three chips, styled like the existing tab buttons. **At least one stays ticked** —
clicking the last active chip is a no-op, so the report can't reach an empty dead-end.

### `components/reports/reports-tabs.tsx`

Owns `useState<ReportCategory[]>(REPORT_CATEGORIES)` and
`useMemo(() => selectReport(data, selected), [data, selected])`. Renders `TypeFilter`
above the tab strip, plus one **Download report** button — a plain
`<a href="/reports/export?year=…&types=…">`, since the route sets
`Content-Disposition`. Type imports move from `@/lib/dal/reports` to
`@/lib/money/report-view`.

### `components/reports/report-table.tsx`

Loses `exportCsv`, `csvCell`, the button, and the `filename` prop (~20 lines out),
becoming a purely presentational table. It is only used by `reports-tabs.tsx`, so the
change is contained.

### `app/(app)/reports/page.tsx`

Passes raw `ReportData` through. The "N accounts · YEAR" line stays (account count is
filter-independent).

## 6. Semantics worth stating

- **Status shifts with the filter.** An account with a paid new-students bill and an
  overdue advance reads "overdue" today; filtered to New students only it reads "paid".
  That is the honest answer for the filtered view.
- **Advance-only shows Students = 0.** `reports.ts:104` already excludes advances from
  student counts; bucketing preserves that. Correct, but looks odd the first time.
- **Advance and New/Old are not fully independent slices.** An advance is netted *inside*
  the student bill via `advanceAdj` (pre-tax, off the OEM payable — see
  `trackie-financial-model`). A new-students bill is therefore already billed net of any
  advance prepaid, and ticking only "New students" still reflects that netting. This is
  inherent to how the bill was raised, not a filter artifact.
- **Aging's `d61_90` bucket is dead today** and stays dead. The existing logic
  (`reports.ts:126-131`) maps overdue → `d90plus`, partially-paid → `d31_60`, everything
  else → `current`; nothing ever lands in `d61_90`. Behaviour is preserved exactly rather
  than fixed — a real fix needs date arithmetic against `dueDate` and is out of scope.
  Noted as a follow-up.

## 7. Authorization

No new surface. `proxy.ts`'s matcher already covers `/reports/export`, enforcing auth and
bouncing `viewer` to `/team`. The export route calls the **same** `getReportData` with the
same user, so `scopeAccountIds` applies identically to the download and the screen — a
user can never export accounts they cannot see.

## 8. Testing

The selector being pure is where the value is.

**`lib/money/report-view.test.ts` (new)**
- **Regression guard:** all three types selected reproduces today's numbers to the rupee
  (protects the validated Pillai ₹3,86,000 / Kalinga ₹33,81,722 / ₹3.77 Cr totals).
- Subset sums: `advance + old + new` selections each equal the sum of their buckets, and
  the three disjoint selections sum back to the total.
- Status re-derivation on a subset (paid-new + overdue-advance → "overdue" unfiltered,
  "paid" filtered to new).
- Advance-only → `students === 0`.
- Aging bucketed per type; `byOem` regrouping and sort order.
- Empty selection defensive behaviour (selector returns zeros; UI prevents reaching it).

**`lib/dal/reports.test.ts` (updated)** — new shape; still asserts the query count has not
grown.

**Export route** — `types` parsing (unknown values dropped, empty → all, dupes collapsed),
missing `year` → 400, and sheet/filename naming.

## 9. Out of scope

- **The OEM drill-down** (`/reports/oem/[oem]`, `lib/dal/oem-report.ts`,
  `oem-csv-button.tsx`) stays unfiltered and keeps its client CSV.
- **`CATEGORY_LABEL` duplication.** *(Corrected 2026-07-17 — this section originally said
  "two copies"; a code review found **seven**.)* The label map is already inlined in
  `today-panel.tsx:9`, `add-invoice.tsx:19`, `detail-tabs.tsx:25`, `invoice-ladder.tsx:15`,
  `account-report.tsx:6`, `rollover-wizard.tsx:13`, and `oem-report.ts:57`;
  `report-view.ts` makes eight. **They have already drifted:** `rollover-wizard.tsx:13`
  says `"Advance"` where the other six say `"Advance bill"` — so this is a live
  inconsistency users can see, not hypothetical debt.

  Still deliberately out of scope: consolidating means editing seven files this feature
  does not otherwise touch, and the drift predates it. But `report-view.ts` is the first
  pure, client-**and**-server-importable home the map has ever had, which makes it the
  natural consolidation point when someone does take it on. Raised as a follow-up rather
  than silently widened into this diff.
- **No bill-level (one row per invoice) listing.** Explicitly rejected in favour of
  recomputed account rows.
- **No migration, no money-engine change.**
