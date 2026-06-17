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

  // Replace any prior demo account of this name.
  await db.delete(t.accounts).where(eq(t.accounts.name, ACCOUNT_NAME));
  const [acc] = await db
    .insert(t.accounts)
    .values({ name: ACCOUNT_NAME, type: "programme", oemId: self.id })
    .returning();

  // One "new students" invoice — own product, no OEM cost.
  const [inv] = await db
    .insert(t.invoices)
    .values({
      accountId: acc.id,
      yearId: year.id,
      category: "new",
      semester: "none",
      students: 150,
      priceToUni: "28000",
      priceToDatagami: "0", // no internal cost → full margin
      gstRate: "0.18",
      tdsRate: "0.10",
      advanceAdj: "0",
      status: "raised",
    })
    .returning();

  console.log(
    `Self-supplied account ready: "${ACCOUNT_NAME}" (id ${acc.id}), OEM "Datagami" (self), ` +
      `1 invoice id ${inv.id}: 150 students × ₹28,000, no OEM transfer → margin ₹42,00,000.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
