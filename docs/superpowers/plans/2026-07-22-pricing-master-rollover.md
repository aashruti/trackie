# Pricing Master Screen + FY Batch Rollover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/pricing` master screen where the accounts team edits every account's student counts and per-student prices for a year in one place, plus a counts-only year rollover that promotes the outgoing year's new intake into an FY-named returning batch.

**Architecture:** Pricing stays on `invoices` (+ per-batch `cohorts`); no schema change. A new client-safe `lib/fy.ts` owns the FY label convention (`FY26–27`, en-dash). The rollover DAL is rewritten to carry counts only (no billing details, no advance streams) and to promote `new → old` batches. The master screen is a new DAL read (`getPricingMaster`, no-N+1) + a client table that diffs edits and saves through the existing audited writers `updateInvoice`/`setCohorts`.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` if unsure of an API — this Next version has breaking changes), Drizzle ORM, Postgres, vitest (integration tests hit the LOCAL seeded DB via `.env.local`), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-22-pricing-master-rollover-design.md`

**House rules that bind every task:** no DB queries in loops over rows (batch + group in JS); `Promise.all` for independent queries; pages use `getYearContext()` (never `getCurrentYear()` + `listYears()`); migrations via `drizzle/*.sql` + `_journal.json`, applied with `npx tsx scripts/db-migrate.ts` — **never `--prod`**; server actions re-check auth inside; commit as-is (repo-local git config already commits as aashruti).

---

### Task 1: `lib/fy.ts` — FY label helpers (TDD)

**Files:**
- Create: `lib/fy.ts`
- Create: `lib/fy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/fy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { batchStartYear, nextFyLabel, prevFyLabel, normalizeBatchLabel, yearOfStudy } from "./fy";

describe("normalizeBatchLabel", () => {
  it.each([
    ["2024-25", "FY24–25"],
    ["24-25", "FY24–25"],
    ["FY24-25", "FY24–25"],
    ["FY 24-25", "FY24–25"],
    ["FY24–25", "FY24–25"],
    ["fy24-25", "FY24–25"],
    [" 2024-25 ", "FY24–25"],
  ])("canonicalizes %s → %s", (input, want) => {
    expect(normalizeBatchLabel(input)).toBe(want);
  });

  it.each([["earlier"], ["pre-FY26–27"], ["2024"], ["FY2024-2025"], [""]])(
    "leaves unrecognized %j unchanged (trimmed)",
    (input) => expect(normalizeBatchLabel(input)).toBe(input.trim()),
  );
});

describe("nextFyLabel / prevFyLabel", () => {
  it("advances the canonical form", () => {
    expect(nextFyLabel("FY26–27")).toBe("FY27–28");
    expect(prevFyLabel("FY26–27")).toBe("FY25–26");
  });
  it("round-trips", () => {
    expect(prevFyLabel(nextFyLabel("FY26–27"))).toBe("FY26–27");
  });
  it("normalizes legacy input while stepping", () => {
    expect(nextFyLabel("2024-25")).toBe("FY25–26");
    expect(prevFyLabel("2024-25")).toBe("FY23–24");
  });
  it("wraps the century", () => {
    expect(nextFyLabel("FY99–00")).toBe("FY00–01");
    expect(prevFyLabel("FY00–01")).toBe("FY99–00");
  });
  it("appends a marker for unparseable labels", () => {
    expect(nextFyLabel("weird")).toBe("weird (next)");
    expect(prevFyLabel("weird")).toBe("weird (prev)");
  });
});

describe("batchStartYear / yearOfStudy", () => {
  it("parses both conventions", () => {
    expect(batchStartYear("FY26–27")).toBe(2026);
    expect(batchStartYear("2024-25")).toBe(2024);
    expect(batchStartYear("FY 24-25")).toBe(2024);
    expect(batchStartYear("junk")).toBeNull();
  });
  it("computes ordinal year of study (parity with the old inline copies)", () => {
    expect(yearOfStudy("FY24–25", "FY26–27")).toBe("3rd year");
    expect(yearOfStudy("2024-25", "FY26–27")).toBe("3rd year");
    expect(yearOfStudy("FY26–27", "FY26–27")).toBe("1st year");
    expect(yearOfStudy("FY27–28", "FY26–27")).toBeNull(); // future batch
    expect(yearOfStudy("junk", "FY26–27")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/fy.test.ts`
Expected: FAIL — `Cannot find module './fy'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `lib/fy.ts`:

```ts
// Shared financial-year / batch-label helpers. Client-safe — no "server-only"
// import, so DAL code and client components may both use these.
//
// Canonical label form everywhere: "FY26–27" — "FY" prefix, two-digit years,
// EN-DASH (–, U+2013). This matches academic_years.label exactly; a batch is
// named by the year label of its intake year.

/** Academic-year start, e.g. "FY26–27" → 2026, "2024-25" → 2024. */
export function batchStartYear(label: string): number | null {
  const m = label.match(/(\d{4})|(?:FY)?(\d{2})\D/);
  if (m?.[1]) return parseInt(m[1], 10);
  if (m?.[2]) return 2000 + parseInt(m[2], 10);
  return null;
}

/** Next FY label, e.g. "FY26–27" → "FY27–28". Unparseable input gets " (next)". */
export function nextFyLabel(label: string): string {
  const m = label.match(/(\d{2})\D+(\d{2})/);
  if (!m) return label + " (next)";
  const a = (parseInt(m[1], 10) + 1) % 100;
  const b = (parseInt(m[2], 10) + 1) % 100;
  return `FY${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
}

/** Previous FY label, e.g. "FY26–27" → "FY25–26". Unparseable input gets " (prev)". */
export function prevFyLabel(label: string): string {
  const m = label.match(/(\d{2})\D+(\d{2})/);
  if (!m) return label + " (prev)";
  const a = (parseInt(m[1], 10) + 99) % 100;
  const b = (parseInt(m[2], 10) + 99) % 100;
  return `FY${String(a).padStart(2, "0")}–${String(b).padStart(2, "0")}`;
}

/**
 * Normalize a batch label to canonical FY form:
 *   "2024-25" | "24-25" | "FY24-25" | "FY 24-25" | "fy24–25"  →  "FY24–25"
 * Anything unrecognized is returned unchanged (trimmed) — free-text labels stay.
 */
export function normalizeBatchLabel(raw: string): string {
  const s = raw.trim();
  const m = s.match(/^(?:FY\s?)?(\d{2}|\d{4})[-–—](\d{2})$/i);
  if (!m) return s;
  const start = m[1].length === 4 ? m[1].slice(2) : m[1];
  return `FY${start}–${m[2]}`;
}

/** Ordinal year of study for an enrollment batch in the current year, e.g. "3rd year". */
export function yearOfStudy(enrollmentYear: string, currentYear: string): string | null {
  const enroll = batchStartYear(enrollmentYear);
  const cur = batchStartYear(currentYear);
  if (enroll == null || cur == null) return null;
  const n = cur - enroll + 1;
  if (n < 1) return null;
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][n] ?? `${n}th`;
  return `${ord} year`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/fy.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/fy.ts lib/fy.test.ts
git commit -m "feat(fy): shared FY label helpers — canonical batch naming, next/prev year, year-of-study"
```

---

### Task 2: Adopt `lib/fy` everywhere (dedupe + normalize on save)

**Files:**
- Modify: `components/accounts/detail-tabs.tsx` (delete local `startYear`/`yearOfStudy`, lines ~196–213)
- Modify: `components/accounts/invoice-ladder.tsx` (delete local `startYear`/`yearOfStudy`, lines ~57–72)
- Modify: `components/accounts/cohort-editor.tsx` (placeholder + normalize on save)
- Modify: `lib/dal/rollover.ts` (swap local `nextFyLabel` for the shared one — behavior identical)

- [ ] **Step 1: detail-tabs.tsx** — delete the local `startYear` and `yearOfStudy` function definitions (the block starting with the comment `/** Academic-year start, e.g. "FY26–27" → 2026 … */` through the end of `yearOfStudy`), and add to the imports at the top:

```ts
import { yearOfStudy } from "@/lib/fy";
```

- [ ] **Step 2: invoice-ladder.tsx** — same deletion of its local `startYear`/`yearOfStudy` copies, same import:

```ts
import { yearOfStudy } from "@/lib/fy";
```

- [ ] **Step 3: cohort-editor.tsx** — add import, canonicalize the placeholder, and normalize labels on save. Change the enrollment-year input's `placeholder="2024-25"` to `placeholder="FY24–25"`, add:

```ts
import { normalizeBatchLabel } from "@/lib/fy";
```

and change `save()`'s action call to:

```ts
await updateCohortsAction(
  accountId,
  invoiceId,
  rows
    .filter((r) => r.enrollmentYear.trim())
    .map((r) => ({ ...r, enrollmentYear: normalizeBatchLabel(r.enrollmentYear) })),
);
```

- [ ] **Step 4: lib/dal/rollover.ts** — delete the local `nextFyLabel` function (lines 39–46, including its doc comment) and add:

```ts
import { nextFyLabel } from "@/lib/fy";
```

- [ ] **Step 5: Verify nothing broke**

Run: `npm test` → all suites PASS (rollover behavior unchanged — same regex).
Run: `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/accounts/detail-tabs.tsx components/accounts/invoice-ladder.tsx components/accounts/cohort-editor.tsx lib/dal/rollover.ts
git commit -m "refactor(fy): use shared FY helpers; cohort editor normalizes batch labels on save"
```

---

### Task 3: Migration 0019 — canonicalize existing batch labels

**Files:**
- Create: `drizzle/0019_fy_batch_labels.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration**

Create `drizzle/0019_fy_batch_labels.sql`:

```sql
-- Normalize cohort batch labels to the canonical FY form ("FY24–25": FY prefix,
-- two-digit years, EN-DASH) so batches match academic_years.label exactly.
-- Mirrors normalizeBatchLabel() in lib/fy.ts. Data-only — no schema change.
--
-- Audit triggers are suspended for this batch: a bulk convention rename is not
-- a user action, and the row-stamp (updated_by) still points at the last real
-- editor — letting the trigger fire would misattribute the rename to them in
-- the audit feed. drizzle runs the migration in one transaction, so a failure
-- restores the triggers via rollback.
ALTER TABLE "cohorts" DISABLE TRIGGER USER;--> statement-breakpoint
-- "2024-25" → "FY24–25"
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^\d{2}(\d{2})-(\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^\d{4}-\d{2}$';--> statement-breakpoint
-- "24-25" → "FY24–25"
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^(\d{2})-(\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^\d{2}-\d{2}$';--> statement-breakpoint
-- "FY24-25" / "FY 24-25" (hyphen or space variants) → "FY24–25"; rows already
-- canonical are excluded so no-op updates don't fire.
UPDATE "cohorts" SET "enrollment_year" = regexp_replace("enrollment_year", '^FY ?(\d{2})[-–](\d{2})$', 'FY\1–\2')
WHERE "enrollment_year" ~ '^FY ?\d{2}[-–]\d{2}$' AND "enrollment_year" !~ '^FY\d{2}–\d{2}$';--> statement-breakpoint
ALTER TABLE "cohorts" ENABLE TRIGGER USER;
```

- [ ] **Step 2: Journal entry** — in `drizzle/meta/_journal.json`, append after the `0018` entry (inside the `entries` array):

```json
    {
      "idx": 19,
      "version": "7",
      "when": 1784018900000,
      "tag": "0019_fy_batch_labels",
      "breakpoints": true
    }
```

- [ ] **Step 3: Apply to the LOCAL database**

Run: `npx tsx scripts/db-migrate.ts`
Expected: the script prints its target host — **read that line and confirm it is the local/dev database** (per CLAUDE.md; never pass `--prod`). Migration `0019_fy_batch_labels` applies without error.

- [ ] **Step 4: Verify the data** — create a throwaway test file `lib/db/labels-check.test.ts` (vitest already has the DB env + `server-only` handling wired):

```ts
import { describe, it } from "vitest";
import { db } from "@/lib/db/client";
import { cohorts } from "@/lib/db/schema";

describe("post-migration batch labels (manual inspection)", () => {
  it("prints distinct labels", async () => {
    const rows = await db.selectDistinct({ label: cohorts.enrollmentYear }).from(cohorts);
    console.log("[labels]", rows.map((r) => r.label).sort());
  });
});
```

Run: `npx vitest run lib/db/labels-check.test.ts`
Expected: PASS; the printed list shows only `FYxx–yy`-form labels (plus any deliberate free-text ones). Then **delete the file**:

```bash
rm lib/db/labels-check.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add drizzle/0019_fy_batch_labels.sql drizzle/meta/_journal.json
git commit -m "feat(fy): migration 0019 — canonicalize cohort batch labels to FY form"
```

---

### Task 4: Rollover DAL — counts-only + promotion (TDD)

**Files:**
- Modify: `lib/dal/rollover.ts` (rewrite `getRolloverPlan`, `rolloverYear`, and the exported types; `deleteYear` unchanged)
- Modify: `lib/dal/rollover.test.ts` (rewrite — the "carries cohort prices forward" suite is superseded and removed)

- [ ] **Step 1: Rewrite the test file** — replace the entire contents of `lib/dal/rollover.test.ts` with:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { rolloverYear, deleteYear, getRolloverPlan } from "./rollover";
import { prevFyLabel } from "@/lib/fy";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const FROM = "FY26–27";
const TO = "FY99–TEST";

async function invoiceCount(yearLabel: string) {
  const { db } = await import("@/lib/db/client");
  const { invoices, academicYears } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [y] = await db.select().from(academicYears).where(eq(academicYears.label, yearLabel));
  if (!y) return 0;
  const rows = await db.select().from(invoices).where(eq(invoices.yearId, y.id));
  return rows.length;
}

/** Snapshot the row ids a rollover test run created, before deleteYear removes them. */
async function snapshotYearIds(yearLabel: string) {
  const { db } = await import("@/lib/db/client");
  const { academicYears, invoices, cohorts } = await import("@/lib/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const [year] = await db.select().from(academicYears).where(eq(academicYears.label, yearLabel)).limit(1);
  const yearId = year?.id ?? null;
  const invoiceIds = yearId
    ? (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.yearId, yearId))).map((r) => r.id)
    : [];
  const cohortIds = invoiceIds.length
    ? (await db.select({ id: cohorts.id }).from(cohorts).where(inArray(cohorts.invoiceId, invoiceIds))).map(
        (r) => r.id,
      )
    : [];
  return { yearId, invoiceIds, cohortIds };
}

/** Best-effort audit_log scrub for rows a test run created — scoped by table+id. */
async function cleanupAudit({
  yearId,
  invoiceIds,
  cohortIds,
  accountIds = [],
}: {
  yearId: number | null;
  invoiceIds: number[];
  cohortIds: number[];
  accountIds?: number[];
}) {
  const { db } = await import("@/lib/db/client");
  const { auditLog } = await import("@/lib/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  if (yearId != null) {
    await db.delete(auditLog).where(and(eq(auditLog.tableName, "academic_years"), eq(auditLog.rowId, String(yearId))));
  }
  if (invoiceIds.length) {
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.tableName, "invoices"), inArray(auditLog.rowId, invoiceIds.map(String))));
  }
  if (cohortIds.length) {
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.tableName, "cohorts"), inArray(auditLog.rowId, cohortIds.map(String))));
  }
  if (accountIds.length) {
    await db
      .delete(auditLog)
      .where(and(eq(auditLog.tableName, "accounts"), inArray(auditLog.rowId, accountIds.map(String))));
  }
}

describe("rolloverYear — counts-only + promotion", () => {
  it("clones counts as Draft, promotes the new intake, and carries no billing details", async () => {
    const { db } = await import("@/lib/db/client");
    const { invoices, cohorts, academicYears } = await import("@/lib/db/schema");
    const { eq, inArray } = await import("drizzle-orm");

    const before = await invoiceCount(FROM);
    const [fromYear] = await db.select().from(academicYears).where(eq(academicYears.label, FROM));
    const srcInvoices = await db.select().from(invoices).where(eq(invoices.yearId, fromYear.id));
    // If this fails, the local seed has no new-intake stream — add one to the
    // seed (any account, category "new") rather than weakening the test.
    const srcNew = srcInvoices.filter((r) => r.category === "new");
    expect(srcNew.length).toBeGreaterThan(0);

    const res = await rolloverYear(SUPER, FROM, TO, {});
    expect(res.invoicesCreated).toBeGreaterThan(0);
    expect(await invoiceCount(FROM)).toBe(before); // source year untouched

    const [toYear] = await db.select().from(academicYears).where(eq(academicYears.label, TO));
    const created = await db.select().from(invoices).where(eq(invoices.yearId, toYear.id));
    const createdCohorts = created.length
      ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, created.map((r) => r.id)))
      : [];

    // Counts-only: draft, no advance streams, no billing details, no batch prices.
    expect(created.every((r) => r.status === "draft")).toBe(true);
    expect(created.some((r) => r.category === "advance")).toBe(false);
    for (const r of created) {
      expect(Number(r.priceToUni)).toBe(0);
      expect(Number(r.priceToDatagami)).toBe(0);
      expect(Number(r.advanceAdj)).toBe(0);
      expect(r.invoiceDate).toBeNull();
      expect(r.createdBy).toBe(SUPER.id);
      expect(r.updatedBy).toBe(SUPER.id);
    }
    for (const c of createdCohorts) {
      expect(c.priceToUni).toBeNull();
      expect(c.priceToDatagami).toBeNull();
      expect(c.createdBy).toBe(SUPER.id);
      expect(c.updatedBy).toBe(SUPER.id);
    }

    // Promotion: every source `new` intake became a batch named FROM on the
    // same account+semester old invoice, plus a fresh `new` row (estimate =
    // last year's intake).
    for (const n of srcNew) {
      const oldClone = created.find(
        (r) => r.accountId === n.accountId && r.category === "old" && r.semester === n.semester,
      );
      expect(oldClone).toBeDefined();
      const batches = createdCohorts.filter((c) => c.invoiceId === oldClone!.id);
      const promoted = batches.find((c) => c.enrollmentYear === FROM);
      expect(promoted?.count).toBe(n.students);
      expect(oldClone!.students).toBe(batches.reduce((a, c) => a + c.count, 0));

      const fresh = created.find(
        (r) => r.accountId === n.accountId && r.category === "new" && r.semester === n.semester,
      );
      expect(fresh?.students).toBe(n.students);
    }
  });

  it("is idempotent — re-running skips already-populated accounts", async () => {
    const res = await rolloverYear(SUPER, FROM, TO, {});
    expect(res.invoicesCreated).toBe(0);
    expect(res.skipped).toBeGreaterThan(0);
  });

  it("getRolloverPlan lists only student streams and suggests the next FY", async () => {
    const plan = await getRolloverPlan(SUPER, FROM);
    expect(plan.rows.length).toBeGreaterThan(0);
    expect(plan.rows.every((r) => r.category !== "advance")).toBe(true);
    expect(plan.suggestedToYear).toBe("FY27–28");
  });

  afterAll(async () => {
    const ids = await snapshotYearIds(TO);
    await deleteYear(SUPER, TO);
    await cleanupAudit(ids);
  });
});

describe("rolloverYear applies wizard edits", () => {
  const EDIT = "FY98–EDIT";

  it("overrides batch, promoted-batch and fresh-intake counts", async () => {
    const { db } = await import("@/lib/db/client");
    const { invoices, cohorts, academicYears } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const [fromYear] = await db.select().from(academicYears).where(eq(academicYears.label, FROM));
    const src = await db.select().from(invoices).where(eq(invoices.yearId, fromYear.id));
    const n = src.find((r) => r.category === "new");
    expect(n).toBeDefined();
    const o = src.find((r) => r.category === "old");
    const oldBatches = o ? await db.select().from(cohorts).where(eq(cohorts.invoiceId, o.id)) : [];

    await rolloverYear(SUPER, FROM, EDIT, {
      scalarCounts: { [n!.id]: 41 },
      promotedCounts: { [n!.id]: 7 },
      cohortCounts: oldBatches.length
        ? { [o!.id]: { [oldBatches[0].enrollmentYear]: oldBatches[0].count + 3 } }
        : {},
    });

    const [toYear] = await db.select().from(academicYears).where(eq(academicYears.label, EDIT));
    const created = await db.select().from(invoices).where(eq(invoices.yearId, toYear.id));

    const fresh = created.find(
      (r) => r.accountId === n!.accountId && r.category === "new" && r.semester === n!.semester,
    );
    expect(fresh?.students).toBe(41);

    const oldClone = created.find(
      (r) => r.accountId === n!.accountId && r.category === "old" && r.semester === n!.semester,
    );
    expect(oldClone).toBeDefined();
    const clonedBatches = await db.select().from(cohorts).where(eq(cohorts.invoiceId, oldClone!.id));
    expect(clonedBatches.find((c) => c.enrollmentYear === FROM)?.count).toBe(7);
    expect(oldClone!.students).toBe(clonedBatches.reduce((a, c) => a + c.count, 0));

    // If the sampled old invoice is on the same account+semester, its batch
    // override must be applied too (data-dependent, hence conditional).
    if (oldBatches.length && o!.accountId === n!.accountId && o!.semester === n!.semester) {
      expect(clonedBatches.find((c) => c.enrollmentYear === oldBatches[0].enrollmentYear)?.count).toBe(
        oldBatches[0].count + 3,
      );
    }
  });

  afterAll(async () => {
    const ids = await snapshotYearIds(EDIT);
    await deleteYear(SUPER, EDIT);
    await cleanupAudit(ids);
  });
});

describe("rolloverYear structural edges (temp account)", () => {
  const TEMP = "FY96–TEMP";
  let tempAccountId: number | null = null;
  let tempSourceInvoiceIds: number[] = [];

  it("materializes scalar-old counts, merges duplicate intakes, creates missing old invoices", async () => {
    const { db } = await import("@/lib/db/client");
    const { accounts, oems, invoices, cohorts, academicYears } = await import("@/lib/db/schema");
    const { and, eq, inArray } = await import("drizzle-orm");

    // Temp account: scalar old (12, sem none), two new (30 + 4, sem none — must
    // merge into one promoted batch), one new (5, sem 1 — no old sem-1 exists,
    // so rollover must create it).
    const [oem] = await db.select().from(oems).limit(1);
    const [acc] = await db
      .insert(accounts)
      .values({
        name: "ZZ Promo Test University",
        type: "university",
        oemId: oem.id,
        createdBy: SUPER.id,
        updatedBy: SUPER.id,
      })
      .returning();
    tempAccountId = acc.id;
    const [fromYear] = await db.select().from(academicYears).where(eq(academicYears.label, FROM));
    const mk = (category: "old" | "new", semester: "none" | "1", students: number) => ({
      accountId: acc.id,
      yearId: fromYear.id,
      category,
      semester,
      students,
      status: "draft" as const,
      createdBy: SUPER.id,
      updatedBy: SUPER.id,
    });
    const srcCreated = await db
      .insert(invoices)
      .values([mk("old", "none", 12), mk("new", "none", 30), mk("new", "none", 4), mk("new", "1", 5)])
      .returning();
    tempSourceInvoiceIds = srcCreated.map((r) => r.id);

    await rolloverYear(SUPER, FROM, TEMP, {});

    const [toYear] = await db.select().from(academicYears).where(eq(academicYears.label, TEMP));
    const created = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.yearId, toYear.id), eq(invoices.accountId, acc.id)));
    const createdCohorts = await db
      .select()
      .from(cohorts)
      .where(inArray(cohorts.invoiceId, created.map((r) => r.id)));

    // old (none): catch-all batch from the scalar count + merged promoted batch.
    const oldNone = created.find((r) => r.category === "old" && r.semester === "none");
    expect(oldNone).toBeDefined();
    const oldNoneBatches = createdCohorts.filter((c) => c.invoiceId === oldNone!.id);
    expect(oldNoneBatches.find((c) => c.enrollmentYear === prevFyLabel(FROM))?.count).toBe(12);
    expect(oldNoneBatches.find((c) => c.enrollmentYear === FROM)?.count).toBe(34); // 30 + 4 merged
    expect(oldNone!.students).toBe(46);

    // old (sem 1): auto-created to receive the sem-1 promotion.
    const oldOne = created.find((r) => r.category === "old" && r.semester === "1");
    expect(oldOne).toBeDefined();
    const oldOneBatches = createdCohorts.filter((c) => c.invoiceId === oldOne!.id);
    expect(oldOneBatches).toHaveLength(1);
    expect(oldOneBatches[0].enrollmentYear).toBe(FROM);
    expect(oldOneBatches[0].count).toBe(5);
    expect(oldOne!.students).toBe(5);

    // Fresh intake rows mirror the source structure (one per source new stream).
    const freshNone = created
      .filter((r) => r.category === "new" && r.semester === "none")
      .map((r) => r.students)
      .sort((a, b) => a - b);
    expect(freshNone).toEqual([4, 30]);
    const freshOne = created.find((r) => r.category === "new" && r.semester === "1");
    expect(freshOne?.students).toBe(5);
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db/client");
    const { accounts, invoices, cohorts } = await import("@/lib/db/schema");
    const { eq, inArray } = await import("drizzle-orm");

    // Target year first (captures its ids), then the temp source rows + account.
    const ids = await snapshotYearIds(TEMP);
    await deleteYear(SUPER, TEMP);

    let srcCohortIds: number[] = [];
    if (tempSourceInvoiceIds.length) {
      srcCohortIds = (
        await db.select({ id: cohorts.id }).from(cohorts).where(inArray(cohorts.invoiceId, tempSourceInvoiceIds))
      ).map((r) => r.id);
      await db.delete(invoices).where(inArray(invoices.id, tempSourceInvoiceIds)); // cascades cohorts
    }
    if (tempAccountId != null) await db.delete(accounts).where(eq(accounts.id, tempAccountId));

    await cleanupAudit({
      yearId: ids.yearId,
      invoiceIds: [...ids.invoiceIds, ...tempSourceInvoiceIds],
      cohortIds: [...ids.cohortIds, ...srcCohortIds],
      accountIds: tempAccountId != null ? [tempAccountId] : [],
    });
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run lib/dal/rollover.test.ts`
Expected: FAIL — type errors (`RolloverEdits` shape not accepted / `getRolloverPlan` rows include advance) and behavioral failures (prices carried, no promotion).

- [ ] **Step 3: Rewrite `lib/dal/rollover.ts`** — replace the file's types and the two functions (`deleteYear` and all imports of it stay as-is; keep the existing `stampedDelete`/`stampedDeleteWhere`/`payments` imports for it):

```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, invoices, cohorts, payments } from "@/lib/db/schema";
import { nextFyLabel, prevFyLabel } from "@/lib/fy";
import { canEdit, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";
import { stampedDelete, stampedDeleteWhere } from "./audit";

export interface RolloverCohort {
  enrollmentYear: string;
  count: number;
}

export interface RolloverPlanRow {
  invoiceId: number;
  accountId: number;
  accountName: string;
  category: string; // "old" | "new" — advance streams are never rolled over
  semester: string;
  students: number;
  // Non-empty for cohort-driven old invoices; counts are edited per batch and
  // the scalar `students` is just their sum.
  cohorts: RolloverCohort[];
}

export interface RolloverPlan {
  fromYear: string;
  suggestedToYear: string;
  rows: RolloverPlanRow[];
}

/**
 * Wizard edits for rolloverYear. All keys are SOURCE-year invoice ids.
 * - scalarCounts: fresh-intake estimate for a `new` invoice, or the carried
 *   count for a scalar (cohort-less) `old` invoice.
 * - cohortCounts: per-batch counts for a cohort-driven `old` invoice.
 * - promotedCounts: the promoted batch's count for a `new` invoice
 *   (defaults to the source intake).
 */
export interface RolloverEdits {
  scalarCounts?: Record<number, number>;
  cohortCounts?: Record<number, Record<string, number>>;
  promotedCounts?: Record<number, number>;
}

/** Editable per-invoice count rows for the rollover wizard. */
export async function getRolloverPlan(
  user: SessionUser,
  fromYearLabel: string,
): Promise<RolloverPlan> {
  const [fromYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, fromYearLabel))
    .limit(1);
  if (!fromYear) {
    return { fromYear: fromYearLabel, suggestedToYear: nextFyLabel(fromYearLabel), rows: [] };
  }

  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const accRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts);
  const editableIds = accRows
    .filter((a) => canEdit(user, a.id, assigned))
    .map((a) => a.id);
  const nameById = new Map(accRows.map((a) => [a.id, a.name]));

  const invRows = editableIds.length
    ? await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.yearId, fromYear.id), inArray(invoices.accountId, editableIds)))
    : [];
  // Advance streams are not rolled over (counts-only), so the wizard never shows them.
  const studentRows = invRows.filter((r) => r.category !== "advance");

  const invIds = studentRows.map((r) => r.id);
  const cohortRows = invIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invIds))
    : [];
  const cohortsByInvoice = new Map<number, RolloverCohort[]>();
  for (const c of cohortRows) {
    const list = cohortsByInvoice.get(c.invoiceId) ?? [];
    list.push({ enrollmentYear: c.enrollmentYear, count: c.count });
    cohortsByInvoice.set(c.invoiceId, list);
  }

  const rows: RolloverPlanRow[] = studentRows.map((r) => ({
    invoiceId: r.id,
    accountId: r.accountId,
    accountName: nameById.get(r.accountId) ?? "—",
    category: r.category,
    semester: r.semester,
    students: r.students,
    cohorts: cohortsByInvoice.get(r.id) ?? [],
  }));
  rows.sort((a, b) => a.accountName.localeCompare(b.accountName));

  return { fromYear: fromYearLabel, suggestedToYear: nextFyLabel(fromYearLabel), rows };
}

export interface RolloverResult {
  toYearLabel: string;
  accountsRolled: number;
  invoicesCreated: number;
  skipped: number; // accounts that already had target-year invoices
}

/**
 * Roll a year's STUDENT COUNTS forward into a new (Draft) year.
 *
 * Counts-only by design (2026-07-22 spec): no billing details are carried —
 * prices, GST/TDS, advance adjustments and dates all take their schema
 * defaults, and `advance` streams are not cloned at all. New-year prices are
 * entered on /pricing; bills are raised as and when needed.
 *
 * Batch lifecycle: the source year's `new` intake is PROMOTED into the target
 * year's `old` invoice as a batch named after the source year (the old invoice
 * is created if the account had none for that semester; duplicate `new`
 * streams merge into one batch). A cohort-less `old` invoice's scalar count is
 * materialized as a catch-all batch labeled with the year before the source
 * year, so every target-year old invoice is batch-driven.
 *
 * - Creates the target year row if it doesn't exist.
 * - Skips an account if it already has target-year invoices (idempotent).
 * - The source year's rows are never modified.
 */
export async function rolloverYear(
  user: SessionUser,
  fromYearLabel: string,
  toYearLabel: string,
  edits: RolloverEdits = {},
): Promise<RolloverResult> {
  const [fromYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, fromYearLabel))
    .limit(1);
  if (!fromYear) throw new Error(`Source year ${fromYearLabel} not found`);

  // Create target year if missing.
  let [toYear] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, toYearLabel))
    .limit(1);
  if (!toYear) {
    [toYear] = await db
      .insert(academicYears)
      .values({ label: toYearLabel, createdBy: user.id, updatedBy: user.id })
      .returning();
  }

  // Accounts the user can edit.
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const allAccounts = await db.select({ id: accounts.id }).from(accounts);
  const editable = allAccounts
    .map((a) => a.id)
    .filter((id) => canEdit(user, id, assigned));

  const result: RolloverResult = {
    toYearLabel,
    accountsRolled: 0,
    invoicesCreated: 0,
    skipped: 0,
  };
  if (!editable.length) return result;

  // Batched reads (house no-N+1 rule): already-populated accounts, all source
  // invoices, all source cohorts — 3 queries regardless of account count.
  const [populatedRows, srcRows] = await Promise.all([
    db
      .select({ accountId: invoices.accountId })
      .from(invoices)
      .where(and(eq(invoices.yearId, toYear.id), inArray(invoices.accountId, editable))),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.yearId, fromYear.id), inArray(invoices.accountId, editable))),
  ]);
  const populated = new Set(populatedRows.map((r) => r.accountId));
  const srcByAccount = new Map<number, typeof srcRows>();
  for (const s of srcRows) {
    const list = srcByAccount.get(s.accountId) ?? [];
    list.push(s);
    srcByAccount.set(s.accountId, list);
  }
  const srcIds = srcRows.map((r) => r.id);
  const cohortRows = srcIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, srcIds))
    : [];
  const cohortsByInvoice = new Map<number, typeof cohortRows>();
  for (const c of cohortRows) {
    const list = cohortsByInvoice.get(c.invoiceId) ?? [];
    list.push(c);
    cohortsByInvoice.set(c.invoiceId, list);
  }

  const count = (v: number | undefined, fallback: number) =>
    v != null ? Math.max(0, Math.floor(v)) : fallback;

  // Pure JS from here: build the target-year invoice plans per account.
  interface Plan {
    accountId: number;
    category: "old" | "new";
    semester: (typeof srcRows)[number]["semester"];
    students: number;
    batches: RolloverCohort[];
  }
  const plans: Plan[] = [];
  for (const accountId of editable) {
    if (populated.has(accountId)) {
      result.skipped++;
      continue;
    }
    const src = srcByAccount.get(accountId) ?? [];
    if (!src.length) continue;

    const accountPlans: Plan[] = [];
    // Old invoices: carry batches (counts only). A cohort-less old invoice's
    // scalar count becomes a catch-all batch so the promoted batch can join it.
    for (const s of src.filter((r) => r.category === "old")) {
      const srcC = cohortsByInvoice.get(s.id) ?? [];
      let batches: RolloverCohort[];
      if (srcC.length) {
        const covr = edits.cohortCounts?.[s.id];
        batches = srcC.map((c) => ({
          enrollmentYear: c.enrollmentYear,
          count: count(covr?.[c.enrollmentYear], c.count),
        }));
      } else {
        const carried = count(edits.scalarCounts?.[s.id], s.students);
        batches = carried > 0 ? [{ enrollmentYear: prevFyLabel(fromYearLabel), count: carried }] : [];
      }
      accountPlans.push({ accountId, category: "old", semester: s.semester, students: 0, batches });
    }
    // New invoices: promote the intake into the same-semester old invoice
    // (created if absent), then start a fresh intake row.
    for (const n of src.filter((r) => r.category === "new")) {
      const promoted = count(edits.promotedCounts?.[n.id], n.students);
      let target = accountPlans.find((p) => p.category === "old" && p.semester === n.semester);
      if (!target) {
        target = { accountId, category: "old", semester: n.semester, students: 0, batches: [] };
        accountPlans.push(target);
      }
      const existing = target.batches.find((b) => b.enrollmentYear === fromYearLabel);
      if (existing) existing.count += promoted; // duplicate `new` streams merge
      else target.batches.push({ enrollmentYear: fromYearLabel, count: promoted });

      accountPlans.push({
        accountId,
        category: "new",
        semester: n.semester,
        students: count(edits.scalarCounts?.[n.id], n.students),
        batches: [],
      });
    }
    // `advance` streams are deliberately not cloned (counts-only rollover).

    // Cohort-driven invoices keep students = Σ batch counts (engine's basis).
    for (const p of accountPlans) {
      if (p.batches.length) p.students = p.batches.reduce((a, b) => a + b.count, 0);
    }
    if (accountPlans.length) {
      plans.push(...accountPlans);
      result.accountsRolled++;
    }
  }

  if (plans.length) {
    // Two bulk inserts. Postgres preserves VALUES order in RETURNING, so
    // created[i] corresponds to plans[i].
    const created = await db
      .insert(invoices)
      .values(
        plans.map((p) => ({
          accountId: p.accountId,
          yearId: toYear.id,
          category: p.category,
          semester: p.semester,
          students: p.students,
          // Counts-only: prices/GST/TDS/advanceAdj take their schema defaults.
          invoiceDate: null,
          status: "draft" as const,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      )
      .returning({ id: invoices.id });
    result.invoicesCreated = created.length;

    const cohortValues = plans.flatMap((p, i) =>
      p.batches.map((b) => ({
        invoiceId: created[i].id,
        enrollmentYear: b.enrollmentYear,
        count: b.count,
        priceToUni: null,
        priceToDatagami: null,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    );
    if (cohortValues.length) await db.insert(cohorts).values(cohortValues);
  }

  return result;
}
```

(`deleteYear` stays exactly as it is today.)

- [ ] **Step 4: Run the rollover tests**

Run: `npx vitest run lib/dal/rollover.test.ts`
Expected: PASS (all three suites).

- [ ] **Step 5: Run the whole suite** (the wizard/action still use the old signature — they are fixed in Task 5; only type-check errors in app code would surface at build, not in vitest)

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dal/rollover.ts lib/dal/rollover.test.ts
git commit -m "feat(rollover): counts-only rollover with new→old batch promotion"
```

---

### Task 5: Rollover action + wizard UI (counts-only)

**Files:**
- Modify: `app/(app)/new-year/actions.ts`
- Modify: `components/year/rollover-wizard.tsx` (rewrite)
- Modify: `app/(app)/new-year/page.tsx` (copy + `getYearContext`)

- [ ] **Step 1: actions.ts** — replace the whole file with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { rolloverYear, type RolloverEdits } from "@/lib/dal/rollover";

export async function rolloverAction(
  fromYearLabel: string,
  toYearLabel: string,
  edits: RolloverEdits = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  // Allow-list, not a deny-list: rollover creates GLOBAL academic-year rows, so
  // it is finance-only (hr/delivery roles must not reach it either).
  if (!session.user.roles.includes("super-admin") && !session.user.roles.includes("sales")) {
    throw new Error("Only Sales / Super Admin can roll over years");
  }

  const result = await rolloverYear(
    { id: Number(session.user.id), roles: session.user.roles },
    fromYearLabel,
    toYearLabel,
    edits,
  );
  revalidatePath("/", "layout");
  return result;
}
```

- [ ] **Step 2: rollover-wizard.tsx** — replace the whole file with:

```tsx
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { prevFyLabel } from "@/lib/fy";
import { rolloverAction } from "@/app/(app)/new-year/actions";
import type { RolloverEdits, RolloverPlanRow } from "@/lib/dal/rollover";
import { CATEGORY_LABEL, type ReportCategory } from "@/lib/money/report-view";

// RolloverPlanRow.category is DAL-typed as plain string, not the Category enum
// (see lib/dal/rollover.ts), so keep the runtime fallback.
function streamLabel(r: RolloverPlanRow) {
  const base = CATEGORY_LABEL[r.category as ReportCategory] ?? r.category;
  return r.semester === "none" ? base : `${base} · ${r.semester === "1" ? "1st" : "2nd"} sem`;
}

const countInputCls =
  "tabular w-16 rounded-md border border-border-strong bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function RolloverWizard({
  fromYear,
  suggestedToYear,
  rows,
}: {
  fromYear: string;
  suggestedToYear: string;
  rows: RolloverPlanRow[];
}) {
  const router = useRouter();
  const [toYear, setToYear] = useState(suggestedToYear);
  // Fresh-intake estimates (new rows) and carried counts (scalar old rows).
  const [scalarCounts, setScalarCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(rows.filter((r) => r.cohorts.length === 0).map((r) => [r.invoiceId, r.students])),
  );
  // Per-batch counts (invoiceId → batch label → count) for cohort-driven old rows.
  const [cohortCounts, setCohortCounts] = useState<Record<number, Record<string, number>>>(() =>
    Object.fromEntries(
      rows
        .filter((r) => r.cohorts.length > 0)
        .map((r) => [r.invoiceId, Object.fromEntries(r.cohorts.map((c) => [c.enrollmentYear, c.count]))]),
    ),
  );
  // Promoted-batch counts, keyed by the source `new` invoice (default: its intake).
  const [promotedCounts, setPromotedCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(rows.filter((r) => r.category === "new").map((r) => [r.invoiceId, r.students])),
  );
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<null | { created: number; accounts: number; from: string; to: string }>(null);
  const [error, setError] = useState<string | null>(null);

  // A row's total student contribution to the target year.
  const rowTotal = useCallback(
    (r: RolloverPlanRow) => {
      if (r.cohorts.length > 0)
        return r.cohorts.reduce((a, c) => a + (cohortCounts[r.invoiceId]?.[c.enrollmentYear] ?? c.count), 0);
      if (r.category === "new")
        return (scalarCounts[r.invoiceId] ?? r.students) + (promotedCounts[r.invoiceId] ?? r.students);
      return scalarCounts[r.invoiceId] ?? r.students;
    },
    [scalarCounts, cohortCounts, promotedCounts],
  );
  const totalStudents = useMemo(() => rows.reduce((a, r) => a + rowTotal(r), 0), [rows, rowTotal]);

  function create() {
    setError(null);
    const edits: RolloverEdits = { scalarCounts: {}, cohortCounts: {}, promotedCounts: {} };
    for (const r of rows) {
      if (r.cohorts.length > 0) {
        const changed: Record<string, number> = {};
        for (const c of r.cohorts) {
          const v = cohortCounts[r.invoiceId]?.[c.enrollmentYear];
          if (v != null && v !== c.count) changed[c.enrollmentYear] = v;
        }
        if (Object.keys(changed).length) edits.cohortCounts![r.invoiceId] = changed;
      } else {
        const v = scalarCounts[r.invoiceId];
        if (v != null && v !== r.students) edits.scalarCounts![r.invoiceId] = v;
      }
      if (r.category === "new") {
        const p = promotedCounts[r.invoiceId];
        if (p != null && p !== r.students) edits.promotedCounts![r.invoiceId] = p;
      }
    }
    const capturedFrom = fromYear;
    const capturedTo = toYear;
    startTransition(async () => {
      try {
        const res = await rolloverAction(capturedFrom, capturedTo, edits);
        setDone({
          created: res.invoicesCreated,
          accounts: res.accountsRolled,
          from: capturedFrom,
          to: capturedTo,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rollover failed");
      }
    });
  }

  if (done) {
    return (
      <Card className="p-6">
        <h3 className="text-base font-semibold text-text-primary">
          {done.to} created as Draft ✓
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          {done.created} draft invoices across {done.accounts} accounts carry {done.from}&apos;s student
          counts. The {done.from} intake is now a returning batch. Prices start blank — set them on the
          Pricing master screen; bills are raised as and when needed. {done.from} is unchanged.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => router.push("/pricing")}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            Set {done.to} prices
          </button>
          <button
            onClick={() => router.push("/accounts")}
            className="rounded-md border border-border-strong px-4 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            View accounts
          </button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Switch the year in the top bar to {done.to} to see the new Draft year.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-6 p-5">
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Roll over from</span>
          <div className="mt-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm font-medium text-text-primary">
            {fromYear}
          </div>
        </label>
        <span className="pb-2 text-text-muted">→</span>
        <label className="block">
          <span className="text-xs font-medium text-text-secondary">New academic year</span>
          <input
            value={toYear}
            onChange={(e) => setToYear(e.target.value)}
            className="mt-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </label>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Total students</div>
          <div className="tabular text-lg font-semibold text-text-primary">{totalStudents}</div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Student counts → ${toYear}`}
          subtitle={`counts carried forward · the ${fromYear} intake becomes a returning batch · prices start blank (set on Pricing master)`}
        />
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Stream</th>
                <th className="px-5 py-2.5 text-right font-medium">Student counts for {toYear}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hasCohorts = r.cohorts.length > 0;
                return (
                  <tr key={r.invoiceId} className="border-b border-border-subtle last:border-0 align-top">
                    <td className="px-5 py-2 font-medium text-text-primary">{r.accountName}</td>
                    <td className="px-3 py-2 text-text-secondary">{streamLabel(r)}</td>
                    <td className="px-5 py-2 text-right">
                      {hasCohorts ? (
                        <div className="flex flex-col items-end gap-1">
                          {r.cohorts.map((c) => (
                            <label key={c.enrollmentYear} className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-text-muted">{c.enrollmentYear}</span>
                              <input
                                type="number"
                                value={cohortCounts[r.invoiceId]?.[c.enrollmentYear] ?? c.count}
                                onChange={(e) =>
                                  setCohortCounts((p) => ({
                                    ...p,
                                    [r.invoiceId]: {
                                      ...p[r.invoiceId],
                                      [c.enrollmentYear]: parseInt(e.target.value, 10) || 0,
                                    },
                                  }))
                                }
                                aria-label={`Batch ${c.enrollmentYear} count`}
                                className={countInputCls}
                              />
                            </label>
                          ))}
                          <span className="text-[10px] text-text-muted">total {rowTotal(r)}</span>
                        </div>
                      ) : r.category === "new" ? (
                        <div className="flex flex-col items-end gap-1">
                          <label className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] text-text-muted">→ old batch {fromYear}</span>
                            <input
                              type="number"
                              value={promotedCounts[r.invoiceId] ?? r.students}
                              onChange={(e) =>
                                setPromotedCounts((p) => ({
                                  ...p,
                                  [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                                }))
                              }
                              aria-label={`Promoted batch ${fromYear} count`}
                              className={countInputCls}
                            />
                          </label>
                          <label className="flex items-center justify-end gap-1.5">
                            <span className="text-[10px] text-text-muted">fresh intake {toYear}</span>
                            <input
                              type="number"
                              value={scalarCounts[r.invoiceId] ?? r.students}
                              onChange={(e) =>
                                setScalarCounts((p) => ({
                                  ...p,
                                  [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                                }))
                              }
                              aria-label="Fresh intake count"
                              className={countInputCls}
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            value={scalarCounts[r.invoiceId] ?? r.students}
                            onChange={(e) =>
                              setScalarCounts((p) => ({
                                ...p,
                                [r.invoiceId]: parseInt(e.target.value, 10) || 0,
                              }))
                            }
                            aria-label="Carried count"
                            className={countInputCls}
                          />
                          <span className="text-[10px] text-text-muted">
                            becomes batch {prevFyLabel(fromYear)}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {error && <p className="text-sm text-[var(--negative-text)]">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          Creates draft invoices for {rows.length} student streams. Advance bills are not carried —
          create them when needed. {fromYear} stays untouched.
        </p>
        <button
          onClick={create}
          disabled={pending || rows.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating…" : `Create ${toYear} as Draft`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: page.tsx** — switch to `getYearContext` (house rule) and update the copy. Replace the year-loading lines and the intro `<p>`:

```ts
import { getYearContext } from "@/lib/dal/years";
```

replace

```ts
  const YEAR = await getCurrentYear();
  const years = (await listYears()).map((y) => y.label);
```

with

```ts
  const { currentYear: YEAR, years } = await getYearContext();
```

(and delete the now-unused `getCurrentYear, listYears` import). Replace the intro paragraph text with:

```tsx
          <p className="mt-0.5 text-sm text-text-secondary">
            Carry {plan.fromYear}&apos;s student counts forward as Draft invoices — the {plan.fromYear}{" "}
            intake becomes a returning batch. Prices and bills are not copied; set new-year prices on
            the Pricing master screen. Prior years are fully retained.
          </p>
```

- [ ] **Step 4: Verify**

Run: `npm test` → PASS. `npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/new-year/actions.ts app/(app)/new-year/page.tsx components/year/rollover-wizard.tsx
git commit -m "feat(rollover): counts-only wizard — promotion inputs, no billing projections"
```

---

### Task 6: `getPricingMaster` DAL (TDD)

**Files:**
- Create: `lib/dal/pricing-master.ts`
- Create: `lib/dal/pricing-master.test.ts`

- [ ] **Step 1: Write the failing test** — create `lib/dal/pricing-master.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getPricingMaster } from "./pricing-master";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const YEAR = "FY26–27";

describe("getPricingMaster", () => {
  it("returns per-account invoice rows with batches, numerics coerced, sorted", async () => {
    const rows = await getPricingMaster(SUPER, YEAR);
    expect(rows.length).toBeGreaterThan(0);

    const names = rows.map((r) => r.accountName);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);

    for (const acc of rows) {
      expect(acc.editable).toBe(true); // super-admin edits everything
      expect(acc.invoices.length).toBeGreaterThan(0); // accounts without invoices are omitted
      for (const inv of acc.invoices) {
        expect(typeof inv.students).toBe("number");
        expect(typeof inv.priceToUni).toBe("number");
        expect(typeof inv.priceToDatagami).toBe("number");
        expect(typeof inv.gstRate).toBe("number");
        for (const b of inv.batches) {
          expect(typeof b.count).toBe("number");
          if (b.priceToUni != null) expect(typeof b.priceToUni).toBe("number");
        }
      }
    }

    // The seeded cohort-driven old invoice surfaces its batches.
    const withBatches = rows.flatMap((r) => r.invoices).filter((i) => i.batches.length > 0);
    expect(withBatches.length).toBeGreaterThan(0);
  });

  it("returns [] for an unknown year", async () => {
    expect(await getPricingMaster(SUPER, "FY00–NOPE")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/dal/pricing-master.test.ts`
Expected: FAIL — cannot resolve `./pricing-master`.

- [ ] **Step 3: Implement** — create `lib/dal/pricing-master.ts`:

```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, accounts, cohorts, invoices } from "@/lib/db/schema";
import { canEdit, scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds } from "./accounts";

export interface PricingBatch {
  enrollmentYear: string;
  count: number;
  priceToUni: number | null; // null → falls back to the invoice price
  priceToDatagami: number | null;
}

export interface PricingInvoiceRow {
  invoiceId: number;
  category: string;
  semester: string;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number;
  tdsRate: number;
  advanceAdj: number;
  status: string;
  batches: PricingBatch[]; // non-empty → cohort-driven (students = Σ counts)
}

export interface PricingAccountRow {
  accountId: number;
  accountName: string;
  editable: boolean;
  invoices: PricingInvoiceRow[];
}

const CATEGORY_ORDER: Record<string, number> = { old: 0, new: 1, advance: 2 };

/**
 * Every visible account's invoices (+batches) for a year, for the /pricing
 * master screen. Same scoping as the accounts list: super-admin sees all,
 * sales sees assigned; `editable` mirrors canEdit per account. Accounts with
 * no invoices in the year are omitted. 3–4 queries total (no N+1).
 */
export async function getPricingMaster(
  user: SessionUser,
  yearLabel: string,
): Promise<PricingAccountRow[]> {
  const [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.label, yearLabel))
    .limit(1);
  if (!year) return [];

  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);
  const accRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]));
  if (!accRows.length) return [];

  const accountIds = accRows.map((a) => a.id);
  const invRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.yearId, year.id), inArray(invoices.accountId, accountIds)));
  const invIds = invRows.map((r) => r.id);
  const cohortRows = invIds.length
    ? await db.select().from(cohorts).where(inArray(cohorts.invoiceId, invIds))
    : [];

  const batchesByInvoice = new Map<number, PricingBatch[]>();
  for (const c of cohortRows) {
    const list = batchesByInvoice.get(c.invoiceId) ?? [];
    list.push({
      enrollmentYear: c.enrollmentYear,
      count: c.count,
      priceToUni: c.priceToUni == null ? null : Number(c.priceToUni),
      priceToDatagami: c.priceToDatagami == null ? null : Number(c.priceToDatagami),
    });
    batchesByInvoice.set(c.invoiceId, list);
  }

  const byAccount = new Map<number, PricingInvoiceRow[]>();
  for (const r of invRows) {
    const row: PricingInvoiceRow = {
      invoiceId: r.id,
      category: r.category,
      semester: r.semester,
      students: r.students,
      priceToUni: Number(r.priceToUni),
      priceToDatagami: Number(r.priceToDatagami),
      gstRate: Number(r.gstRate),
      tdsRate: Number(r.tdsRate),
      advanceAdj: Number(r.advanceAdj),
      status: r.status,
      batches: (batchesByInvoice.get(r.id) ?? []).sort((a, b) =>
        a.enrollmentYear.localeCompare(b.enrollmentYear),
      ),
    };
    const list = byAccount.get(r.accountId) ?? [];
    list.push(row);
    byAccount.set(r.accountId, list);
  }

  return accRows
    .filter((a) => byAccount.has(a.id))
    .map((a) => ({
      accountId: a.id,
      accountName: a.name,
      editable: canEdit(user, a.id, assigned),
      invoices: (byAccount.get(a.id) ?? []).sort(
        (x, y) =>
          (CATEGORY_ORDER[x.category] ?? 9) - (CATEGORY_ORDER[y.category] ?? 9) ||
          x.semester.localeCompare(y.semester),
      ),
    }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/dal/pricing-master.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dal/pricing-master.ts lib/dal/pricing-master.test.ts
git commit -m "feat(pricing): getPricingMaster DAL — year-wide accounts/invoices/batches read"
```

---

### Task 7: `/pricing` page, save action, and master table component

**Files:**
- Create: `app/(app)/pricing/actions.ts`
- Create: `app/(app)/pricing/page.tsx`
- Create: `components/pricing/pricing-master.tsx`

- [ ] **Step 1: actions.ts** — create `app/(app)/pricing/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { updateInvoice, setCohorts, type CohortInput } from "@/lib/dal/mutations";
import { canViewFinance } from "@/lib/dal/authz";
import { isUserError } from "@/lib/dal/errors";

export interface PricingEdit {
  accountId: number;
  invoiceId: number;
  invoice?: { students?: number; priceToUni?: number; priceToDatagami?: number };
  /** Full replacement batch list — sent only when a batch count/price changed. */
  cohorts?: CohortInput[];
}

export type SavePricingResult = { ok: true; saved: number } | { ok: false; error: string };

export async function savePricingAction(edits: PricingEdit[]): Promise<SavePricingResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const user = { id: Number(session.user.id), roles: session.user.roles };
  if (!canViewFinance(user)) {
    return { ok: false, error: "Pricing is available to Sales / Super Admin only" };
  }

  try {
    // Sequential loop over EDITED invoices only — each helper re-checks canEdit
    // and keeps the batch↔scalar sync, so the bulk screen inherits every
    // invariant for free. Bounded by the user's edit batch, not table size.
    const touched = new Set<number>();
    for (const e of edits) {
      if (e.invoice) await updateInvoice(user, e.invoiceId, e.invoice);
      if (e.cohorts) await setCohorts(user, e.invoiceId, e.cohorts);
      touched.add(e.accountId);
    }
    revalidatePath("/pricing");
    for (const id of touched) revalidatePath(`/accounts/${id}`);
    return { ok: true, saved: edits.length };
  } catch (e) {
    // Partial-save is possible (helpers already committed earlier edits); the
    // client refreshes only on ok, so surviving dirty cells simply re-diff.
    console.error("[pricing:save]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not save pricing changes." };
  }
}
```

- [ ] **Step 2: page.tsx** — create `app/(app)/pricing/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { Topbar } from "@/components/shell/topbar";
import { getYearContext } from "@/lib/dal/years";
import { canViewFinance } from "@/lib/dal/authz";
import { getPricingMaster } from "@/lib/dal/pricing-master";
import { PricingMaster } from "@/components/pricing/pricing-master";

export default async function PricingPage() {
  const session = await auth();
  const user = session!.user;
  const { currentYear: YEAR, years } = await getYearContext();
  const su = { id: Number(user.id), roles: user.roles };

  if (!canViewFinance(su)) {
    return (
      <>
        <Topbar section="Finance" title="Pricing master" user={user} years={years} currentYear={YEAR} />
        <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
          <p className="text-sm text-text-secondary">
            Pricing is available to Sales / Super Admin only.
          </p>
        </main>
      </>
    );
  }

  const rows = await getPricingMaster(su, YEAR);

  return (
    <>
      <Topbar section="Finance" title="Pricing master" user={user} years={years} currentYear={YEAR} />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">
            Student &amp; pricing master · {YEAR}
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Edit student counts and per-student prices for every account in one place. Batch prices
            lock per batch — a blank batch price falls back to the invoice price. Switch the year in
            the top bar to edit another year.
          </p>
        </div>
        <PricingMaster rows={rows} currentYear={YEAR} />
      </main>
    </>
  );
}
```

- [ ] **Step 3: component** — create `components/pricing/pricing-master.tsx`:

```tsx
"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { computeInvoice } from "@/lib/money/compute";
import type { Category, Semester, Status } from "@/lib/money/types";
import { yearOfStudy } from "@/lib/fy";
import { CATEGORY_LABEL, type ReportCategory } from "@/lib/money/report-view";
import { savePricingAction, type PricingEdit } from "@/app/(app)/pricing/actions";
import type { PricingAccountRow, PricingBatch, PricingInvoiceRow } from "@/lib/dal/pricing-master";

function streamLabel(inv: PricingInvoiceRow) {
  const base = CATEGORY_LABEL[inv.category as ReportCategory] ?? inv.category;
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "1st" : "2nd"} sem`;
}

/** Sparse per-invoice edits; display = edit ?? server value. Cleared on save. */
interface InvoiceEdits {
  students?: number;
  priceToUni?: number;
  priceToDatagami?: number;
  batches?: PricingBatch[]; // whole list, replaced when any batch cell changes
}

const cellCls =
  "tabular w-24 rounded-md border bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]";
const cleanCls = "border-border-strong";
const dirtyCls = "border-[var(--primary-border)] bg-[var(--primary-subtle)]";

export function PricingMaster({
  rows,
  currentYear,
}: {
  rows: PricingAccountRow[];
  currentYear: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<number, InvoiceEdits>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function patch(invoiceId: number, p: Partial<InvoiceEdits>) {
    setSavedMsg(null);
    setEdits((prev) => ({ ...prev, [invoiceId]: { ...prev[invoiceId], ...p } }));
  }
  function patchBatch(inv: PricingInvoiceRow, index: number, p: Partial<PricingBatch>) {
    setSavedMsg(null);
    setEdits((prev) => {
      const current = prev[inv.invoiceId]?.batches ?? inv.batches.map((b) => ({ ...b }));
      const batches = current.map((b, i) => (i === index ? { ...b, ...p } : b));
      return { ...prev, [inv.invoiceId]: { ...prev[inv.invoiceId], batches } };
    });
  }

  /** Merged view of an invoice with its pending edits applied. */
  function merged(inv: PricingInvoiceRow) {
    const e = edits[inv.invoiceId];
    const batches = e?.batches ?? inv.batches;
    const students = batches.length
      ? batches.reduce((a, b) => a + b.count, 0)
      : (e?.students ?? inv.students);
    return {
      students,
      priceToUni: e?.priceToUni ?? inv.priceToUni,
      priceToDatagami: e?.priceToDatagami ?? inv.priceToDatagami,
      batches,
    };
  }

  /** Diff → payload of actually-changed invoices (the save wire format). */
  const payload = useMemo<PricingEdit[]>(() => {
    const out: PricingEdit[] = [];
    for (const acc of rows) {
      if (!acc.editable) continue;
      for (const inv of acc.invoices) {
        const e = edits[inv.invoiceId];
        if (!e) continue;
        const entry: PricingEdit = { accountId: acc.accountId, invoiceId: inv.invoiceId };
        const scalar: NonNullable<PricingEdit["invoice"]> = {};
        if (e.students != null && e.students !== inv.students && inv.batches.length === 0)
          scalar.students = e.students;
        if (e.priceToUni != null && e.priceToUni !== inv.priceToUni) scalar.priceToUni = e.priceToUni;
        if (e.priceToDatagami != null && e.priceToDatagami !== inv.priceToDatagami)
          scalar.priceToDatagami = e.priceToDatagami;
        if (Object.keys(scalar).length) entry.invoice = scalar;
        if (e.batches && JSON.stringify(e.batches) !== JSON.stringify(inv.batches)) {
          entry.cohorts = e.batches.map((b) => ({
            enrollmentYear: b.enrollmentYear,
            count: b.count,
            priceToUni: b.priceToUni,
            priceToDatagami: b.priceToDatagami,
          }));
        }
        if (entry.invoice || entry.cohorts) out.push(entry);
      }
    }
    return out;
  }, [rows, edits]);

  const filtered = useMemo(
    () => rows.filter((r) => r.accountName.toLowerCase().includes(q.trim().toLowerCase())),
    [rows, q],
  );
  const totalStreams = useMemo(() => rows.reduce((a, r) => a + r.invoices.length, 0), [rows]);

  function save() {
    setError(null);
    setSavedMsg(null);
    if (!payload.length) return;
    startTransition(async () => {
      const res = await savePricingAction(payload);
      if (res.ok) {
        setEdits({});
        setSavedMsg(`Saved ${res.saved} invoice${res.saved === 1 ? "" : "s"}`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter accounts…"
          className="w-64 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
          aria-label="Filter accounts"
        />
        <div className="text-xs text-text-muted">
          {rows.length} accounts · {totalStreams} streams
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Stream / batch</th>
                <th className="px-3 py-2.5 text-right font-medium">Students</th>
                <th className="px-3 py-2.5 text-right font-medium">Price / uni</th>
                <th className="px-3 py-2.5 text-right font-medium">Price / Datagami</th>
                <th className="px-3 py-2.5 text-right font-medium">Billing</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="px-5 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => (
                <Fragment key={acc.accountId}>
                  {acc.invoices.map((inv, invIdx) => {
                    const d = merged(inv);
                    const computed = computeInvoice({
                      category: inv.category as Category,
                      semester: inv.semester as Semester,
                      students: d.students,
                      priceToUni: d.priceToUni,
                      priceToDatagami: d.priceToDatagami,
                      gstRate: inv.gstRate,
                      tdsRate: inv.tdsRate,
                      advanceAdj: inv.advanceAdj,
                      cohortPricing: d.batches.length
                        ? d.batches.map((b) => ({
                            count: b.count,
                            priceToUni: b.priceToUni,
                            priceToDatagami: b.priceToDatagami,
                          }))
                        : undefined,
                    });
                    const canType = acc.editable;
                    const isAdvance = inv.category === "advance";
                    const scalarStudents = d.batches.length === 0;
                    const e = edits[inv.invoiceId];
                    return (
                      <Fragment key={inv.invoiceId}>
                        <tr className="border-b border-border-subtle align-top last:border-0">
                          <td className="px-5 py-2 font-medium text-text-primary">
                            {invIdx === 0 ? acc.accountName : ""}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{streamLabel(inv)}</td>
                          <td className="px-3 py-2 text-right">
                            {isAdvance ? (
                              <span className="text-text-muted">—</span>
                            ) : scalarStudents ? (
                              canType ? (
                                <input
                                  type="number"
                                  value={e?.students ?? inv.students}
                                  onChange={(ev) =>
                                    patch(inv.invoiceId, {
                                      students: parseInt(ev.target.value, 10) || 0,
                                    })
                                  }
                                  aria-label={`${acc.accountName} ${streamLabel(inv)} students`}
                                  className={`${cellCls} w-20 ${
                                    e?.students != null && e.students !== inv.students
                                      ? dirtyCls
                                      : cleanCls
                                  }`}
                                />
                              ) : (
                                <span className="tabular">{inv.students}</span>
                              )
                            ) : (
                              <span className="tabular text-text-secondary">Σ {d.students}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canType ? (
                              <input
                                type="number"
                                value={e?.priceToUni ?? inv.priceToUni}
                                onChange={(ev) =>
                                  patch(inv.invoiceId, {
                                    priceToUni: parseFloat(ev.target.value) || 0,
                                  })
                                }
                                aria-label={`${acc.accountName} ${streamLabel(inv)} price to uni`}
                                className={`${cellCls} ${
                                  e?.priceToUni != null && e.priceToUni !== inv.priceToUni
                                    ? dirtyCls
                                    : cleanCls
                                }`}
                              />
                            ) : (
                              <span className="tabular">{inv.priceToUni}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canType ? (
                              <input
                                type="number"
                                value={e?.priceToDatagami ?? inv.priceToDatagami}
                                onChange={(ev) =>
                                  patch(inv.invoiceId, {
                                    priceToDatagami: parseFloat(ev.target.value) || 0,
                                  })
                                }
                                aria-label={`${acc.accountName} ${streamLabel(inv)} price to Datagami`}
                                className={`${cellCls} ${
                                  e?.priceToDatagami != null &&
                                  e.priceToDatagami !== inv.priceToDatagami
                                    ? dirtyCls
                                    : cleanCls
                                }`}
                              />
                            ) : (
                              <span className="tabular">{inv.priceToDatagami}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={computed.billing} compact />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={computed.netMargin} compact tone="auto" />
                          </td>
                          <td className="px-5 py-2 text-right">
                            <StatusBadge status={inv.status as Status} />
                          </td>
                        </tr>
                        {d.batches.map((b, bi) => {
                          const yos = yearOfStudy(b.enrollmentYear, currentYear);
                          const orig = inv.batches[bi];
                          return (
                            <tr
                              key={`${inv.invoiceId}:${b.enrollmentYear}`}
                              className="border-b border-border-subtle bg-surface-sunken/50 align-top last:border-0"
                            >
                              <td />
                              <td className="py-1.5 pl-8 pr-3 text-xs text-text-secondary">
                                {yos ? (
                                  <>
                                    <span className="font-medium text-text-primary">{yos}</span>{" "}
                                    <span className="text-text-muted">· {b.enrollmentYear}</span>
                                  </>
                                ) : (
                                  b.enrollmentYear
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number"
                                    value={b.count}
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        count: parseInt(ev.target.value, 10) || 0,
                                      })
                                    }
                                    aria-label={`Batch ${b.enrollmentYear} count`}
                                    className={`${cellCls} w-20 ${
                                      orig && b.count !== orig.count ? dirtyCls : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.count}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number"
                                    value={b.priceToUni ?? ""}
                                    placeholder="invoice"
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        priceToUni:
                                          ev.target.value === ""
                                            ? null
                                            : parseFloat(ev.target.value) || 0,
                                      })
                                    }
                                    aria-label={`Batch ${b.enrollmentYear} price to uni`}
                                    className={`${cellCls} ${
                                      orig && b.priceToUni !== orig.priceToUni ? dirtyCls : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.priceToUni ?? "—"}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number"
                                    value={b.priceToDatagami ?? ""}
                                    placeholder="invoice"
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        priceToDatagami:
                                          ev.target.value === ""
                                            ? null
                                            : parseFloat(ev.target.value) || 0,
                                      })
                                    }
                                    aria-label={`Batch ${b.enrollmentYear} price to Datagami`}
                                    className={`${cellCls} ${
                                      orig && b.priceToDatagami !== orig.priceToDatagami
                                        ? dirtyCls
                                        : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.priceToDatagami ?? "—"}</span>
                                )}
                              </td>
                              <td colSpan={3} />
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-border bg-surface p-3 shadow-sm">
        <div className="text-sm">
          {error ? (
            <span className="text-[var(--negative-text)]">{error}</span>
          ) : savedMsg ? (
            <span className="text-[var(--positive-text)]">{savedMsg}</span>
          ) : payload.length ? (
            <span className="text-text-secondary">
              {payload.length} invoice{payload.length === 1 ? "" : "s"} with unsaved changes
            </span>
          ) : (
            <span className="text-text-muted">No unsaved changes</span>
          )}
        </div>
        <button
          onClick={save}
          disabled={pending || payload.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save ${payload.length || ""} change${payload.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify types + lint**

Run: `npx tsc --noEmit` → clean. `npm run lint` → clean. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/pricing components/pricing/pricing-master.tsx
git commit -m "feat(pricing): /pricing master screen — bulk edit counts, prices and batch pricing"
```

---

### Task 8: Sidebar entry + end-to-end verification

**Files:**
- Modify: `components/shell/sidebar.tsx`

- [ ] **Step 1: Sidebar** — in `FINANCE_BASE`, insert after the `Accounts` item:

```ts
  { label: "Pricing master", href: "/pricing", icon: "M3 3h8l10 10-8 8L3 13zM7.5 7.5h.01" },
```

- [ ] **Step 2: Full test + lint + typecheck**

Run: `npm test` → all PASS. `npm run lint` → clean. `npx tsc --noEmit` → clean.

- [ ] **Step 3: Browser verification** (preview tools, dev server from `.claude/launch.json` — create the launch entry if missing with `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, port 3000):

1. Open `/pricing`: table renders grouped accounts, batch sub-rows under old invoices, filter box works.
2. Edit a price and a batch count → dirty highlight appears, footer shows "1 invoice with unsaved changes" (or 2).
3. Save → success message; reload; values persisted. Cross-check the same account's `/accounts/[id]` Students tab shows the new values.
4. Open `/new-year`: wizard shows counts-only table — no billing/margin projections, new-intake rows show "→ old batch FY26–27" + "fresh intake" inputs, scalar-old rows show the "becomes batch FY25–26" hint.
5. Screenshot both screens for the user.
6. **Do not click "Create … as Draft" against the real local year unless the user asks** — the rollover integration tests already cover the write path; if a manual run is wanted, use a throwaway target label (e.g. `FY95–UI`) and delete it after via the test helper pattern.

- [ ] **Step 4: Commit**

```bash
git add components/shell/sidebar.tsx
git commit -m "feat(pricing): sidebar entry for the pricing master screen"
```

---

## Post-plan checks (executor)

- Spec parity: counts-only rollover (§decision 4), promotion (§Part 3), FY naming + migration (§Parts 1–2), master screen (§Part 4) — all covered by Tasks 1–8.
- The old wizard's billing/margin projections are intentionally gone; do not "helpfully" re-add them.
- Never run `scripts/db-migrate.ts --prod`; production migrates on deploy.
