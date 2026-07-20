import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, leadActivities, leadFollowups, userAccounts } from "@/lib/db/schema";
import type { LeadStage, ActivityType } from "@/lib/db/enums";
import type { LeadRow, LeadDetailRow, LeadActivityRow, LeadFollowupRow } from "@/lib/board/constants";
import { assertLeadsAccess, type SessionUser } from "./authz";
import { stampedDelete } from "./audit";
import { ensureOem, insertAccount, createInvoice } from "./account-admin";
import { todayISO } from "@/lib/dates";

export type LeadFollowup = {
  id: number;
  leadId: number;
  prospect: string;
  action: string;
  dueDate: string | null;
  oem: string | null;
  stage: LeadStage;
};

/**
 * Pending follow-ups due today or overdue, on active (open) leads. Super-admins
 * see everyone's; others see only follow-ups on leads they created.
 */
export async function myFollowupsToday(user: SessionUser): Promise<LeadFollowup[]> {
  const today = todayISO();
  return db
    .select({
      id: leadFollowups.id,
      leadId: leads.id,
      prospect: leads.prospect,
      action: leadFollowups.action,
      dueDate: leadFollowups.dueDate,
      oem: leads.oem,
      stage: leads.stage,
    })
    .from(leadFollowups)
    .innerJoin(leads, eq(leadFollowups.leadId, leads.id))
    .where(
      and(
        eq(leadFollowups.done, false),
        isNotNull(leadFollowups.dueDate),
        lte(leadFollowups.dueDate, today),
        ne(leads.stage, "won"),
        ne(leads.stage, "lost"),
        user.roles.includes("super-admin") ? undefined : eq(leads.createdByUserId, user.id),
      ),
    )
    .orderBy(asc(leadFollowups.dueDate));
}

/**
 * Leads CRM reads/writes. Every entry point asserts Admin/Finance access — the
 * sidebar locks the nav for viewers, and this is the server-side backstop
 * (Server Actions are reachable by direct POST, so the check lives here too).
 */

function toRow(r: typeof leads.$inferSelect, activityCount: number): LeadRow {
  const priceToUni = Number(r.priceToUni);
  const priceToDatagami = Number(r.priceToDatagami);
  return {
    id: r.id,
    prospect: r.prospect,
    city: r.city,
    oem: r.oem,
    owner: r.owner,
    stage: r.stage,
    value: Number(r.value),
    margin: r.students * (priceToUni - priceToDatagami),
    students: r.students,
    priceToUni,
    priceToDatagami,
    nextAction: r.nextAction,
    nextDate: r.nextDate,
    source: r.source,
    contact: {
      name: r.contactName,
      role: r.contactRole,
      email: r.contactEmail,
      phone: r.contactPhone,
    },
    lostReason: r.lostReason,
    convertedAccountId: r.convertedAccountId,
    createdById: r.createdByUserId,
    activityCount,
  };
}

function toActivityRow(a: typeof leadActivities.$inferSelect): LeadActivityRow {
  return { id: a.id, type: a.type, author: a.author, body: a.body, dateLabel: a.dateLabel };
}

/** "19 Jun 2026" — the display format the prototype's seed activities use. */
export function formatDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export async function listLeads(user: SessionUser): Promise<LeadRow[]> {
  assertLeadsAccess(user);
  const [rows, counts] = await Promise.all([
    db.select().from(leads).orderBy(desc(leads.value)),
    db.select({ leadId: leadActivities.leadId, n: sql<number>`count(*)::int` })
      .from(leadActivities)
      .groupBy(leadActivities.leadId),
  ]);
  const countBy = new Map(counts.map((c) => [c.leadId, c.n]));
  return rows.map((r) => toRow(r, countBy.get(r.id) ?? 0));
}

/** All leads with their full discussion timelines (small dataset; one extra query). */
export async function listLeadsWithActivities(user: SessionUser): Promise<LeadDetailRow[]> {
  assertLeadsAccess(user);
  const [rows, acts] = await Promise.all([
    db.select().from(leads).orderBy(desc(leads.value)),
    db.select().from(leadActivities).orderBy(desc(leadActivities.occurredAt), desc(leadActivities.id)),
  ]);
  const byLead = new Map<number, LeadActivityRow[]>();
  for (const a of acts) {
    const list = byLead.get(a.leadId) ?? [];
    list.push(toActivityRow(a));
    byLead.set(a.leadId, list);
  }
  const followups = await loadFollowupsByLead(rows.map((r) => r.id));
  return rows.map((r) => {
    const activities = byLead.get(r.id) ?? [];
    return { ...toRow(r, activities.length), activities, followups: followups.get(r.id) ?? [] };
  });
}

export async function getLead(user: SessionUser, id: number): Promise<LeadDetailRow | null> {
  assertLeadsAccess(user);
  const [row] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!row) return null;
  const [acts, followupsMap] = await Promise.all([
    loadActivities(id),
    loadFollowupsByLead([id]),
  ]);
  return { ...toRow(row, acts.length), activities: acts, followups: followupsMap.get(id) ?? [] };
}

/** Activities for a lead, reverse-chronological (newest first). */
export async function loadActivities(leadId: number): Promise<LeadActivityRow[]> {
  const rows = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.occurredAt), desc(leadActivities.id));
  return rows.map(toActivityRow);
}

export async function setLeadStage(
  user: SessionUser,
  id: number,
  stage: LeadStage,
  lostReason?: string | null,
): Promise<void> {
  assertLeadsAccess(user);
  // Store the reason when moving to lost; clear it when moving back out of lost.
  const reason = stage === "lost" ? (lostReason?.trim() || null) : null;
  await db.update(leads).set({ stage, lostReason: reason, updatedBy: user.id }).where(eq(leads.id, id));
}

// ---- Follow-ups (a lead can have several) ----------------------------------
function toFollowupRow(f: typeof leadFollowups.$inferSelect): LeadFollowupRow {
  return { id: f.id, action: f.action, dueDate: f.dueDate, done: f.done };
}

/** Follow-ups grouped by lead — pending first (by date), done last. */
async function loadFollowupsByLead(leadIds: number[]): Promise<Map<number, LeadFollowupRow[]>> {
  const m = new Map<number, LeadFollowupRow[]>();
  if (!leadIds.length) return m;
  const rows = await db
    .select()
    .from(leadFollowups)
    .where(inArray(leadFollowups.leadId, leadIds))
    .orderBy(asc(leadFollowups.done), asc(leadFollowups.dueDate), asc(leadFollowups.id));
  for (const f of rows) {
    const list = m.get(f.leadId) ?? [];
    list.push(toFollowupRow(f));
    m.set(f.leadId, list);
  }
  return m;
}

/** Cache the soonest pending dated follow-up into leads.next_action/next_date. */
async function recomputeNextFollowup(leadId: number, actorId: number): Promise<void> {
  const [next] = await db
    .select({ action: leadFollowups.action, dueDate: leadFollowups.dueDate })
    .from(leadFollowups)
    .where(and(eq(leadFollowups.leadId, leadId), eq(leadFollowups.done, false), isNotNull(leadFollowups.dueDate)))
    .orderBy(asc(leadFollowups.dueDate))
    .limit(1);
  await db
    .update(leads)
    .set({ nextAction: next?.action ?? null, nextDate: next?.dueDate ?? null, updatedBy: actorId })
    .where(eq(leads.id, leadId));
}

export async function addLeadFollowup(
  user: SessionUser,
  leadId: number,
  input: { action: string; dueDate: string | null },
): Promise<LeadFollowupRow> {
  assertLeadsAccess(user);
  const action = input.action.trim();
  if (!action) throw new Error("A follow-up needs an action");
  const [row] = await db
    .insert(leadFollowups)
    .values({ leadId, action, dueDate: input.dueDate || null, done: false, createdBy: user.id, updatedBy: user.id })
    .returning();
  await recomputeNextFollowup(leadId, user.id);
  return toFollowupRow(row);
}

export async function setLeadFollowupDone(user: SessionUser, followupId: number, done: boolean): Promise<void> {
  assertLeadsAccess(user);
  const [f] = await db.select({ leadId: leadFollowups.leadId }).from(leadFollowups).where(eq(leadFollowups.id, followupId)).limit(1);
  if (!f) return;
  await db.update(leadFollowups).set({ done, updatedBy: user.id }).where(eq(leadFollowups.id, followupId));
  await recomputeNextFollowup(f.leadId, user.id);
}

export async function deleteLeadFollowup(user: SessionUser, followupId: number): Promise<void> {
  assertLeadsAccess(user);
  const [f] = await db.select({ leadId: leadFollowups.leadId }).from(leadFollowups).where(eq(leadFollowups.id, followupId)).limit(1);
  if (!f) return;
  await stampedDelete(leadFollowups, followupId, user.id);
  await recomputeNextFollowup(f.leadId, user.id);
}

export async function addActivity(
  user: SessionUser,
  leadId: number,
  input: { type: ActivityType; body: string; author: string; occurredAt?: Date },
): Promise<LeadActivityRow> {
  assertLeadsAccess(user);
  const body = input.body.trim();
  if (!body) throw new Error("Discussion note cannot be empty");
  const when = input.occurredAt ?? new Date();
  const [row] = await db
    .insert(leadActivities)
    .values({
      leadId,
      type: input.type,
      author: input.author,
      body,
      dateLabel: formatDateLabel(when),
      occurredAt: when,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  return toActivityRow(row);
}

export type NewLeadInput = {
  prospect: string;
  city?: string | null;
  oem?: string | null;
  owner: string;
  stage?: LeadStage;
  students?: number;
  priceToUni?: number;
  priceToDatagami?: number;
  source?: string | null;
  nextAction?: string | null;
  nextDate?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

/** Who may convert a lead: a Super Admin, or the creator of a won lead. */
export function canConvertLead(
  user: SessionUser,
  lead: { stage: LeadStage; createdByUserId: number | null },
): boolean {
  if (user.roles.includes("super-admin")) return true;
  return lead.stage === "won" && lead.createdByUserId === user.id;
}

/**
 * Convert a lead into a real account, carrying its pricing into a draft invoice.
 * Allowed for a Super Admin, or the creator of a *won* lead (without the
 * super-admin account-creation gate). A non-super-admin converter is assigned to
 * the new account so they can manage it. Idempotent: an already-converted lead
 * just returns its account.
 */
export async function convertLeadToAccount(
  user: SessionUser,
  leadId: number,
  yearLabel: string,
): Promise<{ accountId: number }> {
  assertLeadsAccess(user);
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");
  if (lead.convertedAccountId) return { accountId: lead.convertedAccountId };

  if (!canConvertLead(user, lead)) {
    throw new Error("Only a Super Admin, or the owner of a won lead they created, can convert it.");
  }

  const oemName = (lead.oem ?? "").trim();
  if (!oemName) throw new Error("Set the lead's OEM before converting.");
  const oem = await ensureOem(user.id, oemName); // match by name or create — convert is already authorized

  const { id: accountId } = await insertAccount(user.id, {
    name: lead.prospect,
    type: "university",
    city: lead.city,
    oemId: oem.id,
  });

  // Assign a non-super-admin converter to the new account so they can manage it
  // (and so createInvoice's canEdit check passes for them).
  if (!user.roles.includes("super-admin")) {
    await db
      .insert(userAccounts)
      .values({ userId: user.id, accountId, createdBy: user.id, updatedBy: user.id })
      .onConflictDoNothing();
  }

  // Carry the lead's per-seat pricing into a first draft invoice for the year.
  const priceToUni = Number(lead.priceToUni);
  if (lead.students > 0 && priceToUni > 0) {
    await createInvoice(user, accountId, yearLabel, {
      category: "new",
      semester: "none",
      students: lead.students,
      priceToUni,
      priceToDatagami: Number(lead.priceToDatagami),
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "draft",
    });
  }

  await db
    .update(leads)
    .set({ stage: "won", convertedAccountId: accountId, updatedBy: user.id })
    .where(eq(leads.id, leadId));
  return { accountId };
}

export async function createLead(user: SessionUser, input: NewLeadInput): Promise<LeadRow> {
  assertLeadsAccess(user);
  const prospect = input.prospect.trim();
  if (!prospect) throw new Error("Prospect name is required");
  const students = input.students ?? 0;
  const priceToUni = input.priceToUni ?? 0;
  const priceToDatagami = input.priceToDatagami ?? 0;
  const [row] = await db
    .insert(leads)
    .values({
      prospect,
      city: input.city ?? null,
      oem: input.oem ?? null,
      owner: input.owner,
      stage: input.stage ?? "new",
      // Estimated value is derived from the per-seat price.
      value: String(students * priceToUni),
      students,
      priceToUni: String(priceToUni),
      priceToDatagami: String(priceToDatagami),
      createdByUserId: user.id,
      source: input.source ?? null,
      nextAction: input.nextAction ?? "Qualify budget & timeline",
      nextDate: input.nextDate ?? null,
      contactName: input.contactName ?? null,
      contactRole: input.contactRole ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  // Seed the first follow-up so it shows in the lead's follow-up list.
  const firstAction = (input.nextAction ?? "Qualify budget & timeline").trim();
  if (firstAction) {
    await db.insert(leadFollowups).values({
      leadId: row.id,
      action: firstAction,
      dueDate: input.nextDate || null,
      done: false,
      createdBy: user.id,
      updatedBy: user.id,
    });
  }
  return toRow(row, 0);
}
