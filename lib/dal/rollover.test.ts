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
