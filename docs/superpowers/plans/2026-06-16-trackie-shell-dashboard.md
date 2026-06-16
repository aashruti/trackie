# Trackie — App Shell + Dashboard Implementation Plan

> **For agentic workers:** execute task-by-task. UI tasks verify via `npm run build` + a preview screenshot rather than unit tests; engine/DAL tasks use Vitest.

**Goal:** Build the authenticated app shell (sidebar + top bar) and the portfolio Dashboard (KPIs, GST/TDS set-aside reserves, charts, all-accounts table) on the existing foundation, reading real seeded data through the RBAC-scoped DAL.

**Architecture:** A Next.js route group `app/(app)/` holds the authenticated shell layout; `/dashboard` lives inside it. A new portfolio DAL aggregates `computeAccount` rollups (incl. reserve figures) per the caller's scope. Charts are hand-rolled SVG (no chart lib) using the design tokens. Naming uses **Accounts** (universities + programmes).

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (design tokens), Drizzle DAL, Vitest. Visual source of truth: `_design_export/Trackie.dc.html`.

**Confirmed money rules (from spec §3):** profit = price-diff; advance = uni-funded pass-through (only its TDS is a cost); GST & TDS shown as **set-aside reserves**, never in profit.

---

## File Structure
```
lib/money/compute.ts          # + reserve rollups on AccountComputed
lib/money/types.ts            # + reserve fields
lib/dal/portfolio.ts          # getPortfolioForUser(): totals, reserves, rows, chart data
components/ui/card.tsx         # Card, CardHeader primitives
components/ui/badge.tsx        # StatusBadge (status → tone)
components/ui/money.tsx        # <Money> tabular figure, color by sign/role
components/shell/sidebar.tsx   # logo, nav, Team board "Soon"
components/shell/topbar.tsx    # year selector (static FY26–27), search, user menu
components/shell/logo.tsx      # Trackie wordmark + mark (inline SVG, gold)
components/dashboard/kpi-card.tsx
components/dashboard/reserves-strip.tsx
components/dashboard/charts/{collections-bars,margin-by-oem,aging}.tsx
components/dashboard/accounts-table.tsx
app/(app)/layout.tsx          # shell (auth-gated) wrapping children
app/(app)/dashboard/page.tsx  # moved from app/dashboard; renders Dashboard
app/dashboard/                # removed (moved into (app))
```

---

## Task 1: Reserve rollups in the money engine (TDD)

**Files:** `lib/money/types.ts`, `lib/money/compute.ts`, `lib/money/compute.test.ts`

- [ ] **Step 1: Failing test** — append to `compute.test.ts`:
```ts
describe("computeAccount reserves", () => {
  it("surfaces GST/TDS set-aside figures", () => {
    const a = computeAccount([
      { category: "new", semester: "none", students: 180, priceToUni: 21200, priceToDatagami: 18500, gstRate: 0.18, tdsRate: 0.10, advanceAdj: 1_000_000, status: "raised", payments: [] },
      { category: "advance", semester: "none", students: 1, priceToUni: 1_000_000, priceToDatagami: 1_000_000, gstRate: 0.18, tdsRate: 0.10, status: "raised", payments: [] },
    ]);
    expect(a.netGst).toBe(267_480);             // gstIn - gstOut on the new invoice (advance nets to 0)
    expect(a.advanceTdsCost).toBe(100_000);     // advance × tds
    expect(a.tdsReceivable).toBeGreaterThan(0); // uni-withheld TDS (asset)
  });
});
```
- [ ] **Step 2:** `npm test lib/money/compute.test.ts` → FAIL (fields undefined).
- [ ] **Step 3:** Add to `AccountComputed` in `types.ts`: `netGst: number; tdsReceivable: number; tdsPayable: number; advanceTdsCost: number;`
- [ ] **Step 4:** In `computeAccount`, add: `netGst: sum("gstDiff")`, `tdsReceivable: sum("tdsIn")`, `tdsPayable: sum("tdsOut")`, `advanceTdsCost: sum("advanceTdsCost")`.
- [ ] **Step 5:** `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: reserve rollups (netGst, tds, advance TDS) on computeAccount`.

## Task 2: Portfolio DAL

**Files:** `lib/dal/portfolio.ts`

- [ ] **Step 1:** Implement `getPortfolioForUser(user, yearLabel)` building on `listAccountsForUser`-style scoping, returning:
  - `totals`: billed, received, outstanding, payable, netMargin (Σ over accounts)
  - `reserves`: netGst, tdsReceivable, tdsPayable, advanceTdsCost
  - `counts`: accounts, openInvoices (outstanding>1), negativeMargin (hasNegative)
  - `rows`: per-account { id, name, oem, billed, received, outstanding, netMargin, hasNegative, status }
  - `marginByOem`: [{ oem, margin }] grouped
  - `aging`: buckets { current, d31_60, d61_90, d90plus } from invoice status/outstanding (overdue→90+, else current — matches prototype's coarse bucketing)
  Reuse the account+invoice query, compute via `computeAccount`, aggregate. Scope with `scopeAccountIds` exactly like `listAccountsForUser`.
- [ ] **Step 2:** Quick check via `tsx` scratch (or rely on Task 8 page render). Commit `feat: portfolio DAL aggregating rollups + reserves + chart data`.

## Task 3: UI primitives

**Files:** `components/ui/card.tsx`, `badge.tsx`, `money.tsx`
- [ ] Card: `rounded-xl border border-border bg-surface shadow-sm`. Badge: maps `statusMeta` tone→token classes (positive/pending/negative/info/neutral subtle bg + text). Money: `<span className="tabular">` with color by sign (negative→`text-[var(--negative-text)]`) or explicit `tone` prop; uses `fmt`/`fmtCompact`.
- [ ] Build check + commit `feat: UI primitives (Card, StatusBadge, Money)`.

## Task 4: App shell (route group + sidebar + topbar + logo)

**Files:** `app/(app)/layout.tsx`, `components/shell/{sidebar,topbar,logo}.tsx`; move `app/dashboard` → `app/(app)/dashboard`
- [ ] **Logo:** inline SVG — gold geometric "tracked value" mark (a rising node-path) + "Trackie" wordmark in `--text-primary`.
- [ ] **Sidebar (264px):** logo top; nav groups — Overview: Dashboard, Accounts, Reports, New year setup; Workspace: Team board (disabled, "Soon" pill). Active item: `bg-primary-subtle text-primary`. Uses `usePathname` (client) for active state.
- [ ] **Topbar (60px):** left = page title; right = academic-year selector (static "FY26–27" for now), a search affordance (visual), user menu (name + role badge + Sign out via server action).
- [ ] **`(app)/layout.tsx`:** server component; `const session = await auth()`; if no session redirect `/login`; render `<div class="flex"><Sidebar/><div class="flex-1"><Topbar user/><main>{children}</main></div></div>`.
- [ ] Move dashboard page into the group; delete old `app/dashboard`. Build check; preview screenshot; commit `feat: authenticated app shell (sidebar, topbar, Trackie logo)`.

## Task 5: Dashboard KPIs + reserves strip

**Files:** `components/dashboard/kpi-card.tsx`, `reserves-strip.tsx`, `app/(app)/dashboard/page.tsx`
- [ ] KPI cards (5): Total billed, Received in bank (positive tone), Outstanding (pending tone), Payable to OEMs (info tone), Net margin. Each: label, big tabular value (`fmtCompact`), sublabel.
- [ ] Reserves strip: a distinct bordered panel titled "Set aside for government" with Net GST, TDS receivable, TDS payable, Advance TDS cost — visually separated from profit (muted/info treatment) so it's clearly NOT profit.
- [ ] Page fetches `getPortfolioForUser(session.user, "FY26–27")`. Build + preview screenshot; commit.

## Task 6: Dashboard charts (SVG)

**Files:** `components/dashboard/charts/{collections-bars,margin-by-oem,aging}.tsx`
- [ ] Three small card charts using tokens (no lib):
  - Collections vs outstanding — grouped bars (use received vs outstanding by OEM, or totals; label "₹ in lakh").
  - Margin by OEM — horizontal bars from `marginByOem`.
  - Receivables aging — stacked/segmented bar from `aging` buckets.
- [ ] Build + preview screenshot; commit `feat: dashboard charts (collections, margin by OEM, aging)`.

## Task 7: All-accounts table

**Files:** `components/dashboard/accounts-table.tsx`
- [ ] Columns: Account, OEM, Billed, Received, Outstanding, Net margin, Status. Money right-aligned tabular; negative margin in red with a small "loss" flag; status via StatusBadge; row links to `/accounts/[id]` (route stub OK — 404 acceptable this milestone, or link disabled). Header sticky, row hover `bg-surface-hover`.
- [ ] Build + preview screenshot; commit `feat: all-accounts summary table`.

## Task 8: Integrate + verify live

- [ ] Compose the Dashboard page: KPIs → reserves strip → charts row → accounts table.
- [ ] `npm run build` green; `npm test` green; preview: log in, screenshot the full dashboard; confirm real seeded numbers (21 accounts; grand margin ≈ ₹3.77 Cr).
- [ ] Commit `feat: portfolio dashboard wired to seeded data`.

---

## Roadmap (next plans)
Accounts list (filters/search/CSV) → Account Detail hero (Flow/Ladder/Statement + reserves) → Edit invoice + payment ledger → Reports → Year wizard → User/assignment admin.
