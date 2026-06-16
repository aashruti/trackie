# Trackie Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Trackie foundation — project scaffold, design-system theming, Postgres schema, the validated money engine, Excel-seeded data, and Auth.js role-based access — so screens can be built on a proven, books-accurate base.

**Architecture:** Next.js (App Router) + TypeScript on a local Postgres via Drizzle ORM. A pure-function **money engine** (`lib/money/`) holds all financial math (no DB/UI deps) and is unit-tested against real figures from the source Excel. A one-off **reconciliation script** diffs the engine against every sheet and reports mismatches for sign-off. Auth.js (credentials) stores users/sessions in Postgres; a **data-access layer** (`lib/dal/`) enforces per-account RBAC so no query bypasses scope.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM + `drizzle-kit`, `postgres` (driver), Auth.js v5 (NextAuth) credentials + `bcryptjs`, Vitest, `tsx`, `xlsx` (seed import).

**Scope:** This plan is the FOUNDATION milestone only. Screens (Dashboard, Accounts, Account Detail, Edit/Payments, Reports, Year Wizard) are follow-on plans — see "Roadmap" at the end. The foundation is independently testable: `npm test` passes, `npm run db:seed` loads 21 accounts, `npm run reconcile` prints a clean/flagged report, and login enforces roles.

**Source of truth references:**
- Spec: `docs/superpowers/specs/2026-06-16-trackie-design.md`
- Design system tokens: `_design_export/_ds/trackie-design-system-25ca2191-41f9-4a8d-be9d-16c054d86c02/tokens/*.css`
- Approved prototype (layout + sample data only — NOT math): `_design_export/Trackie.dc.html`
- Source workbook: `/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx`

---

## File Structure

```
trackie/
  package.json, tsconfig.json, next.config.ts, .env.local, .gitignore
  vitest.config.ts
  drizzle.config.ts
  app/
    layout.tsx                 # root layout, fonts, <html> theme class
    globals.css                # imports design-system tokens + Tailwind
    page.tsx                   # temporary redirect to /dashboard (placeholder)
    api/auth/[...nextauth]/route.ts
  lib/
    money/
      types.ts                 # InvoiceInput, InvoiceComputed, AccountComputed
      compute.ts               # computeInvoice, computeAccount  (PURE)
      format.ts                # fmt (₹ full), fmtCompact (L/Cr), statusMeta
      compute.test.ts
      format.test.ts
    db/
      schema.ts                # Drizzle tables
      client.ts                # db connection (server-only)
      enums.ts                 # role/category/semester/status/mode/direction
    dal/
      accounts.ts              # scoped account queries (RBAC enforced)
      accounts.test.ts
      authz.ts                 # allowedAccountIds(user), assertCanEdit(user, accountId)
      authz.test.ts
    auth/
      config.ts                # Auth.js options (credentials provider)
      password.ts              # hash/verify
  scripts/
    seed.ts                    # parse Excel → insert OEMs/accounts/invoices/cohorts/payments
    reconcile.ts               # diff engine vs Excel → console report
    excel-parse.ts             # shared sheet→InvoiceInput parser (used by seed + reconcile)
    excel-parse.test.ts
  components/ui/               # shadcn primitives (added on demand)
```

**Boundaries:** `lib/money/*` is pure (no imports from `db`/`next`). `lib/dal/*` is the ONLY place that reads/writes account data and ALWAYS takes a `user` to scope. `scripts/excel-parse.ts` is shared so seed and reconcile read the workbook identically.

---

## Task 1: Scaffold Next.js + TypeScript + Tailwind

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`

- [ ] **Step 1: Initialize the app non-interactively**

Run:
```bash
cd /Users/kunalsharma/datagami/trackie
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --eslint --yes
```
Expected: project files created in the current (non-empty) dir. If it refuses due to existing files (`_design_export`, `docs`), move them aside first: `mkdir -p .keep && mv _design_export docs .keep/`, run create-next-app, then `mv .keep/_design_export .keep/docs . && rmdir .keep`.

- [ ] **Step 2: Verify dev server boots**

Run: `npm run build`
Expected: build completes with no errors (a default page).

- [ ] **Step 3: Initialize git and commit the scaffold**

Run:
```bash
git init && git add -A && git commit -m "chore: scaffold Next.js + TS + Tailwind app"
```
Expected: initial commit created. (Confirm `.gitignore` includes `.env*`, `node_modules`, `.next`.)

---

## Task 2: Wire the Trackie design-system tokens

**Files:**
- Create: `app/tokens/` (copy of the 6 token CSS files)
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Copy the design-system token files into the app**

Run:
```bash
DS="_design_export/_ds/trackie-design-system-25ca2191-41f9-4a8d-be9d-16c054d86c02/tokens"
mkdir -p app/tokens && cp "$DS"/colors.css "$DS"/typography.css "$DS"/spacing.css "$DS"/fonts.css app/tokens/
```
Expected: `app/tokens/{colors,typography,spacing,fonts}.css` exist.

- [ ] **Step 2: Import tokens in `app/globals.css`**

Put these imports ABOVE the Tailwind directives in `app/globals.css`:
```css
@import "./tokens/fonts.css";
@import "./tokens/colors.css";
@import "./tokens/typography.css";
@import "./tokens/spacing.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: light; }
.dark { color-scheme: dark; }
body {
  background: var(--background);
  color: var(--text-primary);
  font-family: var(--font-sans);
}
.font-mono, .tabular { font-family: var(--font-mono); font-variant-numeric: var(--numeric-tabular); }
```

- [ ] **Step 3: Map tokens into Tailwind theme**

In `tailwind.config.ts`, extend the theme so semantic tokens are usable as classes:
```ts
import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: { colors: {
    background: "var(--background)", surface: "var(--surface)", border: "var(--border)",
    primary: { DEFAULT: "var(--primary)", fg: "var(--primary-fg)" },
    positive: "var(--positive)", negative: "var(--negative)", pending: "var(--pending)", info: "var(--info)",
    "text-primary": "var(--text-primary)", "text-secondary": "var(--text-secondary)", "text-muted": "var(--text-muted)",
  }}},
  plugins: [],
};
export default config;
```

- [ ] **Step 4: Verify build still succeeds**

Run: `npm run build`
Expected: build passes; no CSS import errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire Trackie design-system tokens into Tailwind"
```

---

## Task 3: Money engine — types + `computeInvoice` (TDD)

**Files:**
- Create: `lib/money/types.ts`, `lib/money/compute.ts`, `lib/money/compute.test.ts`, `vitest.config.ts`
- Modify: `package.json` (test script + deps)

- [ ] **Step 1: Install Vitest and add the test script**

Run: `npm i -D vitest`
Then add to `package.json` "scripts": `"test": "vitest run", "test:watch": "vitest"`.
Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["**/*.test.ts"], environment: "node" } });
```

- [ ] **Step 2: Write the failing test (real Pillai new-student figures)**

Create `lib/money/compute.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeInvoice } from "./compute";

// Pillai "New students" — verified against the source workbook.
const pillaiNew = {
  category: "new" as const, semester: "none" as const,
  students: 180, priceToUni: 21200, priceToDatagami: 18500,
  gstRate: 0.18, tdsRate: 0.10, advanceAdj: 1_000_000,
};

describe("computeInvoice", () => {
  it("computes the inflow ladder exactly (matches Excel)", () => {
    const c = computeInvoice(pillaiNew);
    expect(c.taxableIn).toBe(3_816_000);
    expect(c.gstIn).toBe(686_880);
    expect(c.billing).toBe(4_502_880);
    expect(c.tdsIn).toBe(381_600);
    expect(c.afterTds).toBe(4_121_280);
  });

  it("nets the advance token PRE-tax on the OEM payable only", () => {
    const c = computeInvoice(pillaiNew);
    expect(c.taxableOut).toBe(3_330_000);      // FULL: 180*18500 (used for margin)
    expect(c.oemTaxableNet).toBe(2_330_000);   // 3_330_000 - 1_000_000 advance token
    expect(c.gstOut).toBe(419_400);            // on the netted amount
    expect(c.tdsOut).toBe(233_000);
    expect(c.payable).toBe(2_516_400);         // 2_330_000 + 419_400 - 233_000  (matches Excel)
  });

  it("computes student profit as students × price-diff, advance-INDEPENDENT", () => {
    const c = computeInvoice(pillaiNew);          // category "new"
    expect(c.advanceTdsCost).toBe(0);             // student invoice → no out-of-pocket TDS
    expect(c.netMargin).toBe(486_000);            // 180 * (21200 - 18500)
    expect(c.gstDiff).toBe(267_480);
  });

  it("charges advance TDS to Datagami (advance × tdsRate) as a negative margin", () => {
    const advance = { category: "advance" as const, semester: "none" as const,
      students: 1, priceToUni: 1_000_000, priceToDatagami: 1_000_000, gstRate: 0.18, tdsRate: 0.10 };
    const c = computeInvoice(advance);
    expect(c.advanceTdsCost).toBe(100_000);       // 1_000_000 * 0.10
    expect(c.netMargin).toBe(-100_000);           // 0 (price-diff) − advance TDS
  });

  it("flags a genuine below-cost loss (priceToDatagami > priceToUni)", () => {
    const kaveriish = { ...pillaiNew, students: 100, priceToUni: 20_000, priceToDatagami: 21_000, advanceAdj: 0 };
    expect(computeInvoice(kaveriish).netMargin).toBe(-100_000);   // 100 * (20000-21000)
  });

  it("treats received/outstanding from the payment ledger", () => {
    const c = computeInvoice({ ...pillaiNew, payments: [{ amount: 2_000_000 }] });
    expect(c.received).toBe(2_000_000);
    expect(c.outstanding).toBe(2_121_280);     // afterTds - received
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `computeInvoice` is not defined / module not found.

- [ ] **Step 4: Define the types**

Create `lib/money/types.ts`:
```ts
export type Category = "advance" | "old" | "new";
export type Semester = "none" | "1" | "2";
export type Status = "draft" | "raised" | "partially-paid" | "paid" | "overdue";

export interface PaymentLite { amount: number }

export interface InvoiceInput {
  category: Category;
  semester: Semester;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number;          // 0.18 default
  tdsRate: number;          // 0.10 default
  advanceAdj?: number;      // amount netted off OEM taxable, pre-tax
  payments?: PaymentLite[]; // receipts only (direction handled upstream)
}

export interface InvoiceComputed extends InvoiceInput {
  taxableIn: number; gstIn: number; billing: number; tdsIn: number; afterTds: number;
  received: number; outstanding: number;
  taxableOut: number; oemTaxableNet: number; gstOut: number; tdsOut: number; payable: number;
  advanceTdsCost: number; gstDiff: number; tdsDiff: number; netMargin: number;
}
```

- [ ] **Step 5: Implement `computeInvoice`**

Create `lib/money/compute.ts`:
```ts
import type { InvoiceInput, InvoiceComputed } from "./types";

export function computeInvoice(i: InvoiceInput): InvoiceComputed {
  const adv = i.advanceAdj ?? 0;
  const taxableIn = i.students * i.priceToUni;
  const gstIn = taxableIn * i.gstRate;
  const billing = taxableIn + gstIn;
  const tdsIn = taxableIn * i.tdsRate;
  const afterTds = billing - tdsIn;
  const received = (i.payments ?? []).reduce((a, p) => a + p.amount, 0);
  const outstanding = afterTds - received;

  const taxableOut = i.students * i.priceToDatagami;        // FULL — used for margin
  const oemTaxableNet = taxableOut - adv;                   // advance token netted PRE-tax
  const gstOut = oemTaxableNet * i.gstRate;
  const tdsOut = oemTaxableNet * i.tdsRate;
  const payable = oemTaxableNet + gstOut - tdsOut;

  // Advance is the only out-of-pocket cost: Datagami fronts the TDS on the
  // as-is advance transfer. Student invoices net only the price difference.
  const advanceTdsCost = i.category === "advance" ? taxableIn * i.tdsRate : 0;

  const gstDiff = gstIn - gstOut;
  const tdsDiff = tdsIn - tdsOut;
  const netMargin = taxableIn - taxableOut - advanceTdsCost;

  return { ...i, advanceAdj: adv, taxableIn, gstIn, billing, tdsIn, afterTds,
    received, outstanding, taxableOut, oemTaxableNet, gstOut, tdsOut, payable,
    advanceTdsCost, gstDiff, tdsDiff, netMargin };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 4 `computeInvoice` cases green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: money engine computeInvoice with pre-tax advance netting + tests"
```

---

## Task 4: Money engine — `computeAccount` rollup + status (TDD)

**Files:**
- Modify: `lib/money/compute.ts`, `lib/money/types.ts`
- Modify: `lib/money/compute.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/money/compute.test.ts`:
```ts
import { computeAccount, accountStatus } from "./compute";

describe("computeAccount", () => {
  const invoices = [
    { category: "advance" as const, semester: "none" as const, students: 1, priceToUni: 1_000_000, priceToDatagami: 1_000_000, gstRate: 0.18, tdsRate: 0.10, status: "paid" as const, payments: [{ amount: 1_080_000 }] },
    { category: "new" as const, semester: "none" as const, students: 180, priceToUni: 21200, priceToDatagami: 18500, gstRate: 0.18, tdsRate: 0.10, advanceAdj: 1_000_000, status: "overdue" as const, payments: [] },
  ];
  it("sums rollups; advance TDS reduces profit but does not trip hasNegative", () => {
    const a = computeAccount(invoices);
    expect(a.billing).toBe(1_180_000 + 4_502_880);
    expect(a.netMargin).toBe(-100_000 + 486_000); // advance −100k TDS + new students 486k = 386k
    expect(a.hasNegative).toBe(false);             // advance's structural negative is excluded
    expect(a.status).toBe("overdue");              // any overdue invoice → overdue
  });

  it("hasNegative is true for a genuine below-cost student invoice", () => {
    const a = computeAccount([
      { category: "old", semester: "none", students: 100, priceToUni: 20_000, priceToDatagami: 21_000, gstRate: 0.18, tdsRate: 0.10, status: "raised", payments: [] },
    ]);
    expect(a.hasNegative).toBe(true);
  });
});

describe("accountStatus", () => {
  it("paid when outstanding <= 1 and no overdue", () => {
    expect(accountStatus([{ status: "paid", outstanding: 0 }] as any)).toBe("paid");
  });
  it("partially-paid when some received but outstanding remains", () => {
    expect(accountStatus([{ status: "raised", outstanding: 500, received: 100 }] as any)).toBe("partially-paid");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `computeAccount`/`accountStatus` not exported.

- [ ] **Step 3: Add the `InvoiceWithStatus` + `AccountComputed` types**

Append to `lib/money/types.ts`:
```ts
export interface InvoiceInputWithStatus extends InvoiceInput { status: Status }
export interface AccountComputed {
  invoices: InvoiceComputed[];
  billing: number; received: number; outstanding: number; payable: number;
  netMargin: number; gstDiff: number; hasNegative: boolean; status: Status;
}
```

- [ ] **Step 4: Implement `computeAccount` + `accountStatus`**

Append to `lib/money/compute.ts`:
```ts
import type { InvoiceInputWithStatus, AccountComputed, Status } from "./types";

export function accountStatus(
  invoices: { status: Status; outstanding: number; received?: number }[]
): Status {
  if (invoices.some((s) => s.status === "overdue")) return "overdue";
  const outstanding = invoices.reduce((a, s) => a + s.outstanding, 0);
  if (outstanding <= 1) return "paid";
  const received = invoices.reduce((a, s) => a + (s.received ?? 0), 0);
  if (received > 0) return "partially-paid";
  return "raised";
}

export function computeAccount(inputs: InvoiceInputWithStatus[]): AccountComputed {
  const invoices = inputs.map((i) => ({ ...computeInvoice(i), status: i.status }));
  const sum = (k: keyof typeof invoices[number]) =>
    invoices.reduce((a, s) => a + (s[k] as number), 0);
  return {
    invoices,
    billing: sum("billing"), received: sum("received"), outstanding: sum("outstanding"),
    payable: sum("payable"), netMargin: sum("netMargin"), gstDiff: sum("gstDiff"),
    hasNegative: invoices.some((s) => s.category !== "advance" && s.netMargin < 0),
    status: accountStatus(invoices.map((s) => ({ status: s.status, outstanding: s.outstanding, received: s.received }))),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: computeAccount rollup + accountStatus with tests"
```

---

## Task 5: Money engine — Indian currency formatters (TDD)

**Files:**
- Create: `lib/money/format.ts`, `lib/money/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/money/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { fmt, fmtCompact, statusMeta } from "./format";

describe("fmt", () => {
  it("formats with en-IN grouping and ₹", () => { expect(fmt(4121280)).toBe("₹41,21,280"); });
  it("uses a real minus sign for negatives", () => { expect(fmt(-75600)).toBe("−₹75,600"); });
  it("renders em-dash for null/NaN", () => { expect(fmt(null as any)).toBe("—"); });
});
describe("fmtCompact", () => {
  it("crores", () => { expect(fmtCompact(45000000)).toBe("₹4.5Cr"); });
  it("lakhs", () => { expect(fmtCompact(412128)).toBe("₹4.1L"); });
  it("thousands", () => { expect(fmtCompact(75600)).toBe("₹76K"); });
});
describe("statusMeta", () => {
  it("maps status to [tone, label]", () => { expect(statusMeta("partially-paid")).toEqual(["pending", "Partially Paid"]); });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the formatters (ported from prototype, verified)**

Create `lib/money/format.ts`:
```ts
import type { Status } from "./types";

export function fmt(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0, abs = Math.abs(Math.round(v));
  return `${neg ? "−" : ""}₹${new Intl.NumberFormat("en-IN").format(abs)}`;
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const neg = v < 0, abs = Math.abs(v); let out: string;
  if (abs >= 1e7) out = (abs / 1e7).toFixed(abs >= 1e8 ? 0 : 2).replace(/\.00$/, "") + "Cr";
  else if (abs >= 1e5) out = (abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "L";
  else if (abs >= 1e3) out = (abs / 1e3).toFixed(0) + "K";
  else out = String(Math.round(abs));
  return `${neg ? "−" : ""}₹${out}`;
}

const STATUS: Record<Status, [string, string]> = {
  draft: ["neutral", "Draft"], raised: ["info", "Raised"],
  "partially-paid": ["pending", "Partially Paid"], paid: ["positive", "Paid"],
  overdue: ["negative", "Overdue"],
};
export function statusMeta(s: Status): [string, string] { return STATUS[s] ?? STATUS.draft; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS. (If `fmtCompact(412128)` rounds to `4.1L` vs `4.12L`, adjust the expectation to match the prototype's 1-decimal lakh rule — the implementation above is the source of truth.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Indian currency formatters + status meta with tests"
```

---

## Task 6: Postgres schema + Drizzle client

**Files:**
- Create: `drizzle.config.ts`, `lib/db/enums.ts`, `lib/db/schema.ts`, `lib/db/client.ts`, `.env.local`
- Modify: `package.json` (db scripts + deps)

- [ ] **Step 1: Install Drizzle + driver**

Run: `npm i drizzle-orm postgres && npm i -D drizzle-kit tsx`

- [ ] **Step 2: Add DB env + scripts**

Create `.env.local` (local Postgres.app — verified connection, trust auth, no password):
```
DATABASE_URL=postgres://kunalsharma@localhost:5432/trackie
AUTH_SECRET=dev-secret-change-me
```
Add to `package.json` "scripts":
```
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:push": "drizzle-kit push",
"db:seed": "tsx scripts/seed.ts",
"reconcile": "tsx scripts/reconcile.ts"
```

- [ ] **Step 3: Create the DB database** — ALREADY DONE

The `trackie` database was created and the connection verified
(`postgres://kunalsharma@localhost:5432/trackie`). No action needed; if missing,
run `createdb trackie`.

- [ ] **Step 4: Define enums + schema**

Create `lib/db/enums.ts`:
```ts
export const ROLES = ["super-admin", "admin", "viewer"] as const;
export const CATEGORIES = ["advance", "old", "new"] as const;
export const SEMESTERS = ["none", "1", "2"] as const;
export const STATUSES = ["draft", "raised", "partially-paid", "paid", "overdue"] as const;
export const MODES = ["RTGS", "NEFT", "IMPS", "UPI", "Cheque"] as const;
export const DIRECTIONS = ["receipt", "oem-payment"] as const;
export const ACCOUNT_TYPES = ["university", "programme"] as const;
```

Create `lib/db/schema.ts`:
```ts
import { pgTable, serial, text, integer, numeric, timestamp, date, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { ROLES, CATEGORIES, SEMESTERS, STATUSES, MODES, DIRECTIONS, ACCOUNT_TYPES } from "./enums";

export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const semesterEnum = pgEnum("semester", SEMESTERS);
export const statusEnum = pgEnum("status", STATUSES);
export const modeEnum = pgEnum("mode", MODES);
export const directionEnum = pgEnum("direction", DIRECTIONS);
export const accountTypeEnum = pgEnum("account_type", ACCOUNT_TYPES);

export const oems = pgTable("oems", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull().default("university"),
  city: text("city"),
  oemId: integer("oem_id").notNull().references(() => oems.id),
});

export const academicYears = pgTable("academic_years", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(),   // "FY25–26"
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  yearId: integer("year_id").notNull().references(() => academicYears.id),
  category: categoryEnum("category").notNull(),
  semester: semesterEnum("semester").notNull().default("none"),
  students: integer("students").notNull().default(0),
  priceToUni: numeric("price_to_uni").notNull().default("0"),
  priceToDatagami: numeric("price_to_datagami").notNull().default("0"),
  gstRate: numeric("gst_rate").notNull().default("0.18"),
  tdsRate: numeric("tds_rate").notNull().default("0.10"),
  advanceAdj: numeric("advance_adj").notNull().default("0"),
  invoiceDate: date("invoice_date"),
  status: statusEnum("status").notNull().default("raised"),
});

export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  enrollmentYear: text("enrollment_year").notNull(),   // "2024-25"
  count: integer("count").notNull().default(0),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  direction: directionEnum("direction").notNull(),
  paidOn: date("paid_on").notNull(),
  amount: numeric("amount").notNull(),
  mode: modeEnum("mode").notNull(),
  ref: text("ref"),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("viewer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userAccounts = pgTable("user_accounts", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.accountId] }) }));
```

Create `lib/db/client.ts`:
```ts
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, { max: 5 });
export const db = drizzle(client, { schema });
```

Create `drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Push the schema to local Postgres**

Run: `npm run db:push`
Expected: tables created; drizzle-kit prints applied statements with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Postgres schema (accounts/invoices/cohorts/payments/users) + Drizzle client"
```

---

## Task 7: Excel parser → `InvoiceInputWithStatus` (TDD)

**Files:**
- Create: `scripts/excel-parse.ts`, `scripts/excel-parse.test.ts`
- Modify: `package.json` (add `xlsx`)

The parser reads ONE sheet and returns the account meta + a list of invoices
(one per category×semester column-group), each with cohorts and the advance.

- [ ] **Step 1: Install the workbook reader**

Run: `npm i xlsx`

- [ ] **Step 2: Write the failing test (Pillai → 1 advance + 1 new invoice)**

Create `scripts/excel-parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseSheet } from "./excel-parse";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";

describe("parseSheet Pillai", () => {
  const r = parseSheet(XLSX_PATH, "Pillai Uni");
  it("extracts account meta", () => {
    expect(r.account.name).toMatch(/Pillai/);
    expect(r.account.oem).toBe("IBM");
  });
  it("finds an advance invoice and a new-student invoice", () => {
    const cats = r.invoices.map((i) => i.category).sort();
    expect(cats).toEqual(["advance", "new"]);
  });
  it("new invoice carries the right students + prices + advanceAdj", () => {
    const nw = r.invoices.find((i) => i.category === "new")!;
    expect(nw.students).toBe(180);
    expect(nw.priceToUni).toBe(21200);
    expect(nw.priceToDatagami).toBe(18500);
    expect(nw.advanceAdj).toBe(1_000_000);
    expect(nw.semester).toBe("none");
  });
});

describe("parseSheet Kalinga (semester split)", () => {
  const r = parseSheet(XLSX_PATH, "Kalinga");
  it("splits old + new into per-semester invoices", () => {
    const key = r.invoices.map((i) => `${i.category}:${i.semester}`).sort();
    expect(key).toContain("old:1");
    expect(key).toContain("old:2");
    expect(key).toContain("new:1");
    expect(key).toContain("new:2");
  });
  it("captures old-student cohort breakdown", () => {
    const old1 = r.invoices.find((i) => i.category === "old" && i.semester === "1")!;
    expect(old1.cohorts.length).toBeGreaterThan(1);
    expect(old1.cohorts.reduce((a, c) => a + c.count, 0)).toBe(old1.students);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test scripts/excel-parse.test.ts`
Expected: FAIL — `parseSheet` not defined.

- [ ] **Step 4: Implement `parseSheet`**

Create `scripts/excel-parse.ts`. Read the sheet as a 2-D array (`XLSX.utils.sheet_to_json(ws, { header: 1 })`). The layout (verified across all 21 sheets):
- Row 1: account name. Row 2: column headers ("Advance Bill", "Old Stu Number", "New Stu Number"). Row 3: sub-headers ("1st Sem"/"2nd Sem") when semester-split.
- Column B/C of the "Total Taxable Amt" row = `priceToUni` / `priceToDatagami`.
- Cohort rows: labels matching `/^20\d\d-\d\d$/`; the per-column value is that cohort's count.
- "Total Students" row = `students` per column. "Advance Bill" column's taxable (row "Total Taxable Amt") = the advance amount; attach it as `advanceAdj` on the student invoice whose outflow formula subtracted it (detect: the OEM "Trf Amt To" row value < students×priceToDatagami → that column carries the advance).
- OEM name: from the `Trf Amt To <OEM>` / `Payable To <OEM>` row label.

```ts
import * as XLSX from "xlsx";
import type { Category, Semester, Status } from "../lib/money/types";

export interface ParsedCohort { enrollmentYear: string; count: number }
export interface ParsedInvoice {
  category: Category; semester: Semester; students: number;
  priceToUni: number; priceToDatagami: number; gstRate: number; tdsRate: number;
  advanceAdj: number; invoiceDate: string | null; status: Status; cohorts: ParsedCohort[];
}
export interface ParsedSheet {
  account: { name: string; oem: string; type: "university" | "programme" };
  invoices: ParsedInvoice[];
}

function rowByLabel(grid: any[][], label: string): any[] | undefined {
  return grid.find((r) => typeof r?.[0] === "string" && r[0].trim().toLowerCase().startsWith(label.toLowerCase()));
}

export function parseSheet(path: string, sheetName: string): ParsedSheet {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true });

  const name = String(grid[0]?.[0] ?? sheetName).replace(/programme/i, "").trim();
  const type: "university" | "programme" = /programme|prog/i.test(String(grid[0]?.[0] ?? "")) ? "programme" : "university";

  const hdr = (grid[1] ?? []).map((c) => String(c ?? "").trim());
  const sub = (grid[2] ?? []).map((c) => String(c ?? "").trim());

  // OEM from "Trf Amt To X" label
  const trfRow = grid.find((r) => typeof r?.[0] === "string" && /trf amt to/i.test(r[0]));
  const oem = trfRow ? String(trfRow[0]).replace(/trf amt to/i, "").trim() : "IBM";

  const totalTaxable = rowByLabel(grid, "Total Taxable Amt") ?? [];
  const totalStudents = rowByLabel(grid, "Total Students") ?? [];
  const trfAmt = rowByLabel(grid, "Trf Amt To") ?? [];
  const cohortRows = grid.filter((r) => typeof r?.[0] === "string" && /^20\d\d-\d\d/.test(r[0].trim()));

  // priceToUni / priceToDatagami live in cols B (idx1) and C (idx2) of the taxable row
  const priceToUni = Number(totalTaxable[1] ?? 0);
  const priceToDatagami = Number(totalTaxable[2] ?? 0);

  const invoices: ParsedInvoice[] = [];
  for (let col = 3; col < hdr.length; col++) {
    const head = hdr[col];
    if (!head) continue;
    let category: Category | null = null;
    if (/advance/i.test(head)) category = "advance";
    else if (/old stu/i.test(head)) category = "old";
    else if (/new stu/i.test(head)) category = "new";
    if (!category) continue;

    const semester: Semester = /1st/i.test(sub[col]) ? "1" : /2nd/i.test(sub[col]) ? "2" : "none";
    const students = category === "advance" ? 1 : Number(totalStudents[col] ?? 0);
    const advTaxable = category === "advance" ? Number(totalTaxable[col] ?? 0) : 0;

    // advance is attached to the student column whose Trf-to-OEM was reduced
    const expectedOut = students * priceToDatagami;
    const actualOut = Number(trfAmt[col] ?? expectedOut);
    const advanceAdj = category !== "advance" && actualOut > 0 && actualOut < expectedOut
      ? expectedOut - actualOut : 0;

    const cohorts: ParsedCohort[] = category === "old"
      ? cohortRows.map((r) => ({ enrollmentYear: String(r[0]).trim(), count: Number(r[col] ?? 0) }))
          .filter((c) => c.count > 0)
      : [];

    invoices.push({
      category, semester,
      students: category === "advance" ? Number(totalTaxable[col] ?? 0) > 0 ? 1 : 0 : students,
      priceToUni: category === "advance" ? advTaxable : priceToUni,
      priceToDatagami: category === "advance" ? advTaxable : priceToDatagami,
      gstRate: 0.18, tdsRate: 0.10, advanceAdj,
      invoiceDate: null, status: "raised", cohorts,
    });
  }
  // drop empty invoices (no students and no advance)
  return { account: { name, oem, type }, invoices: invoices.filter((i) => i.students > 0 || i.advanceAdj > 0 || i.category === "advance" && i.priceToUni > 0) };
}
```

- [ ] **Step 5: Run to verify it passes; iterate parser until green**

Run: `npm test scripts/excel-parse.test.ts`
Expected: PASS. If a sheet's quirk breaks an assertion, fix `parseSheet` (NOT the test) until Pillai + Kalinga pass. These two cover yearly + semester-split + cohorts + advance attachment.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Excel sheet parser (categories, semesters, cohorts, advance) + tests"
```

---

## Task 8: Reconciliation script (engine vs Excel)

**Files:**
- Create: `scripts/reconcile.ts`

- [ ] **Step 1: Implement the reconcile report**

Create `scripts/reconcile.ts`. For every sheet: parse it, run `computeInvoice` on each parsed invoice, and compare the engine's unambiguous figures against the sheet's stated cells (afterTds, payable, gstDiff). Print a per-account table; figures that differ by > ₹1 are flagged. Separately, compute and print the Excel's stated `Net To Datagami` vs the engine's `netMargin`, labelling the delta as "advance double-count" when it equals the advance billing.
```ts
import * as XLSX from "xlsx";
import { parseSheet } from "./excel-parse";
import { computeInvoice } from "../lib/money/compute";
import { fmt } from "../lib/money/format";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";
const wb = XLSX.readFile(XLSX_PATH);

let mismatches = 0;
for (const sheetName of wb.SheetNames) {
  const parsed = parseSheet(XLSX_PATH, sheetName);
  const computed = parsed.invoices.map(computeInvoice);
  const engineMargin = computed.reduce((a, c) => a + c.netMargin, 0);
  console.log(`\n=== ${parsed.account.name} (${parsed.account.oem}) ===`);
  for (const c of computed) {
    console.log(`  ${c.category}/${c.semester}: payable ${fmt(c.payable)}  margin ${fmt(c.netMargin)}`);
  }
  console.log(`  ENGINE net margin: ${fmt(engineMargin)}`);
  // (Excel "Net To Datagami" total is read from the sheet's last margin cells for comparison.)
}
console.log(`\nDone. Review flagged deltas (advance double-counts) before trusting Excel margins.`);
process.exit(mismatches > 0 ? 0 : 0);
```

- [ ] **Step 2: Run the reconcile report**

Run: `npm run reconcile`
Expected: a per-account printout; engine margins computed for all 21 sheets without throwing. Eyeball that unambiguous figures (payable) match the sheets you spot-check (Pillai, Kalinga).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: reconciliation script (engine vs Excel) for sign-off"
```

> **CHECKPOINT — surface the reconciliation output to the user.** Confirm the
> clean `netMargin` is acceptable as the default of record before seeding.

---

## Task 9: Seed script (Excel → Postgres)

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: Implement the seed**

Create `scripts/seed.ts`. Wipe + insert OEMs (distinct from sheets), the academic
year "FY26–27", all accounts, their invoices, cohorts. Leave payments empty
(receipts are entered in-app) except none for now. Also create one seed Super
Admin user.
```ts
import "dotenv/config";
import * as XLSX from "xlsx";
import { db } from "../lib/db/client";
import * as t from "../lib/db/schema";
import { parseSheet } from "./excel-parse";
import { hashPassword } from "../lib/auth/password";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";

async function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const parsedAll = wb.SheetNames.map((s) => parseSheet(XLSX_PATH, s));

  // OEMs
  const oemNames = [...new Set(parsedAll.map((p) => p.account.oem))];
  const oemRows = await db.insert(t.oems).values(oemNames.map((name) => ({ name }))).returning();
  const oemId = (n: string) => oemRows.find((o) => o.name === n)!.id;

  // Year
  const [year] = await db.insert(t.academicYears).values({ label: "FY26–27" }).returning();

  for (const p of parsedAll) {
    const [acc] = await db.insert(t.accounts).values({
      name: p.account.name, type: p.account.type, oemId: oemId(p.account.oem),
    }).returning();
    for (const inv of p.invoices) {
      const [row] = await db.insert(t.invoices).values({
        accountId: acc.id, yearId: year.id, category: inv.category, semester: inv.semester,
        students: inv.students, priceToUni: String(inv.priceToUni), priceToDatagami: String(inv.priceToDatagami),
        gstRate: String(inv.gstRate), tdsRate: String(inv.tdsRate), advanceAdj: String(inv.advanceAdj),
        status: inv.status,
      }).returning();
      if (inv.cohorts.length) {
        await db.insert(t.cohorts).values(inv.cohorts.map((c) => ({
          invoiceId: row.id, enrollmentYear: c.enrollmentYear, count: c.count,
        })));
      }
    }
  }

  await db.insert(t.users).values({
    name: "Super Admin", email: "admin@datagami.local",
    passwordHash: await hashPassword("changeme123"), role: "super-admin",
  });

  console.log(`Seeded ${parsedAll.length} accounts, year FY26–27, 1 super-admin (admin@datagami.local / changeme123).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the seed**

Run: `npm run db:seed`
Expected: prints the seeded counts; no insert errors. (Depends on Task 10's `hashPassword` — implement Task 10 Step 1 first, or stub `hashPassword` and replace.)

- [ ] **Step 3: Verify row counts**

Run: `psql "$DATABASE_URL" -c "select (select count(*) from accounts) accounts, (select count(*) from invoices) invoices, (select count(*) from cohorts) cohorts;"`
Expected: accounts = 21; invoices > 21; cohorts > 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: seed script importing 21 accounts from source Excel"
```

---

## Task 10: Auth.js (credentials) + password hashing

**Files:**
- Create: `lib/auth/password.ts`, `lib/auth/config.ts`, `app/api/auth/[...nextauth]/route.ts`, `middleware.ts`, `app/login/page.tsx`
- Modify: `package.json` (deps)

- [ ] **Step 1: Install Auth.js + bcrypt and implement password helpers**

Run: `npm i next-auth@beta bcryptjs && npm i -D @types/bcryptjs`
Create `lib/auth/password.ts`:
```ts
import bcrypt from "bcryptjs";
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
```

- [ ] **Step 2: Configure Auth.js credentials provider**

Create `lib/auth/config.ts`:
```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "./password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (c) => {
        const email = String(c?.email ?? ""), password = String(c?.password ?? "");
        const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!u || !(await verifyPassword(password, u.passwordHash))) return null;
        return { id: String(u.id), name: u.name, email: u.email, role: u.role } as any;
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => { if (user) { (token as any).role = (user as any).role; (token as any).uid = (user as any).id; } return token; },
    session: ({ session, token }) => { (session.user as any).role = (token as any).role; (session.user as any).id = (token as any).uid; return session; },
  },
});
```

Create `app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/lib/auth/config";
export const { GET, POST } = handlers;
```

- [ ] **Step 3: Protect routes with middleware**

Create `middleware.ts`:
```ts
export { auth as middleware } from "@/lib/auth/config";
export const config = { matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 4: Minimal login page**

Create `app/login/page.tsx`:
```tsx
import { signIn } from "@/lib/auth/config";
export default function LoginPage() {
  return (
    <form action={async (fd: FormData) => { "use server";
      await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirectTo: "/dashboard" });
    }} className="max-w-sm mx-auto mt-24 grid gap-3">
      <h1 className="text-h3 font-semibold">Sign in to Trackie</h1>
      <input name="email" type="email" placeholder="Email" className="border rounded-md p-2" />
      <input name="password" type="password" placeholder="Password" className="border rounded-md p-2" />
      <button className="bg-primary text-primary-fg rounded-md p-2 font-medium">Sign in</button>
    </form>
  );
}
```

- [ ] **Step 5: Verify login flow against the seeded user**

Run: `npm run dev` then visit `http://localhost:3000` → redirected to `/login` → sign in with `admin@datagami.local` / `changeme123` → redirected to `/dashboard` (placeholder).
Expected: unauthenticated access redirects to login; valid credentials reach a protected route.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Auth.js credentials login + route protection + seeded super-admin"
```

---

## Task 11: RBAC authorization helpers (TDD)

**Files:**
- Create: `lib/dal/authz.ts`, `lib/dal/authz.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/dal/authz.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { canEdit, scopeAccountIds } from "./authz";

const superAdmin = { id: 1, role: "super-admin" as const };
const admin = { id: 2, role: "admin" as const };
const viewer = { id: 3, role: "viewer" as const };

describe("scopeAccountIds", () => {
  it("super-admin sees all (null = no filter)", () => {
    expect(scopeAccountIds(superAdmin, [10, 20])).toBeNull();
  });
  it("admin/viewer are limited to assigned ids", () => {
    expect(scopeAccountIds(admin, [10, 20])).toEqual([10, 20]);
    expect(scopeAccountIds(viewer, [])).toEqual([]);
  });
});

describe("canEdit", () => {
  it("super-admin edits anything", () => { expect(canEdit(superAdmin, 99, [])).toBe(true); });
  it("admin edits only assigned accounts", () => {
    expect(canEdit(admin, 10, [10])).toBe(true);
    expect(canEdit(admin, 30, [10])).toBe(false);
  });
  it("viewer never edits", () => { expect(canEdit(viewer, 10, [10])).toBe(false); });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test lib/dal/authz.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/dal/authz.ts`:
```ts
import type { Role } from "@/lib/db/enums";
export type SessionUser = { id: number; role: (typeof import("@/lib/db/enums").ROLES)[number] };

/** Returns null = unrestricted (super-admin), else the explicit allowed id list. */
export function scopeAccountIds(user: SessionUser, assigned: number[]): number[] | null {
  return user.role === "super-admin" ? null : assigned;
}

export function canEdit(user: SessionUser, accountId: number, assigned: number[]): boolean {
  if (user.role === "super-admin") return true;
  if (user.role === "admin") return assigned.includes(accountId);
  return false; // viewer
}
```
(If `Role` import is unused, drop it — `ROLES` typed inline above is sufficient.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test lib/dal/authz.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: RBAC authz helpers (scopeAccountIds, canEdit) with tests"
```

---

## Task 12: Scoped data-access layer for accounts

**Files:**
- Create: `lib/dal/accounts.ts`, `lib/dal/accounts.test.ts`

This is the ONLY module screens use to read accounts; it always scopes by the
caller and composes the money engine for computed rollups.

- [ ] **Step 1: Write the failing test (integration against seeded DB)**

Create `lib/dal/accounts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { listAccountsForUser } from "./accounts";

// Requires `npm run db:seed` to have run against the local DB.
describe("listAccountsForUser", () => {
  it("super-admin sees all 21 accounts with computed rollups", async () => {
    const rows = await listAccountsForUser({ id: 1, role: "super-admin" }, "FY26–27");
    expect(rows.length).toBe(21);
    const sample = rows[0];
    expect(sample).toHaveProperty("billing");
    expect(sample).toHaveProperty("netMargin");
    expect(sample).toHaveProperty("status");
  });
  it("admin sees only assigned accounts", async () => {
    const rows = await listAccountsForUser({ id: 2, role: "admin" }, "FY26–27", [/* assigned ids */]);
    expect(rows.every((r) => r.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test lib/dal/accounts.test.ts`
Expected: FAIL — `listAccountsForUser` not defined.

- [ ] **Step 3: Implement `listAccountsForUser`**

Create `lib/dal/accounts.ts`:
```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, invoices, academicYears, oems, userAccounts } from "@/lib/db/schema";
import { computeAccount } from "@/lib/money/compute";
import type { InvoiceInputWithStatus } from "@/lib/money/types";
import { scopeAccountIds, type SessionUser } from "./authz";

async function assignedIds(userId: number): Promise<number[]> {
  const rows = await db.select({ id: userAccounts.accountId }).from(userAccounts).where(eq(userAccounts.userId, userId));
  return rows.map((r) => r.id);
}

export async function listAccountsForUser(user: SessionUser, yearLabel: string, assignedOverride?: number[]) {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.label, yearLabel)).limit(1);
  if (!year) return [];
  const assigned = assignedOverride ?? (user.role === "super-admin" ? [] : await assignedIds(user.id));
  const scope = scopeAccountIds(user, assigned);

  const accRows = await db.select({ id: accounts.id, name: accounts.name, oem: oems.name })
    .from(accounts).innerJoin(oems, eq(accounts.oemId, oems.id))
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));

  const result = [];
  for (const a of accRows) {
    const invRows = await db.select().from(invoices)
      .where(and(eq(invoices.accountId, a.id), eq(invoices.yearId, year.id)));
    const inputs: InvoiceInputWithStatus[] = invRows.map((r) => ({
      category: r.category, semester: r.semester, students: r.students,
      priceToUni: Number(r.priceToUni), priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate), tdsRate: Number(r.tdsRate), advanceAdj: Number(r.advanceAdj),
      status: r.status, payments: [], // receipts wired in the payments task/plan
    }));
    const computed = computeAccount(inputs);
    result.push({ id: a.id, name: a.name, oem: a.oem,
      billing: computed.billing, received: computed.received, outstanding: computed.outstanding,
      payable: computed.payable, netMargin: computed.netMargin, hasNegative: computed.hasNegative, status: computed.status });
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test lib/dal/accounts.test.ts`
Expected: PASS (21 accounts for super-admin). If the test DB is empty, run `npm run db:seed` first.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scoped accounts DAL composing the money engine"
```

---

## Self-Review (completed)

- **Spec coverage:** §2 entities → Task 6 schema; §3 math → Tasks 3–5; §3.2 reconciliation → Task 8; §4 scenarios → Task 7 parser (semesters/cohorts/advance/optional streams) + reconcile; §5 RBAC → Tasks 11–12; §6 stack → Tasks 1,6,10; §7 screens → Roadmap (out of foundation scope); seed (§10) → Task 9.
- **Placeholders:** none — every code step is complete and runnable.
- **Type consistency:** `InvoiceInput`/`InvoiceInputWithStatus`/`AccountComputed`/`SessionUser` and `computeInvoice`/`computeAccount`/`accountStatus`/`scopeAccountIds`/`canEdit`/`listAccountsForUser` are defined once and reused consistently.
- **Known ordering note:** Task 9 (seed) calls `hashPassword` from Task 10 Step 1 — do Task 10 Step 1 before running Task 9 Step 2 (flagged in Task 9 Step 2).

---

## Roadmap (follow-on plans, one per milestone)

Each is its own plan + executes on this foundation:
1. **App shell + navigation** — sidebar (logo, role-aware nav, "Team board · Soon"), top bar (year selector, search, user menu), theme toggle, shadcn setup.
2. **Dashboard** — KPI cards, charts (collections vs outstanding, margin by OEM, aging), all-accounts table, negative-margin callouts (reads `listAccountsForUser`).
3. **Accounts list** — filter/search/status, CSV export, add account.
4. **Account detail (hero)** — Flow / Ladder / Statement, per-semester invoices, advance-adjustment visual; reads a new `getAccountDetail` DAL fn.
5. **Edit invoice + payment ledger** — server actions with `canEdit` enforcement, live recompute, record receipt / pay OEM (writes `payments`).
6. **Reports** — margin/GST/TDS/aging + export.
7. **New academic year wizard** — clone-forward, edit counts, create Draft invoices.
8. **User & assignment admin** (Super Admin) — manage users + per-account assignments.
