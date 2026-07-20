import { describe, it, expect, afterAll } from "vitest";
import { rolloverYear, deleteYear } from "./rollover";
import { listAccountsForUser } from "./accounts";

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

describe("rolloverYear", () => {
  it("clones the year as Draft and retains the source year untouched", async () => {
    const before = await invoiceCount(FROM);
    const accountCount = (await listAccountsForUser(SUPER, FROM)).length;

    const res = await rolloverYear(SUPER, FROM, TO, {});
    expect(res.invoicesCreated).toBeGreaterThan(0);
    expect(res.accountsRolled).toBe(accountCount);

    // Source year unchanged → history retained.
    expect(await invoiceCount(FROM)).toBe(before);
    // Target year now has the same number of invoices, all draft.
    expect(await invoiceCount(TO)).toBe(before);

    // New year shows up scoped to the user.
    const rows = await listAccountsForUser(SUPER, TO);
    expect(rows.length).toBe(accountCount);
  });

  it("is idempotent — re-running skips already-populated accounts", async () => {
    const accountCount = (await listAccountsForUser(SUPER, FROM)).length;
    const res = await rolloverYear(SUPER, FROM, TO, {});
    expect(res.skipped).toBe(accountCount);
    expect(res.invoicesCreated).toBe(0);
  });

  afterAll(async () => {
    await deleteYear(SUPER, TO);
  });
});

describe("rolloverYear carries cohort prices forward", () => {
  const CARRY = "FY98–CARRY";
  let cohortId: number | null = null;

  it("clones each cohort's locked price into the new year", async () => {
    const { db } = await import("@/lib/db/client");
    const { invoices, cohorts, accounts, academicYears } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");

    // Pick an old-student invoice (Kalinga) with cohorts in the source year.
    const [acc] = await db.select().from(accounts).where(eq(accounts.name, "Kalinga University"));
    const [fromYear] = await db.select().from(academicYears).where(eq(academicYears.label, FROM));
    const [oldInv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, acc.id), eq(invoices.yearId, fromYear.id), eq(invoices.category, "old")));
    const [cohort] = await db.select().from(cohorts).where(eq(cohorts.invoiceId, oldInv.id));
    cohortId = cohort.id;

    // Set a marker locked price on that cohort.
    await db.update(cohorts).set({ priceToUni: "22222", priceToDatagami: "11111" }).where(eq(cohorts.id, cohort.id));

    await rolloverYear(SUPER, FROM, CARRY, {});

    // The cloned old-student invoice's cohorts should carry the marker price.
    const [toYear] = await db.select().from(academicYears).where(eq(academicYears.label, CARRY));
    const [clonedInv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, acc.id), eq(invoices.yearId, toYear.id), eq(invoices.category, "old"), eq(invoices.semester, oldInv.semester)));
    const cloned = await db.select().from(cohorts).where(eq(cohorts.invoiceId, clonedInv.id));
    expect(cloned.some((c) => Number(c.priceToUni) === 22222 && Number(c.priceToDatagami) === 11111)).toBe(true);
  });

  afterAll(async () => {
    await deleteYear(SUPER, CARRY);
    if (cohortId != null) {
      const { db } = await import("@/lib/db/client");
      const { cohorts } = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(cohorts).set({ priceToUni: null, priceToDatagami: null }).where(eq(cohorts.id, cohortId));
    }
  });
});

describe("rolloverYear applies per-cohort count overrides", () => {
  const COVR = "FY97–COVR";

  it("clones cohorts with the overridden count and syncs invoice.students to the sum", async () => {
    const { db } = await import("@/lib/db/client");
    const { invoices, cohorts, accounts, academicYears } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const [acc] = await db.select().from(accounts).where(eq(accounts.name, "Kalinga University"));
    const [fromYear] = await db.select().from(academicYears).where(eq(academicYears.label, FROM));
    const [oldInv] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, acc.id), eq(invoices.yearId, fromYear.id), eq(invoices.category, "old")));
    const srcCohorts = await db.select().from(cohorts).where(eq(cohorts.invoiceId, oldInv.id));
    expect(srcCohorts.length).toBeGreaterThan(0);
    const target = srcCohorts[0];
    const newCount = target.count + 7;

    await rolloverYear(SUPER, FROM, COVR, {}, { [oldInv.id]: { [target.enrollmentYear]: newCount } });

    const [toYear] = await db.select().from(academicYears).where(eq(academicYears.label, COVR));
    const [clonedInv] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.accountId, acc.id),
          eq(invoices.yearId, toYear.id),
          eq(invoices.category, "old"),
          eq(invoices.semester, oldInv.semester),
        ),
      );
    const cloned = await db.select().from(cohorts).where(eq(cohorts.invoiceId, clonedInv.id));
    const match = cloned.find((c) => c.enrollmentYear === target.enrollmentYear);
    expect(match?.count).toBe(newCount); // override applied to the cohort
    // invoice.students is kept in sync with the cohort sum (the engine's basis).
    expect(clonedInv.students).toBe(cloned.reduce((a, c) => a + c.count, 0));
  });

  afterAll(async () => {
    await deleteYear(SUPER, COVR);
  });
});
