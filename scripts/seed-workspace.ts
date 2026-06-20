/**
 * Seed ONLY the workspace feature data (Team board + Leads CRM). Non-destructive
 * to finance data: it upserts demo users, resets just their account assignments,
 * and reseeds `tasks`, `leads`, `lead_activities`. Accounts/invoices/payments and
 * any non-demo users are left untouched.
 *
 * Run: npm run db:seed-workspace
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { inArray, sql } from "drizzle-orm";
import * as t from "../lib/db/schema";
import { LEAD_FIXTURES } from "../lib/fixtures/leads";
import { seedWorkspaceUsersAndTasks } from "./seed-tasks";

// Lead owner roster codes → the demo user that "created" them.
const OWNER_EMAIL: Record<string, string> = {
  RK: "ramesh@datagami.local",
  AR: "arjun@datagami.local",
  PN: "priya@datagami.local",
  NS: "neha@datagami.local",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

async function main() {
  const { db } = await import("../lib/db/client");

  // Demo users + assignments + tasks (also truncates `tasks`).
  const summary = await seedWorkspaceUsersAndTasks(db, t);

  // Map owner code → demo user id so seeded leads have a real creator.
  const demoUsers = await db
    .select({ id: t.users.id, email: t.users.email })
    .from(t.users)
    .where(inArray(t.users.email, Object.values(OWNER_EMAIL)));
  const idByEmail = new Map(demoUsers.map((u) => [u.email, u.id]));
  const creatorId = (ownerCode: string) => idByEmail.get(OWNER_EMAIL[ownerCode] ?? "") ?? null;

  // Extra follow-ups so some leads have multiple — incl. an overdue one (today ≈ 2026-06-20).
  const EXTRA_FOLLOWUPS: Record<string, { action: string; dueISO: string | null }[]> = {
    "Bennett University": [{ action: "Chase signed MOU", dueISO: "2026-06-17" }],
    "Shoolini University": [{ action: "Schedule demo for finance team", dueISO: "2026-07-02" }],
  };

  // Leads + discussion timelines + follow-ups.
  await db.execute(sql.raw(`TRUNCATE TABLE lead_followups, lead_activities, leads RESTART IDENTITY CASCADE`));
  let activityCount = 0;
  let followupCount = 0;
  for (const lead of LEAD_FIXTURES) {
    // Build this lead's follow-ups (closed leads carry none); cache the soonest dated.
    const isClosed = lead.stage === "won" || lead.stage === "lost";
    const fus = isClosed
      ? []
      : [{ action: lead.nextAction, dueISO: labelToISO(lead.nextDate) }, ...(EXTRA_FOLLOWUPS[lead.prospect] ?? [])];
    const dated = fus.filter((f) => f.dueISO).sort((a, b) => (a.dueISO! < b.dueISO! ? -1 : 1));
    const cacheAction = dated[0]?.action ?? null;
    const cacheDate = dated[0]?.dueISO ?? null;
    // Back-derive per-seat prices from the fixture value (≈15% margin) so seeded
    // leads carry the same price-driven shape new ones do.
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
        createdByUserId: creatorId(lead.owner),
        nextAction: cacheAction,
        nextDate: cacheDate,
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
    // Insert follow-up rows for open leads.
    if (fus.length) {
      await db.insert(t.leadFollowups).values(
        fus.map((f) => ({ leadId: row.id, action: f.action ?? "Follow up", dueDate: f.dueISO || null, done: false })),
      );
      followupCount += fus.length;
    }
  }

  console.log(
    `Workspace seeded: ${summary.users} demo users, ${summary.assignments} account assignments, ` +
      `${summary.tasks} tasks, ${LEAD_FIXTURES.length} leads, ${activityCount} discussions, ${followupCount} follow-ups.\n` +
      `Demo logins (password "changeme123"): ramesh@ / arjun@ (admin), priya@ / neha@ (viewer) @datagami.local`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
