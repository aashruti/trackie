# Trackie — Design Spec

**Date:** 2026-06-16
**Status:** Approved scope, implementation starting
**Owner:** Datagami (kunalsharma.ks13@gmail.com)

## 1. Purpose

Trackie is Datagami's internal **collections & payments tracker**. Datagami is a
sales partner of OEMs (IBM, AAFM, and future OEMs). It closes accounts
(universities / programmes); the account pays Datagami, and Datagami pays the
OEM, keeping a margin. Trackie captures **every rupee** flowing through
Datagami's account — collections from accounts, payments to OEMs, GST, TDS,
advances, and net margin — per **account**, per **academic year**.

A future internal **team task board** (account deliverables) is out of scope for
now; the nav reserves a "Team board · Soon" slot.

## 2. Domain model

Money is a 3-party pass-through: **Account → Datagami → OEM**; Datagami keeps the
margin.

The **atomic billable unit is an Invoice**. Invoices are grouped by category
(advance / old / new) and split by semester where the account bills per semester.

### Entities
- **OEM** — `id`, `name` (IBM, AAFM, …).
- **Account** — `id`, `name`, `type` (university | programme), `city`, `oemId`.
- **AcademicYear** — e.g. "FY25–26".
- **Invoice** — belongs to (account, academicYear). The atomic unit:
  - `category` — `advance | old | new`
  - `semester` — `none | 1 | 2`  (yearly billing = `none`; sem-split = `1` & `2`)
  - `students`, `priceToUni`, `priceToDatagami`
  - `gstRate` (default 0.18), `tdsRate` (default 0.10) — overridable per invoice
  - `advanceAdj` — advance netted against this invoice's OEM payable
  - `invoiceDate`, `status` (draft | raised | partially-paid | paid | overdue)
- **Cohort** — belongs to an Invoice (used by `old` category): `enrollmentYear`,
  `count`. The cohort counts **sum to the invoice's `students`** total. Stored
  for detail/reporting; the money math uses the total only.
- **Payment** — belongs to an Invoice: `date`, `amount`, `mode`
  (RTGS | NEFT | IMPS | UPI | Cheque), `ref`, `direction` (receipt | oem-payment).
- **User** — `id`, `name`, `email`, `passwordHash`, `role`
  (super-admin | admin | viewer).
- **UserAccount** — assignment join (userId, accountId) for per-account scoping.

## 3. Financial math (CLEAN ENGINE — authoritative)

The prototype's math was a UI approximation and the source Excel is internally
inconsistent (per-sheet formula variants + an advance double-count, see §3.2).
Trackie uses **one clean, consistent definition**, validated against the Excel.

### 3.0 Confirmed business facts (decide the model)
1. **Advance is university-funded.** The university pays Datagami the advance; it
   is forwarded to the OEM as-is. A round-trip pass-through that nets to zero —
   the only real cost is the TDS Datagami fronts on it (§3.1).
2. **Universities pay GST on top** (billed taxable + 18% GST). GST is the
   government's money passing through Datagami, **not a cost** — it never reduces
   profit. The net GST remittance is a cash-timing reserve only.
3. **GST and TDS are displayed as separate "set aside" reserve lines** on every
   account (so the team knows what cash to hold for govt), but they sit in a
   reserves section — NOT subtracted from profit.

> These facts confirm the clean engine. The source Excel's negative "Net To
> Datagami" values are artifacts of (a) subtracting the advance out-leg without
> the matching uni-funded in-leg, and (b) treating GST/TDS as costs even though
> the university pays GST on top. Trackie does neither.

### 3.1 Per-invoice ladder

**Core rule (per Datagami):** profit is ALWAYS `students × (priceToUni −
priceToDatagami)`. The advance is a **token pass-through** (university → Datagami
→ OEM); it affects cash paid to the OEM but **never** affects profit.

```
taxableIn   = students × priceToUni
gstIn       = taxableIn × gstRate
billing     = taxableIn + gstIn
tdsIn       = taxableIn × tdsRate                 // creditable timing item, tracked separately
afterTds    = billing − tdsIn
received    = Σ receipt payments
outstanding = afterTds − received

taxableOut  = students × priceToDatagami          // FULL (no advance netting here)

// Advance is the ONLY out-of-pocket cost: the advance is transferred to the OEM
// as-is, so Datagami fronts the TDS on it. Student invoices net only the price
// difference, so their TDS is pass-through (comes out of margin, never invested).
advanceTdsCost = (category === "advance") ? taxableIn × tdsRate : 0

netMargin   = taxableIn − taxableOut − advanceTdsCost
              //  student: students × (priceToUni − priceToDatagami); <0 only when
              //           priceToDatagami > priceToUni (real loss → red)
              //  advance: 0 − (advance × tdsRate)  →  always a small negative cost

// OEM cash payable — the advance is a token netted PRE-tax off the OEM amount:
oemTaxableNet = taxableOut − advanceAdj
gstOut        = oemTaxableNet × gstRate
tdsOut        = oemTaxableNet × tdsRate
payable       = oemTaxableNet + gstOut − tdsOut

gstDiff     = gstIn − gstOut
```
- `advanceAdj` is attached to whichever student invoice the advance nets against
  (varies per account — new-student in Pillai, old-student in BVDU). The **advance
  invoice itself** (category `advance`) carries the `advanceTdsCost` as its margin.
- Student TDS (in/out) is creditable/pass-through and surfaced separately, never
  in `netMargin`. Only the advance's TDS is an out-of-pocket cost.
- Account rollups = sum of invoice fields. `hasNegative` = any **non-advance**
  invoice with `netMargin < 0` (genuine below-cost sales only, e.g. Kaveri); the
  advance's structural negative TDS cost does NOT trip the red flag.

### 3.2 Reconciliation against the Excel (build-time, one-off)
A reconciliation script compares engine output to every source sheet:
- Unambiguous figures (taxableIn, gstIn, billing, tdsIn, afterTds, taxableOut,
  payable, gstDiff) **must match the Excel to the rupee**.
- `netMargin = students × (priceToUni − priceToDatagami)` is the definition of
  record. The Excel's `Net To Datagami` differs because it folded the advance
  token into the margin (an artifact); the reconcile report shows both side by
  side so the difference is explained, not silently dropped. Genuine negative
  margins (priceToDatagami > priceToUni, e.g. Kaveri) must reconcile as real.

### Status rules
- Account status: `overdue` if any invoice overdue; else `paid` if outstanding ≤
  ₹1; else `partially-paid` if received > 0; else `raised`.
- On adding a receipt: `paid` if received ≥ afterTds − 1; else `partially-paid`
  if received > 0; else unchanged.

### Formatting (India)
- Full: `₹` + `en-IN` grouping, minus sign `−`, rounded.
- Compact: ≥1Cr → `Cr`, ≥1L → `L`, ≥1K → `K`.
- Tabular numerals (IBM Plex Mono), right-aligned.

## 4. Scenario catalog (observed across all 21 accounts in source Excel)

The model above is designed to cover every variation found in the data:

1. **Yearly vs semester billing** — most bill yearly (`semester: none`); Amity,
   Kalinga, Medicaps, Sri Sai, DG Prog bill per semester (`1` + `2`), each with
   its own date, receipts, and advance adjustment.
2. **Optional streams** — Advance+New only (Pillai, Raisoni, Amity, Kaveri,
   Indira, Sankalchand) vs Advance+Old+New (rest). Invoices are optional per
   account/year; never assume all categories exist.
3. **Multi-year old cohorts** — old-student count rolls up 2–5 enrollment years
   (Sri Sri, Sri Sai = 5; Kalinga = 4). Stored as `Cohort` rows.
4. **Advance variance** — ₹5L / ₹10L / ₹20L / ₹0 / absent (C.V. Raman, Transs
   Mumbai, DG Prog). Optional, netted via `advanceAdj`.
5. **Multi-OEM** — IBM (universities), AAFM (DG Programme); OEM drives the
   "Payable to ___" label and payout.
6. **Negative-margin invoices** — Pillai, Kaveri, BVDU, SGSU, UOW, Transs Ahme;
   surfaced in red, never hidden.
7. **Per-invoice pricing** — price-to-Datagami can differ from price-to-uni and
   differ old-vs-new; always stored per invoice.
8. **Per-semester invoice dates & OEM payout** — Kalinga's two semesters differ
   in date and advance timing.
9. **Account ≠ always a university** — programmes (Medicaps DG Programme) modeled
   via `Account.type`.
10. **Multiple receipts per invoice** — payment ledger (many receipts), not a
    single received figure.
11. **GST/TDS overrides** — defaults 18/10, editable per invoice.

## 5. Access control (RBAC)

| Role | Accounts | Financial edits | User mgmt & assignments |
|------|----------|-----------------|------------------------|
| **Super Admin** | All | All | Manage users + assign accounts |
| **Admin** | Only assigned | On assigned only | No |
| **Viewer** | Only assigned | Read-only | No |

- Scope is **per-account** via `UserAccount`. Super Admin sees all.
- Only **Super Admin** manages users and assignments.
- Enforced in the data-access layer (every query filters by the caller's allowed
  account set) AND in the UI (hide/disable edits for Viewer + unassigned).

## 6. Stack

- **Next.js** (App Router) + **TypeScript**; Vercel target, **local-first** dev
  against **local Postgres**.
- **Auth.js (NextAuth)** credentials, users/sessions in local Postgres.
- **Postgres** via ORM (Drizzle vs Prisma — decided in the plan).
- **Tailwind CSS + shadcn/ui**, themed from the provided Trackie design system
  (`_design_export/_ds/...`): gold brand accent, slate neutrals, semantic money
  colors, Hanken Grotesk + IBM Plex Mono.

## 7. Screens (from approved high-fidelity prototype)

1. **App shell** — sidebar (logo, nav: Dashboard, Accounts, Reports, New year
   setup; "Team board · Soon"), top bar (year selector, search, user).
2. **Dashboard** — KPI cards (Total billed, Received, Outstanding, Payable to
   OEMs, Net margin), charts (collections vs outstanding, margin by OEM, aging),
   all-accounts summary; negative margins flagged.
3. **Accounts list** — filter (OEM, status) + search; CSV export; add account.
4. **Account detail (hero)** — per account+year: Flow / Ladder / Statement views
   exposing inflow → outflow → margin and the advance-adjustment; per-semester
   invoices; quick actions Record receipt / Pay OEM / Edit invoice.
5. **Edit invoice** — cohort & pricing, GST/TDS overrides, date, status,
   advanceAdj; **live recompute** as you type.
6. **Record receipt / Pay OEM** — dialog logging a ledger entry; outstanding +
   status update live.
7. **Reports** — margin by account/OEM, GST, TDS, receivables aging; PDF/CSV.
8. **New academic year wizard** — pick account → clone invoices/prices forward →
   edit counts → review projected billing/margin → create as Draft.
9. **States** — empty / loading / error.

## 8. Build approach

Full app, built **incrementally**:
scaffold → design-system theming → data layer + money engine + tests → seed from
Excel → auth + RBAC → shell → Dashboard → Accounts → Account detail → Edit +
payments → Reports → Year wizard. Checkpoint after the data+auth foundation.

## 9. Out of scope (now)

Team task board; bank-feed integration; multi-currency; accounting-grade
double-entry; automated invoice PDF generation (export affordance only).

## 10. Assumptions

- Admins cannot manage assignments (Super Admin only).
- ORM (Drizzle vs Prisma) decided in the plan.
- Seed imports the 21 accounts from the source Excel during the data-layer step.
