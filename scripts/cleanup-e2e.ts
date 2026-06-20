/**
 * Remove the throwaway "Test E2E University" account (and its invoices/payments/
 * cohorts) created during end-to-end testing, so it doesn't skew the portfolio.
 * Leads/tasks test data is reset separately by `npm run db:seed-workspace`.
 *
 * Run: npx tsx scripts/cleanup-e2e.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, inArray } from "drizzle-orm";
import * as t from "../lib/db/schema";

// Accounts created only during end-to-end testing / lead-conversion demos.
const TEST_ACCOUNT_NAMES = ["Test E2E University", "Bennett University", "Convert Test University"];

async function main() {
  const { db } = await import("../lib/db/client");

  const accs = await db
    .select({ id: t.accounts.id })
    .from(t.accounts)
    .where(inArray(t.accounts.name, TEST_ACCOUNT_NAMES));

  if (!accs.length) {
    console.log("No 'Test E2E University' account found — nothing to clean.");
    process.exit(0);
  }

  let invCount = 0;
  for (const acc of accs) {
    const invs = await db.select({ id: t.invoices.id }).from(t.invoices).where(eq(t.invoices.accountId, acc.id));
    const invIds = invs.map((i) => i.id);
    if (invIds.length) {
      await db.delete(t.payments).where(inArray(t.payments.invoiceId, invIds));
      await db.delete(t.cohorts).where(inArray(t.cohorts.invoiceId, invIds));
      await db.delete(t.invoices).where(inArray(t.invoices.id, invIds));
      invCount += invIds.length;
    }
    await db.delete(t.userAccounts).where(eq(t.userAccounts.accountId, acc.id));
    await db.delete(t.accounts).where(eq(t.accounts.id, acc.id));
  }

  console.log(`Removed ${accs.length} test account(s) and ${invCount} invoice(s) + payments/cohorts.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
