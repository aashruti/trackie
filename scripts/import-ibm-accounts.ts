/**
 * Wipe all account/invoice/cohort/payment data and re-import from Excel.
 * Keeps users, OEMs, academic years, tasks, and leads intact.
 *
 * Run against production:
 *   npx tsx scripts/import-ibm-accounts.ts
 */
import { config } from "dotenv";
if (process.env.IMPORT_LOCAL) {
  config({ path: ".env.local" });
} else {
  config({ path: ".env.production.local" });
  config({ path: ".env.local" });
}

import { eq } from "drizzle-orm";
import * as t from "../lib/db/schema";

type Payment = { date: string; amount: number };
type Cohort = { year: string; count: number };

type InvoiceSpec = {
  category: "advance" | "old" | "new";
  semester: "none" | "1" | "2";
  students: number;
  priceToUni: number;
  priceToDG: number;
  invoiceDate: string | null;
  status: "raised" | "partially-paid" | "paid";
  cohorts?: Cohort[];
  payments?: Payment[];
};

type AccountSpec = {
  name: string;
  oem: string;
  invoices: InvoiceSpec[];
};

// ---------------------------------------------------------------------------
// Source: "IBM UNIVERSITY FULL DETAILS.xlsx" + "IBM PI AND PAYMENT FILE.xlsx"
// Batch labels: FY26-27 = current year (new students), FY25-26 = 2nd year, etc.
// ---------------------------------------------------------------------------
const ACCOUNTS: AccountSpec[] = [
  {
    name: "Pillai University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-15", status: "paid",
        payments: [{ date: "2026-04-16", amount: 1080000 }],
      },
      {
        category: "new", semester: "none", students: 180,
        priceToUni: 21200, priceToDG: 18500,
        invoiceDate: "2026-04-15", status: "raised",
      },
    ],
  },
  {
    name: "G.H.Raisoni University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 500000, priceToDG: 500000,
        invoiceDate: "2026-05-08", status: "paid",
        payments: [{ date: "2026-06-05", amount: 540000 }],
      },
      {
        category: "new", semester: "none", students: 120,
        priceToUni: 25000, priceToDG: 21000,
        invoiceDate: "2026-05-08", status: "raised",
      },
    ],
  },
  {
    // Semester-split — no advance raised yet
    name: "Amity University",
    oem: "IBM",
    invoices: [
      {
        category: "new", semester: "1", students: 120,
        priceToUni: 12500, priceToDG: 10500,
        invoiceDate: null, status: "raised",
      },
      {
        category: "new", semester: "2", students: 120,
        priceToUni: 12500, priceToDG: 10500,
        invoiceDate: null, status: "raised",
      },
    ],
  },
  {
    name: "Kaveri University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 500000, priceToDG: 500000,
        invoiceDate: "2026-03-19", status: "paid",
        payments: [
          { date: "2026-03-24", amount: 450000 },
          { date: "2026-04-24", amount: 90000 },
        ],
      },
      {
        category: "new", semester: "none", students: 120,
        priceToUni: 20000, priceToDG: 21000,
        invoiceDate: "2026-03-19", status: "raised",
      },
    ],
  },
  {
    name: "Indira University",
    oem: "IBM",
    invoices: [
      {
        // PI 2026Prof0085 shows 2000000; payment confirms (2160000 = 2M×1.08)
        category: "advance", semester: "none", students: 1,
        priceToUni: 2000000, priceToDG: 2000000,
        invoiceDate: "2026-03-14", status: "paid",
        payments: [{ date: "2026-05-28", amount: 2160000 }],
      },
      {
        category: "new", semester: "none", students: 300,
        priceToUni: 30000, priceToDG: 18500,
        invoiceDate: "2026-03-14", status: "raised",
      },
    ],
  },
  {
    name: "Sankalchand Patel University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-03-19", status: "paid",
        payments: [{ date: "2026-04-02", amount: 1160000 }],
      },
      {
        category: "new", semester: "none", students: 240,
        priceToUni: 25483, priceToDG: 18500,
        invoiceDate: "2026-03-19", status: "raised",
      },
    ],
  },
  {
    name: "MGM University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "paid",
        payments: [{ date: "2026-06-15", amount: 1160000 }],
      },
      {
        category: "old", semester: "none", students: 169,
        priceToUni: 30000, priceToDG: 20000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 169 }],
      },
      {
        category: "new", semester: "none", students: 340,
        priceToUni: 30000, priceToDG: 20000,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "GNA University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "paid",
        payments: [{ date: "2026-06-16", amount: 1080000 }],
      },
      {
        category: "old", semester: "none", students: 160,
        priceToUni: 35000, priceToDG: 21500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 160 }],
      },
      {
        category: "new", semester: "none", students: 340,
        priceToUni: 35000, priceToDG: 21500,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Bhartiya Vidhyapeeth University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "none", students: 10,
        priceToUni: 25483, priceToDG: 20000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 10 }],
      },
      {
        category: "new", semester: "none", students: 60,
        priceToUni: 25483, priceToDG: 20000,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Marwadi University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-05-25", status: "raised",
      },
      {
        category: "old", semester: "none", students: 37,
        priceToUni: 32000, priceToDG: 20000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 37 }],
      },
      {
        category: "new", semester: "none", students: 60,
        priceToUni: 32000, priceToDG: 20000,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    // No new students this year; no advance raised
    name: "C.V.Raman University",
    oem: "IBM",
    invoices: [
      {
        category: "old", semester: "none", students: 49,
        priceToUni: 24500, priceToDG: 20000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 30 },
          { year: "FY24-25", count: 19 },
        ],
      },
    ],
  },
  {
    // No new students this year
    name: "Scope Global Skills University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "none", students: 30,
        priceToUni: 24500, priceToDG: 20000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 12 },
          { year: "FY24-25", count: 18 },
        ],
      },
    ],
  },
  {
    name: "UOW",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 2000000, priceToDG: 2000000,
        invoiceDate: "2026-04-16", status: "partially-paid",
        payments: [{ date: "2026-06-19", amount: 1800000 }],
      },
      {
        category: "old", semester: "none", students: 17,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 9 },
          { year: "FY24-25", count: 8 },
        ],
      },
      {
        category: "new", semester: "none", students: 9,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Transstadia University (Ahmedabad)",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "none", students: 33,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 11 },
          { year: "FY24-25", count: 8 },
          { year: "FY23-24", count: 14 },
        ],
      },
      {
        category: "new", semester: "none", students: 15,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    // No advance for Mumbai campus
    name: "Transstadia University (Mumbai)",
    oem: "IBM",
    invoices: [
      {
        category: "old", semester: "none", students: 54,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 25 },
          { year: "FY24-25", count: 14 },
          { year: "FY23-24", count: 15 },
        ],
      },
      {
        category: "new", semester: "none", students: 25,
        priceToUni: 29661, priceToDG: 22500,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Sri Sri University",
    oem: "IBM",
    invoices: [
      {
        // Two advance PIs: 1000000 (Apr-16) + 500000 (May-25) = 1500000
        category: "advance", semester: "none", students: 1,
        priceToUni: 1500000, priceToDG: 1500000,
        invoiceDate: "2026-04-16", status: "partially-paid",
        payments: [{ date: "2026-06-12", amount: 1157595 }],
      },
      {
        category: "old", semester: "none", students: 395,
        priceToUni: 22900, priceToDG: 17400,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 110 },
          { year: "FY24-25", count: 128 },
          { year: "FY23-24", count: 108 },
          { year: "FY22-23", count: 49 },
        ],
      },
      {
        category: "new", semester: "none", students: 120,
        priceToUni: 22900, priceToDG: 17400,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Auro University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "none", students: 222,
        priceToUni: 29661, priceToDG: 21500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 71 },
          { year: "FY24-25", count: 63 },
          { year: "FY23-24", count: 50 },
          { year: "FY22-23", count: 38 },
        ],
      },
      {
        category: "new", semester: "none", students: 50,
        priceToUni: 29661, priceToDG: 21500,
        invoiceDate: "2026-11-30", status: "raised",
      },
    ],
  },
  {
    name: "Kalinga University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "1", students: 264,
        priceToUni: 14830.5, priceToDG: 10500,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 132 },
          { year: "FY24-25", count: 82 },
          { year: "FY23-24", count: 50 },
        ],
      },
      {
        category: "old", semester: "2", students: 264,
        priceToUni: 14830.5, priceToDG: 10500,
        invoiceDate: "2027-01-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 132 },
          { year: "FY24-25", count: 82 },
          { year: "FY23-24", count: 50 },
        ],
      },
      {
        category: "new", semester: "1", students: 138,
        priceToUni: 14830.5, priceToDG: 10500,
        invoiceDate: "2026-11-01", status: "raised",
      },
      {
        category: "new", semester: "2", students: 138,
        priceToUni: 14830.5, priceToDG: 10500,
        invoiceDate: "2027-01-01", status: "raised",
      },
    ],
  },
  {
    name: "Medicaps University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "1", students: 269,
        priceToUni: 13500, priceToDG: 10000,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 269 }],
      },
      {
        category: "old", semester: "2", students: 269,
        priceToUni: 13500, priceToDG: 10000,
        invoiceDate: "2027-01-01", status: "raised",
        cohorts: [{ year: "FY25-26", count: 269 }],
      },
      {
        category: "new", semester: "1", students: 350,
        priceToUni: 13500, priceToDG: 10000,
        invoiceDate: "2026-11-01", status: "raised",
      },
      {
        category: "new", semester: "2", students: 350,
        priceToUni: 13500, priceToDG: 10000,
        invoiceDate: "2027-01-01", status: "raised",
      },
    ],
  },
  {
    name: "Sri Sai University",
    oem: "IBM",
    invoices: [
      {
        category: "advance", semester: "none", students: 1,
        priceToUni: 1000000, priceToDG: 1000000,
        invoiceDate: "2026-04-16", status: "raised",
      },
      {
        category: "old", semester: "1", students: 293,
        priceToUni: 14830.5, priceToDG: 10750,
        invoiceDate: "2026-07-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 97 },
          { year: "FY24-25", count: 87 },
          { year: "FY23-24", count: 76 },
          { year: "FY22-23", count: 33 },
        ],
      },
      {
        category: "old", semester: "2", students: 293,
        priceToUni: 14830.5, priceToDG: 10750,
        invoiceDate: "2027-01-01", status: "raised",
        cohorts: [
          { year: "FY25-26", count: 97 },
          { year: "FY24-25", count: 87 },
          { year: "FY23-24", count: 76 },
          { year: "FY22-23", count: 33 },
        ],
      },
      {
        category: "new", semester: "1", students: 120,
        priceToUni: 14830.5, priceToDG: 10750,
        invoiceDate: "2026-11-01", status: "raised",
      },
      {
        category: "new", semester: "2", students: 120,
        priceToUni: 14830.5, priceToDG: 10750,
        invoiceDate: "2027-01-01", status: "raised",
      },
    ],
  },
  {
    // AAFM product at Medicaps — OEM is AAFM (external), not IBM
    name: "Medicaps DG Programme",
    oem: "AAFM",
    invoices: [
      {
        category: "new", semester: "none", students: 60,
        priceToUni: 105000, priceToDG: 73500,
        invoiceDate: null, status: "raised",
      },
    ],
  },
];

// ---------------------------------------------------------------------------

async function main() {
  const { db } = await import("../lib/db/client");

  // 1. Wipe dependent data in FK order (invoices.accountId has no cascade)
  console.log("Wiping all account data…");
  // payments + cohorts cascade from invoices automatically
  await db.delete(t.invoices);
  await db.delete(t.accounts);
  console.log("  Done.\n");

  // 2. Ensure OEMs exist
  const oemIds: Record<string, number> = {};
  for (const oemName of ["IBM", "AAFM"]) {
    const [row] = await db.select().from(t.oems).where(eq(t.oems.name, oemName)).limit(1);
    if (row) {
      oemIds[oemName] = row.id;
    } else {
      const [ins] = await db.insert(t.oems).values({ name: oemName }).returning();
      oemIds[oemName] = ins.id;
      console.log(`  Created OEM ${oemName}`);
    }
  }

  // 3. Ensure academic year FY26–27 exists
  const yearLabel = "FY26–27"; // en-dash
  let yearId: number;
  const [yr] = await db.select().from(t.academicYears).where(eq(t.academicYears.label, yearLabel)).limit(1);
  if (yr) {
    yearId = yr.id;
  } else {
    const [ins] = await db.insert(t.academicYears).values({ label: yearLabel }).returning();
    yearId = ins.id;
    console.log(`  Created academic year ${yearLabel}`);
  }

  // 4. Create accounts + invoices + cohorts + payments
  for (const acc of ACCOUNTS) {
    const [account] = await db
      .insert(t.accounts)
      .values({ name: acc.name, oemId: oemIds[acc.oem] })
      .returning();

    let invoiceCount = 0;
    for (const inv of acc.invoices) {
      const [invoice] = await db
        .insert(t.invoices)
        .values({
          accountId: account.id,
          yearId,
          category: inv.category,
          semester: inv.semester,
          students: inv.students,
          priceToUni: String(inv.priceToUni),
          priceToDatagami: String(inv.priceToDG),
          gstRate: "0.18",
          tdsRate: "0.10",
          advanceAdj: "0",
          invoiceDate: inv.invoiceDate ?? null,
          status: inv.status,
        })
        .returning();

      if (inv.cohorts?.length) {
        await db.insert(t.cohorts).values(
          inv.cohorts.map((c) => ({
            invoiceId: invoice.id,
            enrollmentYear: c.year,
            count: c.count,
          })),
        );
      }

      if (inv.payments?.length) {
        await db.insert(t.payments).values(
          inv.payments.map((p) => ({
            invoiceId: invoice.id,
            direction: "receipt" as const,
            paidOn: p.date,
            amount: String(p.amount),
            mode: "NEFT" as const,
          })),
        );
      }

      invoiceCount++;
    }

    const totalStudents = acc.invoices
      .filter((i) => i.category !== "advance")
      .reduce((s, i) => s + i.students, 0);

    console.log(
      `  ✓  ${acc.name}  (${acc.oem}, ${totalStudents} students, ${invoiceCount} invoices)`,
    );
  }

  console.log(`\nDone: ${ACCOUNTS.length} accounts imported.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
