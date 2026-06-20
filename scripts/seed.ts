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
import { LEAD_FIXTURES } from "../lib/fixtures/leads";
import { seedWorkspaceUsersAndTasks } from "./seed-tasks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "16 Jun 2026" → Date (UTC noon, so it survives timezone rounding). */
function parseDateLabel(label: string): Date {
  const [d, mon, y] = label.split(/\s+/);
  const m = MONTHS.indexOf(mon);
  return new Date(Date.UTC(Number(y), m < 0 ? 0 : m, Number(d), 12));
}
/** "20 Jun" (or "20 Jun 2026") → "YYYY-MM-DD" (defaults the year to 2026). */
function labelToISO(label: string | null | undefined): string | null {
  if (!label) return null;
  const parts = label.trim().split(/\s+/);
  const [d, mon, y] = parts.length === 3 ? parts : [parts[0], parts[1], "2026"];
  const m = MONTHS.indexOf(mon);
  if (m < 0 || !d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m + 1)}-${p(Number(d))}`;
}

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
      `TRUNCATE TABLE lead_activities, leads, tasks, payments, cohorts, invoices, user_accounts, accounts, academic_years, oems, users RESTART IDENTITY CASCADE`,
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

  // Workspace — demo users, account assignments, and Team board tasks
  const ws = await seedWorkspaceUsersAndTasks(db, t);

  // Workspace — Leads CRM (lead + its discussion timeline)
  let activityCount = 0;
  for (const lead of LEAD_FIXTURES) {
    const priceToUni = lead.students > 0 ? Math.round(lead.value / lead.students) : 0;
    const priceToDatagami = Math.round(priceToUni * 0.85);
    const [row] = await db
      .insert(t.leads)
      .values({
        prospect: lead.prospect,
        city: lead.city,
        oem: lead.oem,
        owner: lead.owner,
        stage: lead.stage,
        value: String(lead.students * priceToUni),
        students: lead.students,
        priceToUni: String(priceToUni),
        priceToDatagami: String(priceToDatagami),
        nextAction: lead.nextAction,
        nextDate: labelToISO(lead.nextDate),
        source: lead.source,
        contactName: lead.contact.name,
        contactRole: lead.contact.role,
        contactEmail: lead.contact.email,
        contactPhone: lead.contact.phone,
        lostReason: lead.lostReason ?? null,
      })
      .returning();
    if (lead.activities.length) {
      await db.insert(t.leadActivities).values(
        lead.activities.map((a) => ({
          leadId: row.id,
          type: a.type,
          author: a.author,
          body: a.body,
          dateLabel: a.dateLabel,
          occurredAt: parseDateLabel(a.dateLabel),
        })),
      );
      activityCount += lead.activities.length;
    }
  }

  console.log(
    `Seeded: ${parsedAll.length} accounts, ${oemNames.length} OEMs (${oemNames.join(", ")}), ` +
      `year FY26–27, ${invoiceCount} invoices, ${cohortCount} cohort rows.\n` +
      `Workspace: ${ws.users} demo users, ${ws.tasks} tasks, ${LEAD_FIXTURES.length} leads, ${activityCount} discussions.\n` +
      `Super Admin: admin@datagami.local / changeme123`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
