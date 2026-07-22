# Pricing Master Screen + FY Batch Rollover — Design

**Date:** 2026-07-22 · **Status:** user-approved (incl. counts-only rollover amendment)

## Context

Pricing lives on `invoices`: one row per account × year × stream (`advance`/`old`/`new`, ± semester)
with `students`, `priceToUni`, `priceToDatagami`. "Old" (returning-student) invoices are cohort-driven:
`cohorts` rows hold a free-text batch label (`enrollment_year`, hand-typed like `2024-25`), a count, and
optional locked prices; when cohorts exist, `invoices.students` is synced to their sum
(`setCohorts`, `lib/dal/mutations.ts`).

Pain points this design addresses:

1. Changing prices / student counts for a year means visiting every account → Students tab. The
   accounts team wants one **master screen** to view and edit everything for a year in one go.
2. Batch labels don't follow any convention, and the rollover (`lib/dal/rollover.ts`) clones invoices
   verbatim — this year's "new" intake never becomes next year's returning batch.

## User-confirmed decisions

1. **Promotion on rollover**: rolling FY26–27 → FY27–28, the FY26–27 "new" intake becomes a returning
   batch named `FY26–27` inside FY27–28's "old" invoice. FY27–28's "new" invoice is the fresh intake.
2. **Batch naming convention**: a batch is labeled exactly with its intake year's label, in the DB's
   existing year format — `FY26–27` (no space, en-dash). Existing labels are migrated.
3. **Master screen scope**: prices + counts, including per-batch rows for old invoices.
4. **Rollover carries counts + prices** (amended 2026-07-23): rollover copies student counts **and
   pre-fills last year's prices as editable defaults** — invoice `priceToUni`/`priceToDatagami`,
   `gstRate`/`tdsRate`, and each carried batch's locked price all carry forward; the promoted batch
   inherits its source new-intake's price. Only the *year-specific billing actions* stay reset:
   invoices are Draft with `invoiceDate` null, `advanceAdj` resets to 0, and **advance streams are
   not cloned at all**. Bills are raised as and when needed; the accounts team adjusts the
   pre-filled prices on the master pricing screen.
   (Originally counts-only with prices blank; changed after the browser walkthrough — re-entering
   every price by hand was the friction the master screen was meant to remove.)

## Part 1 — FY helpers (`lib/fy.ts`, new, client-safe)

Pure functions, single source of truth for the label convention:

- `nextFyLabel("FY26–27") → "FY27–28"` — moved from `lib/dal/rollover.ts` (logic unchanged).
- `prevFyLabel("FY26–27") → "FY25–26"` — used for the scalar-old catch-all batch.
- `normalizeBatchLabel(raw)` — maps known forms to canonical: `2024-25`, `24-25`, `FY24-25`,
  `FY 24-25`, `FY24–25` → `FY24–25`. Unrecognized input is returned unchanged.
- `batchStartYear(label)` + `yearOfStudy(batchLabel, currentYearLabel)` — consolidates the duplicated
  `startYear`/`yearOfStudy` copies in `components/accounts/detail-tabs.tsx` and
  `components/accounts/invoice-ladder.tsx`. Existing regex already parses both old and FY forms, so
  "3rd year · FY24–25" display keeps working.

The cohort editor (`components/accounts/cohort-editor.tsx`) updates its placeholder to `FY24–25` and
runs `normalizeBatchLabel` on save.

## Part 2 — Data migration (batch label rename)

`drizzle/0019_fy_batch_labels.sql` + `drizzle/meta/_journal.json` entry, applied locally via
`npx tsx scripts/db-migrate.ts` (production migrates on deploy). Renames existing
`cohorts.enrollment_year` values to canonical FY form using `regexp_replace` cases mirroring
`normalizeBatchLabel`:

- `^\d{4}-\d{2}$` (e.g. `2024-25`) → `FY24–25` (last two digits of start year + en-dash)
- `^\d{2}-\d{2}$` (e.g. `24-25`) → `FY24–25`
- `^FY ?\d{2}-\d{2}$` (hyphen or space variants) → `FY24–25`

Anything not matching a known pattern is left untouched. Data-only migration — no schema change.

**Scope (accepted, self-healing):** the migration covers the realistic legacy forms (hyphen,
2- or 4-digit, optional `FY`/space). `normalizeBatchLabel` recognizes a slightly broader set
(em-dash, lowercase `fy`, `FY2024-25`) — any exotic straggler the bulk rename misses is
canonicalized by the runtime normalizer on its next edit, so it converges to the canonical form
without a second migration. Migration **0020** then merges any price-agreeing duplicate labels
0019 folds together; `mergeCohortRows` (in `setCohorts`) applies the same rule at write time and
leaves price-*conflicting* same-label rows separate (money-bearing — never silently collapsed).

## Part 3 — Rollover: counts-only + promotion (`lib/dal/rollover.ts`)

Unchanged: idempotent per-account skip when the target year already has invoices; everything created
as `draft`; source year never modified; target `academicYears` row created if missing; `deleteYear`
undo; auth (Sales/Super Admin, `canEdit` scoping).

New semantics rolling `from → to`, per account:

| Source stream | Result in target year |
|---|---|
| **advance** | **not cloned** — advance bills are created when needed |
| **old** | cloned: batches carried with **counts only** (locked prices → `null`), plus the promoted batch appended; invoice prices `0`, GST/TDS schema defaults, `advanceAdj` 0, dates null |
| **new** | ① promoted: target **old** invoice of the same semester gains batch `{label: fromYearLabel, count}` (old invoice created if the account had none for that semester); ② fresh **new** invoice created with count defaulting to the source intake (editable estimate), prices `0` |

Edge cases:

- **Scalar old invoice** (no batches): its count is materialized as a catch-all batch labeled
  `prevFyLabel(fromYear)` (e.g. `FY25–26`), price `null`. Money-neutral placeholder; label editable
  later on the account screen.
- **Duplicate "new" invoices in one semester** (schema doesn't forbid): merged into one promoted
  batch, counts summed.
- Target old invoice's scalar `students` = Σ batch counts (existing sync invariant).

**API shape**: `rolloverAction(from, to, edits)` where
`edits = { scalarCounts: Record<invoiceId, number>, cohortCounts: Record<invoiceId, Record<label, number>>, promotedCounts: Record<newInvoiceId, number> }`
(promoted-batch count overrides are keyed by the source *new* invoice they originate from;
`scalarCounts` keyed by the same id sets the fresh-intake estimate). `RolloverPlanRow` slims down to
`{invoiceId, accountId, accountName, category, semester, students, cohorts: {label, count}[]}` — price
fields dropped.

**Passed-out batches** (amended 2026-07-23): a batch whose count reaches 0 in the wizard edits is
NOT carried into the target year (graduating batches). An old invoice left with no batches and no
promoted intake is not created at all. The wizard exposes this as a per-batch "×" (passes out)
toggle with undo. The promoted intake is *displayed* under the Old students row it will join
(fresh intake stays alone on the New students row). Accounts with a `new` intake but no source
Old invoice for that semester still get a synthesized Old students row hosting the promoted batch
(amended 2026-07-23 — the DAL already creates that invoice; the wizard now shows it as its own
row rather than cramming the promoted input onto New). Batches render newest-first (promoted
FY26–27 at top, oldest at bottom), via `batchLabelDesc` in `lib/fy.ts`, on both the wizard and
`/pricing`.

**Wizard UI** (`components/year/rollover-wizard.tsx`): becomes a pure counts screen —
"Roll over student counts to FY27–28". Projected billing/margin tiles and columns are **removed**
(no prices carried, they'd all read ₹0 and mislead). Old rows list carried batches plus the promoted
batch marked "← promoted from new intake"; new rows relabeled "New intake FY27–28" with the editable
estimate. Summary shows total students instead. Post-create message points users to the pricing
master screen to set the new year's prices.

## Part 4 — Master pricing screen

- **Route** `app/(app)/pricing/page.tsx` → `/pricing`; sidebar entry "Pricing master" in the Finance
  group (visible to Sales + Super Admin — same `canViewFinance` gate as account pages; not admin-only).
- **Read**: `getPricingMaster(user, yearLabel)` in `lib/dal/pricing-master.ts`, following the
  `listAccountsForUser` no-N+1 pattern: resolve year, one query for accounts, one for the year's
  invoices, one `inArray` for cohorts; group in JS. Each row carries `editable` (via `canEdit` +
  `assignedIds`); non-editable accounts render read-only.
- **UI**: `components/pricing/pricing-master.tsx` (client). One table for the top-bar-selected year,
  grouped by account; one row per stream; old invoices expand into per-batch sub-rows. Layout
  (amended 2026-07-23): each account renders as a full-width group-header row with its streams
  beneath — New students first — and streams carry colour-coded chips (green = new, blue = old). Editable cells:
  scalar count (new invoices), per-batch counts + locked prices (old invoices), invoice-level
  `priceToUni`/`priceToDatagami` everywhere editable. Advance bills do NOT appear (amended
  2026-07-22 during browser review: an advance's "price" is a lump billing amount, not student
  pricing — advance bills stay on the account screen). Live per-row
  billing/margin via existing client `computeInvoice` (drafts with price 0 simply show ₹0 until prices
  are set — expected in the counts-only workflow). Account-name filter box. Dirty cells highlighted;
  sticky footer shows "Save N changes".
- **Write**: `savePricingAction(edits)` in `app/(app)/pricing/actions.ts`. Client diffs against loaded
  state and sends only changes: per invoice `{invoice?: {students?, priceToUni?, priceToDatagami?},
  cohorts?: full replacement list}`. Action re-auths (`auth()` + roles) and routes every change through
  the existing audited DAL writers — `updateInvoice` and `setCohorts` — so `canEdit`, audit stamping,
  and the cohort↔scalar sync are enforced for free. This is a bounded write loop over *edited* invoices
  through business-rule helpers, not a read N+1. Returns `{ok} | {ok:false, error}` per convention;
  revalidates `/pricing` and each touched `/accounts/[id]`.
- Batch **renaming/adding/removing stays on the account → Students tab** (out of scope here).

## Testing

TDD on logic (vitest, alongside existing `lib/dal/rollover.test.ts`):

- Rollover: promoted batch created + named `fromYear` label; old invoice auto-created when missing;
  counts-only (created invoices have price 0 / null batch prices; advance not cloned); scalar-old
  catch-all materialization; duplicate-new merge; fresh-intake default + override; idempotent skip
  unchanged.
- `lib/fy.ts`: normalization matrix, next/prev label, yearOfStudy parity with the old inline logic.
- Master screen: DAL grouping test; UI verified in browser preview (edit → save → re-read).

## Out of scope

Batch add/remove/rename on the master screen; payments, GST/TDS, invoice dates/status editing on the
master screen; changes to `deleteYear`; any change to how bills are raised.

## Files

New: `lib/fy.ts` (+ test), `lib/dal/pricing-master.ts`, `app/(app)/pricing/page.tsx`,
`app/(app)/pricing/actions.ts`, `components/pricing/pricing-master.tsx`,
`drizzle/0019_fy_batch_labels.sql`.
Modified: `lib/dal/rollover.ts` (+ test), `app/(app)/new-year/actions.ts`,
`components/year/rollover-wizard.tsx`, `components/accounts/cohort-editor.tsx`,
`components/accounts/detail-tabs.tsx`, `components/accounts/invoice-ladder.tsx`,
`components/shell/sidebar.tsx`, `drizzle/meta/_journal.json`.
