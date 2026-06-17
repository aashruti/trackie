# Trackie — Year Switching, Invoice Editor, New-Year Wizard

**Goal:** Let users (a) switch academic years across the app, (b) edit invoice numbers with live recompute (persisted, RBAC-guarded), and (c) roll a year forward into a new Draft year while fully retaining prior-year history.

**Architecture:** Years are first-class (`academic_years`); invoices are keyed by `yearId`, so rollover = new invoice rows, old untouched. Current year is a sticky **cookie** resolved server-side. Mutations are **server actions** guarded by `canEdit`. The editor recomputes live in the browser via the pure `computeInvoice`.

**RBAC:** edit/rollover require `canEdit(user, accountId)` (super-admin any; admin assigned; viewer never).

---

## Y1 — Years DAL + current-year resolver
**Files:** `lib/dal/years.ts`
- `listYears()` → `{id,label}[]` sorted desc. `latestYearLabel()`. `getCurrentYear()` reads the `trackie-year` cookie, validates against existing years, falls back to latest.
- Commit.

## Y2 — Wire current year + year selector
**Files:** `components/shell/year-selector.tsx` (client), `app/(app)/actions.ts` (`setYearAction`), update dashboard/accounts/detail pages + Topbar to use `getCurrentYear()` and render `<YearSelector>`.
- `setYearAction(year, pathname)`: set cookie, `redirect(pathname)`.
- Live test: switch year (only FY26–27 until rollover exists).
- Commit.

## Y3 — Invoice editor (TDD on DAL)
**Files:** `lib/dal/mutations.ts` (`updateInvoice`), `lib/dal/mutations.test.ts`, `app/(app)/accounts/[id]/actions.ts` (`updateInvoiceAction`), `components/accounts/invoice-editor.tsx` (client, live recompute), wire an "Edit" affordance on the detail Ladder.
- `updateInvoice(user, invoiceId, fields)`: load invoice→account, `canEdit` or throw; update students/prices/rates/advanceAdj/invoiceDate/status; return ok.
- Editor: client form; recomputes inflow/outflow/margin with `computeInvoice` as you type; Save → server action → revalidate.
- Test: super-admin edits students→recompute persists; viewer/unassigned rejected.
- Live test: change Pillai new students 180→200, see margin update + persist. Commit.

## Y4 — New-Year wizard (TDD on rollover)
**Files:** `lib/dal/rollover.ts` (`rolloverYear`), `lib/dal/rollover.test.ts`, `app/(app)/new-year/page.tsx` + `new-year/actions.ts` + `components/year/rollover-wizard.tsx` (client).
- `rolloverYear(user, fromLabel, toLabel, counts)`: create target year if missing; for each account the user canEdit, clone its `from` invoices (+cohorts) into `to` as status `draft`, applying edited student counts; skip if target already has invoices (idempotent). Prior year untouched.
- Wizard: pick source (current) → target label → table of accounts/invoices with editable counts → review (projected billing/margin via `computeInvoice`) → "Create <year> as Draft".
- Test: rollover FY26–27→FY27–28 clones invoices as draft; FY26–27 invoice count unchanged (history retained).
- Live test: run rollover, switch to FY27–28 (Draft), switch back to FY26–27 (intact). Commit.

## Y5 — Integrate + regression
- `npm test` + build green. Live: edit a number, switch years, roll over, confirm history retained. Commit.
