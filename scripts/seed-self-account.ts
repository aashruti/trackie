/**
 * Dev utility: create a Datagami self-supplied account (own product, no external
 * OEM transfer) to demonstrate that scenario. Run: tsx scripts/seed-self-account.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";

const ACCOUNT_NAME = "Datagami Academy (own product)";
const YEAR = "FY26–27";

async function main() {
  const { db } = await import("../lib/db/client");
  const t = await import("../lib/db/schema");

  // Self OEM (Datagami itself).
  let [self] = await db.select().from(t.oems).where(eq(t.oems.name, "Datagami"));
  if (!self) {
    [self] = await db.insert(t.oems).values({ name: "Datagami", isSelf: true }).returning();
  } else if (!self.isSelf) {
    await db.update(t.oems).set({ isSelf: true }).where(eq(t.oems.id, self.id));
  }

  const [year] = await db.select().from(t.academicYears).where(eq(t.academicYears.label, YEAR));
  if (!year) throw new Error(`Year ${YEAR} not found — run the main seed first`);

  // Replace any prior demo account of this name (delete its invoices first —
  // the invoices→accounts FK has no cascade; cohorts cascade from invoices).
  const prior = await db.select().from(t.accounts).where(eq(t.accounts.name, ACCOUNT_NAME));
  for (const p of prior) {
    await db.delete(t.invoices).where(eq(t.invoices.accountId, p.id));
    await db.delete(t.accounts).where(eq(t.accounts.id, p.id));
  }
  const [acc] = await db
    .insert(t.accounts)
    .values({ name: ACCOUNT_NAME, type: "programme", oemId: self.id })
    .returning();

  // Full multi-invoice practice for an own product: advance + old (with cohorts)
  // + new, semester-split — exactly like an OEM account, minus the OEM transfer.
  const base = { yearId: year.id, gstRate: "0.18", tdsRate: "0.10", advanceAdj: "0", priceToDatagami: "0" };
  const mk = (
    category: "advance" | "old" | "new",
    semester: "none" | "1" | "2",
    students: number,
    priceToUni: string,
  ) =>
    db
      .insert(t.invoices)
      .values({ accountId: acc.id, category, semester, students, priceToUni, status: "raised", ...base })
      .returning();

  const [advance] = await mk("advance", "none", 1, "500000"); // ₹5L token prepayment
  const [old1] = await mk("old", "1", 90, "28000");
  const [old2] = await mk("old", "2", 90, "28000");
  await mk("new", "1", 150, "28000");
  await mk("new", "2", 150, "28000");

  // Old-student cohort distribution (2nd/3rd/4th year) for the two old invoices.
  const cohortsFor = (invoiceId: number) =>
    db.insert(t.cohorts).values([
      { invoiceId, enrollmentYear: "2025-26", count: 50 },
      { invoiceId, enrollmentYear: "2024-25", count: 30 },
      { invoiceId, enrollmentYear: "2023-24", count: 10 },
    ]);
  await cohortsFor(old1.id);
  await cohortsFor(old2.id);

  console.log(
    `Self-supplied account ready: "${ACCOUNT_NAME}" (id ${acc.id}), OEM "Datagami" (self).\n` +
      `Invoices: advance(${advance.id}) ₹5L prepayment, old 1st/2nd (90 ea, cohorts), new 1st/2nd (150 ea). ` +
      `No OEM transfer; advance = 0-margin prepayment.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
