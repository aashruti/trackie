/**
 * Import IBM university accounts from the Excel into production.
 * Creates: OEMs (IBM, AAFM), academic year FY26–27, accounts, invoices, cohorts.
 * IDEMPOTENT: skips accounts whose name already exists.
 *
 * Run against production:
 *   DATABASE_URL="<neon-prod-url>" npx tsx scripts/import-ibm-accounts.ts
 *
 * Or:
 *   vercel env pull .env.production.local && \
 *   npx tsx --env-file=.env.production.local scripts/import-ibm-accounts.ts
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import * as t from "../lib/db/schema";

// ---------------------------------------------------------------------------
// Parsed data from "IBM UNIVERSITY FULL DETAILS.xlsx"
// Prices are per-student per-semester (for split-semester universities the
// formula was =annualPrice/2; we store the per-semester price as-is since
// each semester generates its own invoice cohort entry).
// ---------------------------------------------------------------------------
const ACCOUNTS = [
  {
    name: "Pillai University",         oem: "IBM",  priceToUni: 21200, priceToDG: 18500,
    invoiceDate: "2026-04-15",
    cohorts: { "2026-27": 180 },
  },
  {
    name: "G.H.Raisoni University",    oem: "IBM",  priceToUni: 25000, priceToDG: 21000,
    invoiceDate: "2026-03-19",
    cohorts: { "2026-27": 120 },
  },
  {
    name: "Amity University",          oem: "IBM",  priceToUni: 25000, priceToDG: 21000,
    invoiceDate: null,
    cohorts: { "2026-27": 240 },
  },
  {
    name: "Kaveri University",         oem: "IBM",  priceToUni: 20000, priceToDG: 21000,
    invoiceDate: "2026-03-19",
    cohorts: { "2026-27": 120 },
  },
  {
    name: "Indira University",         oem: "IBM",  priceToUni: 30000, priceToDG: 18500,
    invoiceDate: "2026-03-14",
    cohorts: { "2026-27": 300 },
  },
  {
    name: "Sankalchand Patel University", oem: "IBM", priceToUni: 25483, priceToDG: 18500,
    invoiceDate: "2026-03-19",
    cohorts: { "2026-27": 240 },
  },
  {
    name: "MGM University",            oem: "IBM",  priceToUni: 30000, priceToDG: 20000,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 340, "2025-26": 169 },
  },
  {
    name: "Gurunanak University",      oem: "IBM",  priceToUni: 35000, priceToDG: 21500,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 340, "2025-26": 160 },
  },
  {
    name: "Bhartiya Vidhyapeeth University", oem: "IBM", priceToUni: 25483, priceToDG: 20000,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 60, "2025-26": 10 },
  },
  {
    name: "Marwadi University",        oem: "IBM",  priceToUni: 32000, priceToDG: 20000,
    invoiceDate: "2026-05-25",
    cohorts: { "2026-27": 60, "2025-26": 37 },
  },
  {
    name: "C.V.Raman University",      oem: "IBM",  priceToUni: 24500, priceToDG: 20000,
    invoiceDate: null,
    cohorts: { "2025-26": 30, "2024-25": 19 },
  },
  {
    name: "Scope Global Skills University", oem: "IBM", priceToUni: 24500, priceToDG: 20000,
    invoiceDate: "2026-04-16",
    cohorts: { "2025-26": 12, "2024-25": 18 },
  },
  {
    name: "UOW",                       oem: "IBM",  priceToUni: 29661, priceToDG: 22500,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 9, "2025-26": 9, "2024-25": 8 },
  },
  {
    name: "Transstadia University (Ahmedabad)", oem: "IBM", priceToUni: 29661, priceToDG: 22500,
    invoiceDate: "2026-04-07",
    cohorts: { "2026-27": 15, "2025-26": 11, "2024-25": 8, "2023-24": 14 },
  },
  {
    name: "Transstadia University (Mumbai)",    oem: "IBM", priceToUni: 29661, priceToDG: 22500,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 25, "2025-26": 25, "2024-25": 14, "2023-24": 15 },
  },
  {
    name: "Sri Sri University",        oem: "IBM",  priceToUni: 22900, priceToDG: 17400,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 120, "2025-26": 110, "2024-25": 128, "2023-24": 108, "2022-23": 49 },
  },
  {
    name: "Auro University",           oem: "IBM",  priceToUni: 29661, priceToDG: 21500,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 50, "2025-26": 71, "2024-25": 63, "2023-24": 50, "2022-23": 38 },
  },
  {
    name: "Kalinga University",        oem: "IBM",  priceToUni: 29661, priceToDG: 21000,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 276, "2025-26": 264, "2024-25": 164, "2023-24": 100 },
  },
  {
    name: "Medicaps University",       oem: "IBM",  priceToUni: 27000, priceToDG: 20000,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 700, "2025-26": 538 },
  },
  {
    name: "Sri Sai University",        oem: "IBM",  priceToUni: 29661, priceToDG: 21500,
    invoiceDate: "2026-04-16",
    cohorts: { "2026-27": 240, "2025-26": 194, "2024-25": 174, "2023-24": 152, "2022-23": 66 },
  },
  {
    name: "Medicaps DG Programme",     oem: "AAFM", priceToUni: 210000, priceToDG: 147000,
    invoiceDate: null,
    cohorts: { "2026-27": 60 },
  },
] as const;

async function main() {
  const { db } = await import("../lib/db/client");

  // Ensure OEMs exist
  const oemIds: Record<string, number> = {};
  for (const oemName of ["IBM", "AAFM"]) {
    const [existing] = await db.select().from(t.oems).where(eq(t.oems.name, oemName)).limit(1);
    if (existing) {
      oemIds[oemName] = existing.id;
      console.log(`  OEM ${oemName} already exists (id=${existing.id})`);
    } else {
      const [row] = await db.insert(t.oems).values({ name: oemName }).returning();
      oemIds[oemName] = row.id;
      console.log(`  Created OEM ${oemName} (id=${row.id})`);
    }
  }

  // Ensure academic year FY26–27 exists
  const yearLabel = "FY26–27"; // "FY26–27" with en-dash
  let yearId: number;
  const [existingYear] = await db.select().from(t.academicYears).where(eq(t.academicYears.label, yearLabel)).limit(1);
  if (existingYear) {
    yearId = existingYear.id;
    console.log(`  Academic year ${yearLabel} already exists (id=${yearId})`);
  } else {
    const [row] = await db.insert(t.academicYears).values({ label: yearLabel }).returning();
    yearId = row.id;
    console.log(`  Created academic year ${yearLabel} (id=${yearId})`);
  }

  let created = 0, skipped = 0;

  for (const acc of ACCOUNTS) {
    // Idempotent: skip if account name already exists
    const [existing] = await db.select().from(t.accounts).where(eq(t.accounts.name, acc.name)).limit(1);
    if (existing) {
      console.log(`  ↷  Skip  "${acc.name}" (already exists)`);
      skipped++;
      continue;
    }

    const totalStudents = Object.values(acc.cohorts).reduce((s, n) => s + n, 0);

    const [account] = await db
      .insert(t.accounts)
      .values({ name: acc.name, oemId: oemIds[acc.oem] })
      .returning();

    const [invoice] = await db
      .insert(t.invoices)
      .values({
        accountId: account.id,
        yearId,
        category: "new",
        semester: "none",
        students: totalStudents,
        priceToUni: String(acc.priceToUni),
        priceToDatagami: String(acc.priceToDG),
        gstRate: "0.18",
        tdsRate: "0.10",
        advanceAdj: "0",
        invoiceDate: acc.invoiceDate ?? null,
        status: "raised",
      })
      .returning();

    await db.insert(t.cohorts).values(
      Object.entries(acc.cohorts).map(([enrollmentYear, count]) => ({
        invoiceId: invoice.id,
        enrollmentYear,
        count,
      })),
    );

    console.log(
      `  ✓  ${acc.name}  (${acc.oem}, ${totalStudents} students, ` +
        `${Object.keys(acc.cohorts).length} cohort(s), priceUni=₹${acc.priceToUni.toLocaleString()})`,
    );
    created++;
  }

  console.log(`\nDone: ${created} accounts created, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
