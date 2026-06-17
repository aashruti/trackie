import { describe, it, expect, afterAll } from "vitest";
import { rolloverYear, deleteYear } from "./rollover";
import { listAccountsForUser } from "./accounts";

const SUPER = { id: 1, role: "super-admin" as const };
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
