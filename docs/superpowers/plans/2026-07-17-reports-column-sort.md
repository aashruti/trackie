# Reports Column Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Reports column a clickable sort header, keeping `billed` descending as the default, with the on-screen sort carried through to the XLSX export.

**Architecture:** `sort` becomes a third argument to the pure `selectReport(data, types, sort)` — not a table concern. Both consumers (the client for the screen, the export route for the workbook) pass the same sort, so the download cannot disagree with the screen on order. Defaults to `{ key: "billed", dir: "desc" }`, so today's behaviour is unchanged by construction.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-17-reports-column-sort-design.md`

---

## Background an engineer needs

**Why the user reported this.** Rows sort by `billed`, and `billed` *changes* when a bill type is toggled — so the ordering key moves under the user and universities jump position. Sorting by Account name is immune (names don't change with the filter), which is the escape hatch this adds.

**The house pattern already exists** in `components/accounts/accounts-explorer.tsx`: `SortKey`/`SortDir` types (`:26-27`), a `sortRows` comparator (`:29`), a `SortTh` clickable header (`:41`), and a `toggleSort` handler (`:99`). **Read that file first and mirror it.** Note its `toggleSort` defaults direction by column type — `name` → `asc`, numeric → `desc` — so one click gives A–Z on text and biggest-first on numbers. Mirror that.

**The string-comparison trap.** The screen sorts in the **browser**; the export sorts in **Node**. Bare `localeCompare` is locale-dependent (`"IBM".localeCompare("Yale")` flips sign under `lt-LT` — verified empirically in this repo), so the workbook could come out in a different order than the screen.

`report-view.ts:194` already *removed* `localeCompare` from the `byOem` tie-break for exactly this reason. **Do not copy that decision here — it inverts.** For a tie-break, alphabetical niceness is irrelevant, so code-unit order was right. For a user-facing A–Z sort, code-unit order is *wrong*: it puts `"UOW"` before `"amity"` because uppercase sorts first. So **pin** the collator instead of avoiding it: `localeCompare(other, "en")` — deterministic across both runtimes *and* human-alphabetical.

`accounts-explorer.tsx:35` uses bare `localeCompare`; correct there, because that sort never leaves the browser. Ours crosses runtimes, so it cannot.

**Test setup.** Vitest. `npm test` runs everything. Pure tests (`lib/money/*.test.ts`) need no DB; `lib/dal/reports.test.ts` hits a **real local Postgres** (seeded year `"FY26–27"` — en-dash). `npm test` has **one pre-existing failure** in `lib/board/constants.test.ts` (`lostCount`) that also fails on `main` — verified; ignore it.

---

## File Structure

**Modify:**
- `lib/money/report-view.ts` — sort types, `sortRows`, `parseSort`, `DEFAULT_SORT`, third arg on `selectReport`.
- `lib/money/report-view.test.ts` — unit tests for the above.
- `components/reports/report-table.tsx` — optional `sort`/`onSort` props + `SortTh`.
- `components/reports/reports-tabs.tsx` — sort state, `toggleSort`, pass to `selectReport` + tables, extend `exportHref`.
- `app/(app)/reports/export/route.ts` — parse `?sort=&dir=`, pass through.

**Not touched:** `lib/dal/reports.ts`, `lib/money/compute.ts`, `app/(app)/reports/page.tsx`, `components/accounts/accounts-explorer.tsx`.

---

### Task 1: Sort in the pure selector

**Files:** Modify `lib/money/report-view.ts`, `lib/money/report-view.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/money/report-view.test.ts` (add `DEFAULT_SORT`, `parseSort`, `sortRows`, `type ViewRow` to the existing import):

```ts
const vrow = (over: Partial<ViewRow> = {}): ViewRow => ({
  id: 1, name: "A", oem: "IBM", status: "raised",
  ...emptyMetrics(),
  ...over,
});

describe("sortRows", () => {
  it("sorts numbers descending then ascending", () => {
    const rows = [vrow({ id: 1, billed: 10 }), vrow({ id: 2, billed: 30 }), vrow({ id: 3, billed: 20 })];
    expect(sortRows(rows, { key: "billed", dir: "desc" }).map((r) => r.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, { key: "billed", dir: "asc" }).map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("sorts names alphabetically, not by code unit", () => {
    // Code-unit order would put "UOW" (U=85) before "amity" (a=97) — wrong for a
    // user-facing A–Z sort. A pinned collator gets this right.
    const rows = [vrow({ id: 1, name: "UOW" }), vrow({ id: 2, name: "amity" })];
    expect(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual(["amity", "UOW"]);
  });

  it("does not mutate its input", () => {
    const rows = [vrow({ id: 1, billed: 10 }), vrow({ id: 2, billed: 30 })];
    sortRows(rows, { key: "billed", dir: "desc" });
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("breaks ties on id under every key, so order ignores input order", () => {
    const a = vrow({ id: 1, name: "Same", billed: 5 });
    const b = vrow({ id: 2, name: "Same", billed: 5 });
    for (const key of ["billed", "name"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(sortRows([a, b], { key, dir }).map((r) => r.id)).toEqual([1, 2]);
        expect(sortRows([b, a], { key, dir }).map((r) => r.id)).toEqual([1, 2]);
      }
    }
  });

  it("sorts by status (a string field)", () => {
    const rows = [vrow({ id: 1, status: "raised" }), vrow({ id: 2, status: "overdue" })];
    expect(sortRows(rows, { key: "status", dir: "asc" }).map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("parseSort", () => {
  it("defaults when key is absent or unknown", () => {
    expect(parseSort(null, null)).toEqual(DEFAULT_SORT);
    expect(parseSort("bogus", "asc")).toEqual(DEFAULT_SORT);
  });

  it("accepts a known key and direction", () => {
    expect(parseSort("name", "asc")).toEqual({ key: "name", dir: "asc" });
    expect(parseSort("netMargin", "desc")).toEqual({ key: "netMargin", dir: "desc" });
  });

  it("falls back to the default direction when dir is garbage", () => {
    expect(parseSort("name", "sideways")).toEqual({ key: "name", dir: DEFAULT_SORT.dir });
  });
});

describe("selectReport sort argument", () => {
  it("defaults to billed desc — today's order, unchanged", () => {
    const r1 = row({ id: 1, byCategory: { ...emptyByCategory(), new: metrics({ billed: 10 }) } });
    const r2 = row({ id: 2, byCategory: { ...emptyByCategory(), new: metrics({ billed: 30 }) } });
    const data = { rows: [r1, r2] };
    expect(selectReport(data, ["new"]).rows.map((r) => r.id)).toEqual([2, 1]);
    expect(selectReport(data, ["new"], DEFAULT_SORT).rows.map((r) => r.id)).toEqual([2, 1]);
  });

  it("honours an explicit sort", () => {
    const r1 = row({ id: 1, name: "Zeta", byCategory: { ...emptyByCategory(), new: metrics({ billed: 30 }) } });
    const r2 = row({ id: 2, name: "Alpha", byCategory: { ...emptyByCategory(), new: metrics({ billed: 10 }) } });
    const v = selectReport({ rows: [r1, r2] }, ["new"], { key: "name", dir: "asc" });
    expect(v.rows.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/money/report-view.test.ts`
Expected: FAIL — `sortRows`/`parseSort`/`DEFAULT_SORT` are not exported.

- [ ] **Step 3: Implement**

In `lib/money/report-view.ts`, add after `parseCategories`:

```ts
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
```

Then change `selectReport`'s signature and its sort line:

```ts
export function selectReport(
  data: ReportData,
  selected: readonly ReportCategory[],
  sort: ReportSort = DEFAULT_SORT,
): ReportView {
```

Replace the existing `rows.sort((x, y) => y.billed - x.billed || x.id - y.id);` (and the comment block above it about sorting living here) with:

```ts
  // Sorting lives here, not in the DAL or the table: a raw row has no single
  // `billed`, only per-type buckets — and the screen and the export must agree on
  // order, so one definition serves both.
  const sorted = sortRows(rows, sort);
```

and return `{ rows: sorted, byOem, aging, totals }`. Leave the `byOem` comparator and its comment **exactly as they are** — its code-unit choice is deliberate and correct.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/money/report-view.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/money/report-view.ts lib/money/report-view.test.ts
git commit -m "feat(reports): sort as a selector argument

selectReport gains a sort argument defaulting to billed desc, so today's
order is unchanged. Sorting lives here rather than in the table so the
screen and the XLSX cannot disagree on order.

String keys use a collator pinned to en — unlike the byOem tie-break, which
avoids collation entirely, a user-facing A-Z sort needs alphabetical order,
and pinning is what keeps browser and Node identical."
```

---

### Task 2: Sortable headers, wiring, and export

**Files:** Modify `components/reports/report-table.tsx`, `components/reports/reports-tabs.tsx`, `app/(app)/reports/export/route.ts`

- [ ] **Step 1: Add `SortTh` to `report-table.tsx`**

Mirror `accounts-explorer.tsx:41`. Keep the props optional so the By OEM tab (which renders `OemRollup`, not `ViewRow`) opts out and gets plain headers.

```tsx
export function ReportTable<T extends object>({
  title, subtitle, columns, rows, totals, sort, onSort,
}: {
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  rows: T[];
  totals?: Partial<Record<keyof T, number>> & { label?: string };
  sort?: { key: keyof T; dir: "asc" | "desc" };
  onSort?: (k: keyof T) => void;
}) {
```

Then replace the whole `<thead>` block with this. When `onSort` is absent the header renders exactly as it does today, so By OEM is untouched:

```tsx
        <thead>
          <tr className="border-b border-border-subtle text-xs text-text-muted">
            {columns.map((c) => {
              const right = c.align === "right" || c.money;
              const active = sort?.key === c.key;
              const arrow = active ? (sort!.dir === "asc" ? " ↑" : " ↓") : "";
              return (
                <th
                  key={String(c.key)}
                  className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}
                >
                  {onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      aria-label={`Sort by ${c.label}`}
                      className={`select-none hover:text-text-primary ${active ? "text-text-primary" : ""}`}
                    >
                      {c.label}
                      {arrow}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
```

- [ ] **Step 2: Wire sort state into `reports-tabs.tsx`**

Add to the imports: `DEFAULT_SORT`, `sortRows` is NOT needed (the selector does it), `type ReportSort`, `type SortKey`.

```tsx
  const [sort, setSort] = useState<ReportSort>(DEFAULT_SORT);
  const view = useMemo(() => selectReport(data, types, sort), [data, types, sort]);
```

Add a `toggleSort` mirroring `accounts-explorer.tsx:99` — same key flips direction; a new key sets direction by type (text → `asc`, numeric → `desc`):

```tsx
  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "oem" || key === "status" ? "asc" : "desc" },
    );
  }
```

Pass `sort={sort}` and `onSort={(k) => toggleSort(k as SortKey)}` to the three `ViewRow` tables (Margin, GST & TDS, OEM settlement). Do **not** pass them to the By OEM table.

Extend `exportHref`:

```tsx
  const exportHref = `/reports/export?year=${encodeURIComponent(year)}&types=${types.join(",")}&sort=${sort.key}&dir=${sort.dir}`;
```

- [ ] **Step 3: Pass the sort through the export route**

In `app/(app)/reports/export/route.ts`, import `parseSort` and use it:

```ts
  const sort = parseSort(url.searchParams.get("sort"), url.searchParams.get("dir"));
  const v = selectReport(data, types, sort);
```

- [ ] **Step 4: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run lib/money lib/dal/reports.test.ts`
Expected: clean; all pass.

- [ ] **Step 5: Verify in the browser — REQUIRED**

Dev server on **http://localhost:3000** (Browser pane tab `seed`). Credentials (synthetic, local DB only): `verify-admin@test.local` / `Verify@12345`. Never use Bash to run a dev server.

Verify and report ACTUAL observations:
1. `/reports` opens with **Billed** descending — GNA University first, total ₹21Cr / ₹4.62Cr, 22 accounts (the verified baseline).
2. Clicking **Account** sorts A–Z with an arrow on that header; "Amity University" first.
3. **The reported bug is fixed:** with Account sort active, toggle "Old students" off — row order must NOT change (only the numbers do).
4. Clicking Account again flips to Z–A.
5. Clicking **Billed** returns to numeric sort, biggest first on the first click.
6. Sorters work on the GST & TDS and OEM settlement tabs too.
7. By OEM and Aging tabs are unaffected (no sorters — expected).
8. `read_console_messages` → no errors.
9. **The decisive check:** with Account A–Z active, the export href contains `&sort=name&dir=asc`; fetch it and confirm the workbook's Margin sheet rows are in the same A–Z order as the screen.

- [ ] **Step 6: Commit**

```bash
git add components/reports/report-table.tsx components/reports/reports-tabs.tsx "app/(app)/reports/export/route.ts"
git commit -m "feat(reports): clickable sort headers on every column

Mirrors the Accounts page pattern. Text columns default ascending, numeric
descending, so one click gives A-Z or biggest-first as appropriate.

Fixes the reported bug: sorting by Account is stable across bill-type
toggles, because names do not change with the filter. The sort travels to
the export, so the workbook matches the screen's order."
```

---

## Discipline

- Commits are authored `aashruti` via local git config — do not change it, do **not** add Co-Authored-By.
- Unrelated uncommitted files (`scripts/reset-db.ts`, `app/api/ping/`, `vercel.json`) — leave alone, never stage.
- `npm test`'s single `lib/board/constants.test.ts` failure is pre-existing and fails on `main` too. Ignore it.
