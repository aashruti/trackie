# Trackie — Accounts List + Account Detail Implementation Plan

**Goal:** Build the Accounts list (search, OEM/status filters, pagination, CSV) and the Account Detail hero (Flow / Ladder / Statement views with the full inflow→outflow→margin ladder, advance adjustment, and per-account reserves), on the existing shell + DAL.

**Architecture:** Server pages fetch RBAC-scoped data; an interactive client table handles search/filter/pagination in-browser (21 rows). Account detail uses a new `getAccountDetail` DAL returning the account + fully-computed invoices. Tabs are a small client component.

**Verification:** build + Vitest for DAL; live preview interaction testing (type search, toggle filters, click pagination, open a detail page, switch tabs) per the user's request to test pagination etc.

**Money rules:** profit = price-diff; advance uni-funded pass-through (only its TDS is a cost); GST/TDS shown as set-aside reserves, never profit.

---

## Task A1: Account-detail DAL (TDD)
**Files:** `lib/dal/account-detail.ts`, `lib/dal/account-detail.test.ts`
- [ ] `getAccountDetail(user, accountId, yearLabel)` → `{ id, name, type, oem, status, totals, reserves, invoices: InvoiceComputed[] }` or `null` if out of scope. Enforce scope: super-admin any; admin/viewer only assigned (use `assignedIds` + `scopeAccountIds` → 404/null if not allowed).
- [ ] Test (integration, seeded): Pillai detail for super-admin has advance+new invoices, netMargin 386000; an admin not assigned gets null.
- [ ] Build + commit.

## Task A2: Accounts list DAL reuse
**Files:** `lib/dal/accounts.ts` (already returns rows). Confirm fields include oem + hasNegative (they do). No change unless missing.

## Task A3: Interactive accounts table (client)
**Files:** `components/accounts/accounts-explorer.tsx`
- [ ] Client component taking all rows. State: query, oem filter (All/IBM/AAFM/…derived), status filter (All/Raised/Partially Paid/Paid/Overdue), page (10/page). Renders search input, two selects, the table (reuse columns), and a pager (Prev/Next + "x–y of N"). Filtering + pagination in-browser. Empty state when no matches.
- [ ] Build.

## Task A4: Accounts list page
**Files:** `app/(app)/accounts/page.tsx`
- [ ] Server: fetch `listAccountsForUser(user, YEAR)`; render Topbar "Accounts" + `<AccountsExplorer rows/>` with CSV export (client-side blob) + "Add account" (disabled, "Soon").
- [ ] Build; **live test**: search "kal", filter OEM=AAFM, status=Raised, paginate. Commit.

## Task A5: Account Detail — header + reserves + KPIs
**Files:** `app/(app)/accounts/[id]/page.tsx`, `components/accounts/account-header.tsx`
- [ ] Server page: `getAccountDetail`; if null → `notFound()`. Header: back link, name, OEM, type, status badge; KPI row (Billed, Received, Outstanding, Net margin). Reserves strip (reuse). 
- [ ] Build; live test open from table. Commit.

## Task A6: Account Detail — invoice ladder (Ladder view)
**Files:** `components/accounts/invoice-ladder.tsx`
- [ ] Per invoice: a card titled `<category> · <semester>` with two columns — **Inflow (Uni→Datagami):** taxableIn, +GST, billing, −TDS, afterTds, received, outstanding; **Outflow (Datagami→OEM):** taxableOut, −advance, =oemTaxableNet, +GST, −TDS, payable; and a **Net margin** footer (+ advance TDS note for advance rows). Advance adjustment shown explicitly. Money tabular, signs colored.
- [ ] Build; live test. Commit.

## Task A7: Account Detail — tabs (Flow / Ladder / Statement)
**Files:** `components/accounts/detail-tabs.tsx`
- [ ] Client tabs. **Ladder** = A6 (default). **Flow** = compact Uni→Datagami→OEM visual per stream (3 figures). **Statement** = flat table (one row per invoice: category, billed, received, outstanding, payable, margin).
- [ ] Build; **live test**: switch all three tabs, screenshot each. Commit.

## Task A8: Integrate + full live regression
- [ ] `npm test` + `npm run build` green. Live: dashboard → click account → detail tabs → back → accounts list → filter/paginate. Screenshot key states. Commit.

## Roadmap next
Edit invoice + payment ledger (fills "Received") → Reports → Year wizard → User/assignment admin.
