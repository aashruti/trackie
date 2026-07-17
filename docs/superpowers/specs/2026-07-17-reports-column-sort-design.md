# Reports — Sortable Column Headers

**Date:** 2026-07-17
**Status:** Approved for implementation (user confirmed: keep `billed` desc as the default, add a
sorter to every column header, and the export follows the on-screen sort)
**Depends on:** the bill-type filter feature (`2026-07-17-reports-bill-type-filter-design.md`)

## 1. Problem

Reported by the user: *"on the reports we don't have the sort options? the university names keep
jumping here and there which makes it confusing to interpret the data."*

Two distinct defects, one visible symptom:

1. **No sorting UI at all.** `report-table.tsx` renders rows in whatever order it is handed;
   `report-view.ts` hard-codes `billed` descending. Meanwhile the **Accounts page already has
   clickable sortable headers** (`accounts-explorer.tsx`, with `SortKey`/`SortDir`/`SortTh`), so
   Reports is the inconsistent one and users arrive expecting the same affordance.
2. **The ordering key moves under the user.** Rows sort by `billed`, and `billed` *changes* when a
   bill type is toggled — so toggling reshuffles the table and a university the user was tracking
   jumps position.

This was predicted during the filter feature's design ("row order will reshuffle as you toggle
types — flag it if you'd rather the order stayed pinned") and raised with the user, but the question
went unanswered and the code shipped on the unconfirmed assumption. Recording that here: the cost
was a real usability defect found in use rather than in review.

## 2. Decisions (confirmed with user)

- **Default order stays `billed` descending.** "Biggest accounts first" is useful at a glance and is
  today's behaviour; changing it would trade one surprise for another.
- **Every column header gets a sorter.** Clicking Account sorts A–Z — stable across filter toggles,
  because names don't change with the filter. That is the escape hatch for the reported confusion.
- **The export follows the on-screen sort**, carried as a URL param.

## 3. Where the sort lives — and why not in the table

`selectReport(data, types, sort)` gains a third argument. The sort does **not** live in
`report-table.tsx`.

This is the same reasoning that shaped the filter feature: `selectReport` is the single definition
of what the view *is*, and both consumers call it — the client for the screen, the export route for
the workbook. Sorting in the table would mean two implementations (client sorts the DOM, route sorts
the workbook) that can drift, and the download would silently disagree with the screen on order.
That is precisely the property the architecture exists to guarantee.

`sort` defaults to `{ key: "billed", dir: "desc" }`, so every existing caller and the current
behaviour are unchanged by construction.

## 4. String comparison — the trap, and why the answer inverts

Sorting by **Account** or **OEM** compares strings. The screen sorts in the **browser**; the export
sorts in **Node**. Bare `localeCompare` is locale-dependent (`"IBM".localeCompare("Yale")` flips sign
under `lt-LT` — verified empirically during the filter feature), so the workbook could emerge in a
different order than the screen.

This is the twin of a bug already fixed in this codebase: the `byOem` tie-break
(`report-view.ts:194`) had `localeCompare` removed in favour of code-unit order for exactly this
cross-runtime reason.

**But the fix here is the opposite**, and the difference is the point:

| | `byOem` tie-break | user-facing A–Z sort |
| --- | --- | --- |
| Does human alphabetical order matter? | No — fires only on equal netMargin | **Yes** — it is the feature |
| Code-unit order acceptable? | Yes — total and identical in both runtimes | **No** — puts `"UOW"` before `"amity"` |
| Resolution | **Avoid** collation | **Pin** collation: `localeCompare(other, "en")` |

Pinning the locale makes it deterministic across runtimes *and* human-alphabetical. Both Node 22 and
browsers ship full ICU, so `"en"` resolves identically.

Note `accounts-explorer.tsx:35` uses bare `localeCompare` — correct there, because that sort never
leaves the browser. Ours crosses runtimes, so it cannot.

## 5. Modules

**`lib/money/report-view.ts`** (pure — both consumers import it)
- `SortDir = "asc" | "desc"`
- `SortKey` — the sortable `ViewRow` fields (all 12 metrics plus `name`, `oem`, `status`)
- `ReportSort { key: SortKey; dir: SortDir }`; `DEFAULT_SORT = { key: "billed", dir: "desc" }`
- `parseSort(key: string | null, dir: string | null): ReportSort` — unknown key or dir falls back to
  `DEFAULT_SORT`, mirroring `parseCategories`' forgiving contract
- `sortRows(rows: ViewRow[], sort: ReportSort): ViewRow[]`
- `selectReport(data, selected, sort = DEFAULT_SORT)`

The `id` tie-break is **retained under every sort key**, not just `billed`. It is what makes ordering
deterministic across the screen's and the export's two independent queries (the accounts query has no
`ORDER BY`), and ties are common — e.g. sorting by `students` with an advance-only filter puts every
row at 0.

**`components/reports/report-table.tsx`** — new optional `sort` + `onSort` props and a `SortTh`
header, mirroring `accounts-explorer.tsx:41`. Because `Column<T>` already carries `key` and `label`,
**every tab gets sorters with no per-tab work** — Margin, GST & TDS and OEM settlement all sort by
their own columns for free.

**`components/reports/reports-tabs.tsx`** — `sort` state beside the existing `types` state; both feed
the single `useMemo(() => selectReport(data, types, sort), [data, types, sort])`; `exportHref` gains
`&sort=…&dir=…`.

**`app/(app)/reports/export/route.ts`** — `parseSort(searchParams.get("sort"), searchParams.get("dir"))`,
passed straight to `selectReport`.

## 6. Scope boundaries

- **By OEM and Aging tabs are not sortable.** By OEM renders `OemRollup`, not `ViewRow`, and keeps
  its netMargin-desc order; Aging is a four-row fixed bucket list, not a table. Both are out.
- **No migration; no DAL change; no money-engine change.** Sorting is a pure view concern.
- **`accounts-explorer.tsx` is not refactored** to share `SortTh`. Its rows are a different type and
  its bare `localeCompare` is correct for its browser-only context; merging the two would drag a
  cross-runtime constraint into code that does not have one. Noted as a possible future tidy, not
  done here.

## 7. Testing

`sortRows` and `parseSort` are pure — they carry the unit tests:
- each key sorts both directions; `name`/`oem` are alphabetical, not code-unit (`"amity"` before
  `"UOW"`)
- the `id` tie-break holds under every key, and output order is independent of input order
- `parseSort` falls back to `DEFAULT_SORT` on unknown/absent key or dir
- `selectReport` with no third argument reproduces today's order exactly (the regression guard)

The decisive end-to-end check, as with the filter: **sort by name on screen, download, and confirm
the workbook's row order matches** — the screen-vs-file property this design turns on.

## 8. Follow-ups (not in scope)

- Persisting the user's last sort (localStorage) — no other table in the app does this.
- Sorting the By OEM tab.
- Sharing one `SortTh` between Reports and Accounts.
