/**
 * Seed the database from the source Excel.
 * Idempotent: truncates the domain tables first, then imports all 21 accounts,
 * the FY26–27 year, their invoices + cohorts, and one Super Admin user.
 *
 * Run: npm run db:seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import * as t from "../lib/db/schema";
import { parseSheet } from "./excel-parse";
import { hashPassword } from "../lib/auth/password";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";

async function main() {
  // Import the client AFTER dotenv has populated DATABASE_URL (static imports
  // are hoisted above config(), so the connection must be deferred).
  const { db } = await import("../lib/db/client");

  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const parsedAll = wb.SheetNames.map((s) => parseSheet(XLSX_PATH, s)).filter(
    (p) => p.invoices.length > 0,
  );

  // Reset domain tables (cascade clears cohorts/payments/invoices/user_accounts).
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE payments, cohorts, invoices, user_accounts, accounts, academic_years, oems, users RESTART IDENTITY CASCADE`,
    ),
  );

  // OEMs
  const oemNames = [...new Set(parsedAll.map((p) => p.account.oem))];
  const oemRows = await db.insert(t.oems).values(oemNames.map((name) => ({ name }))).returning();
  const oemId = (n: string) => oemRows.find((o) => o.name === n)!.id;

  // Academic year
  const [year] = await db.insert(t.academicYears).values({ label: "FY26–27" }).returning();

  let invoiceCount = 0;
  let cohortCount = 0;
  for (const p of parsedAll) {
    const [acc] = await db
      .insert(t.accounts)
      .values({ name: p.account.name, type: p.account.type, oemId: oemId(p.account.oem) })
      .returning();

    for (const inv of p.invoices) {
      const [row] = await db
        .insert(t.invoices)
        .values({
          accountId: acc.id,
          yearId: year.id,
          category: inv.category,
          semester: inv.semester,
          students: inv.students,
          priceToUni: String(inv.priceToUni),
          priceToDatagami: String(inv.priceToDatagami),
          gstRate: String(inv.gstRate),
          tdsRate: String(inv.tdsRate),
          advanceAdj: String(inv.advanceAdj),
          invoiceDate: inv.invoiceDate,
          status: inv.status,
        })
        .returning();
      invoiceCount++;

      if (inv.cohorts.length) {
        await db.insert(t.cohorts).values(
          inv.cohorts.map((c) => ({
            invoiceId: row.id,
            enrollmentYear: c.enrollmentYear,
            count: c.count,
          })),
        );
        cohortCount += inv.cohorts.length;
      }
    }
  }

  await db.insert(t.users).values({
    name: "Super Admin",
    email: "admin@datagami.local",
    passwordHash: await hashPassword("changeme123"),
    role: "super-admin",
  });

  console.log(
    `Seeded: ${parsedAll.length} accounts, ${oemNames.length} OEMs (${oemNames.join(", ")}), ` +
      `year FY26–27, ${invoiceCount} invoices, ${cohortCount} cohort rows.\n` +
      `Super Admin: admin@datagami.local / changeme123`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
