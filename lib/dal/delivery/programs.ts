import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accounts,
  deliveryActivities,
  deliveryEvents,
  deliveryMethods,
  oems,
  programs,
  users,
} from "@/lib/db/schema";
import {
  assertDeliveryAccess,
  assertDeliveryManage,
  type SessionUser,
} from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import { PROGRAM_STATUSES, type DeliveryActivityType, type DeliveryEventStatus, type ProgramStatus } from "@/lib/db/enums";
import { assertDateOrder, assertIsoDate, buildCalendarCells, monthDays, toMoney, type CalendarCell } from "./util";

/**
 * Programs are the delivery-side view of what sales sold: one account can run
 * several at once, each with its OWN provider (IBM vs Datagami) and teaching
 * style. Money semantics: an event's `budget` is the allocation; spend is NEVER
 * stored — it is Σ activity costs at read time. Program `allocated` counts only
 * non-cancelled events (a cancelled event frees its allocation), while `spent`
 * counts every activity cost — money burned on a cancelled event is still real.
 */

export type ProgramListRow = {
  id: number;
  name: string;
  status: ProgramStatus;
  accountId: number;
  accountName: string;
  oemName: string;
  selfSupplied: boolean;
  methodName: string;
  methodCode: string;
  startDate: string | null;
  endDate: string | null;
  totalBudget: number | null;
  eventCount: number;
  allocated: number;
  spent: number;
};

export type ProgramActivity = {
  id: number;
  eventId: number;
  type: DeliveryActivityType;
  title: string;
  body: string | null;
  activityDate: string;
  cost: number;
  author: string;
};

export type ProgramEvent = {
  id: number;
  title: string;
  description: string | null;
  venue: string | null;
  startDate: string;
  endDate: string | null;
  budget: number;
  spent: number;
  status: DeliveryEventStatus;
  ownerUserId: number | null;
  ownerName: string | null;
  activities: ProgramActivity[];
};

export type ProgramDetail = Omit<ProgramListRow, "eventCount"> & {
  description: string | null;
  events: ProgramEvent[];
};

export type NewProgram = {
  accountId: number;
  oemId: number;
  deliveryMethodId: number;
  name: string;
  description?: string;
  status?: ProgramStatus;
  startDate?: string;
  endDate?: string;
  totalBudget?: number | null;
};

const PROGRAM_SELECT = {
  id: programs.id,
  name: programs.name,
  status: programs.status,
  accountId: programs.accountId,
  accountName: accounts.name,
  oemName: oems.name,
  selfSupplied: oems.isSelf,
  methodName: deliveryMethods.name,
  methodCode: deliveryMethods.code,
  startDate: programs.startDate,
  endDate: programs.endDate,
  totalBudget: programs.totalBudget,
};

/** Batched money/count rollups for a set of program ids — 2 grouped queries, no N+1. */
async function loadRollups(programIds: number[]): Promise<Map<number, { eventCount: number; allocated: number; spent: number }>> {
  const rollups = new Map<number, { eventCount: number; allocated: number; spent: number }>();
  if (!programIds.length) return rollups;
  const [events, costs] = await Promise.all([
    db
      .select({
        programId: deliveryEvents.programId,
        n: sql<number>`count(*)::int`,
        allocated: sql<string>`coalesce(sum(${deliveryEvents.budget}) filter (where ${deliveryEvents.status} <> 'cancelled'), 0)::text`,
      })
      .from(deliveryEvents)
      .where(inArray(deliveryEvents.programId, programIds))
      .groupBy(deliveryEvents.programId),
    db
      .select({
        programId: deliveryEvents.programId,
        spent: sql<string>`coalesce(sum(${deliveryActivities.cost}), 0)::text`,
      })
      .from(deliveryActivities)
      .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
      .where(inArray(deliveryEvents.programId, programIds))
      .groupBy(deliveryEvents.programId),
  ]);
  for (const id of programIds) rollups.set(id, { eventCount: 0, allocated: 0, spent: 0 });
  for (const e of events) {
    const r = rollups.get(e.programId)!;
    r.eventCount = e.n;
    r.allocated = Number(e.allocated);
  }
  for (const c of costs) rollups.get(c.programId)!.spent = Number(c.spent);
  return rollups;
}

/** All programs (optionally filtered), with account/provider/method context + rollups. */
export async function listPrograms(
  user: SessionUser,
  filters: { accountId?: number; status?: ProgramStatus } = {},
): Promise<ProgramListRow[]> {
  assertDeliveryAccess(user);
  const conds = [
    filters.accountId ? eq(programs.accountId, filters.accountId) : undefined,
    filters.status ? eq(programs.status, filters.status) : undefined,
  ].filter((c): c is NonNullable<typeof c> => !!c);

  const rows = await db
    .select(PROGRAM_SELECT)
    .from(programs)
    .innerJoin(accounts, eq(programs.accountId, accounts.id))
    .innerJoin(oems, eq(programs.oemId, oems.id))
    .innerJoin(deliveryMethods, eq(programs.deliveryMethodId, deliveryMethods.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(accounts.name), asc(programs.name));

  const rollups = await loadRollups(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    totalBudget: r.totalBudget === null ? null : Number(r.totalBudget),
    ...rollups.get(r.id)!,
  }));
}

/** One program with its events and per-event activity logs (newest activity first). */
export async function getProgramDetail(user: SessionUser, id: number): Promise<ProgramDetail | null> {
  assertDeliveryAccess(user);
  const [row] = await db
    .select({ ...PROGRAM_SELECT, description: programs.description })
    .from(programs)
    .innerJoin(accounts, eq(programs.accountId, accounts.id))
    .innerJoin(oems, eq(programs.oemId, oems.id))
    .innerJoin(deliveryMethods, eq(programs.deliveryMethodId, deliveryMethods.id))
    .where(eq(programs.id, id))
    .limit(1);
  if (!row) return null;

  const eventRows = await db
    .select({
      id: deliveryEvents.id,
      title: deliveryEvents.title,
      description: deliveryEvents.description,
      venue: deliveryEvents.venue,
      startDate: deliveryEvents.startDate,
      endDate: deliveryEvents.endDate,
      budget: deliveryEvents.budget,
      status: deliveryEvents.status,
      ownerUserId: deliveryEvents.ownerUserId,
      ownerName: users.name,
    })
    .from(deliveryEvents)
    .leftJoin(users, eq(deliveryEvents.ownerUserId, users.id))
    .where(eq(deliveryEvents.programId, id))
    .orderBy(asc(deliveryEvents.startDate), asc(deliveryEvents.id));

  const eventIds = eventRows.map((e) => e.id);
  const activityRows = eventIds.length
    ? await db
        .select({
          id: deliveryActivities.id,
          eventId: deliveryActivities.eventId,
          type: deliveryActivities.type,
          title: deliveryActivities.title,
          body: deliveryActivities.body,
          activityDate: deliveryActivities.activityDate,
          cost: deliveryActivities.cost,
          author: deliveryActivities.author,
        })
        .from(deliveryActivities)
        .where(inArray(deliveryActivities.eventId, eventIds))
        .orderBy(desc(deliveryActivities.activityDate), desc(deliveryActivities.id))
    : [];

  const byEvent = new Map<number, ProgramActivity[]>();
  for (const a of activityRows) {
    const list = byEvent.get(a.eventId) ?? [];
    list.push({ ...a, cost: Number(a.cost) });
    byEvent.set(a.eventId, list);
  }

  const events: ProgramEvent[] = eventRows.map((e) => {
    const activities = byEvent.get(e.id) ?? [];
    return {
      ...e,
      budget: Number(e.budget),
      spent: activities.reduce((s, a) => s + a.cost, 0),
      activities,
    };
  });

  return {
    ...row,
    totalBudget: row.totalBudget === null ? null : Number(row.totalBudget),
    allocated: events.filter((e) => e.status !== "cancelled").reduce((s, e) => s + e.budget, 0),
    spent: events.reduce((s, e) => s + e.spent, 0),
    events,
  };
}

function cleanProgramInput(input: NewProgram) {
  const name = input.name?.trim();
  if (!name) throw new UserError("Give the program a name.");
  if (name.length > 160) throw new UserError("Program name is too long.");
  if (input.status && !PROGRAM_STATUSES.includes(input.status)) throw new UserError("Unknown program status.");
  if (input.startDate) assertIsoDate(input.startDate, "start date");
  if (input.endDate) assertIsoDate(input.endDate, "end date");
  assertDateOrder(input.startDate, input.endDate, "The program's");
  return {
    accountId: input.accountId,
    oemId: input.oemId,
    deliveryMethodId: input.deliveryMethodId,
    name,
    description: input.description?.trim() || null,
    status: input.status ?? ("active" as const),
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    totalBudget: input.totalBudget === null || input.totalBudget === undefined ? null : toMoney(input.totalBudget, "Program budget"),
  };
}

/** Friendly existence checks so FK failures never leak raw driver errors. */
async function assertRefsExist(accountId: number, oemId: number, methodId: number): Promise<void> {
  const [acc, oem, method] = await Promise.all([
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1),
    db.select({ id: oems.id }).from(oems).where(eq(oems.id, oemId)).limit(1),
    db.select({ id: deliveryMethods.id, active: deliveryMethods.active }).from(deliveryMethods).where(eq(deliveryMethods.id, methodId)).limit(1),
  ]);
  if (!acc.length) throw new UserError("Pick a valid account.");
  if (!oem.length) throw new UserError("Pick a valid provider.");
  if (!method.length) throw new UserError("Pick a valid teaching style.");
}

export async function createProgram(user: SessionUser, input: NewProgram): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const values = cleanProgramInput(input);
  await assertRefsExist(values.accountId, values.oemId, values.deliveryMethodId);
  const [row] = await db.insert(programs).values(values).returning({ id: programs.id });
  return { id: row.id };
}

export async function updateProgram(user: SessionUser, id: number, input: NewProgram): Promise<void> {
  assertDeliveryManage(user);
  const values = cleanProgramInput(input);
  await assertRefsExist(values.accountId, values.oemId, values.deliveryMethodId);
  const updated = await db.update(programs).set(values).where(eq(programs.id, id)).returning({ id: programs.id });
  if (!updated.length) throw new UserError("Program not found.");
}

/** Hard delete — events/activities cascade; board tasks keep the account but lose the program link. */
export async function deleteProgram(user: SessionUser, id: number): Promise<void> {
  assertDeliveryManage(user);
  const deleted = await db.delete(programs).where(eq(programs.id, id)).returning({ id: programs.id });
  if (!deleted.length) throw new UserError("Program not found.");
}

/** Account picker options — module-gated (delivery has no user_accounts scoping). */
export async function listAccountOptions(user: SessionUser): Promise<{ id: number; name: string }[]> {
  assertDeliveryAccess(user);
  return db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(asc(accounts.name));
}

/** Provider picker options (IBM, Datagami, …). */
export async function listOemOptions(user: SessionUser): Promise<{ id: number; name: string; isSelf: boolean }[]> {
  assertDeliveryAccess(user);
  return db.select({ id: oems.id, name: oems.name, isSelf: oems.isSelf }).from(oems).orderBy(asc(oems.name));
}

export type ProgramCalendar = {
  program: { id: number; name: string; accountName: string };
  days: string[];
  cells: Record<string, CalendarCell>;
  /** Month totals for the header strip. */
  summary: { events: number; activities: number; cost: number };
};

/** Month calendar for one program: event spans + dated activities. */
export async function getProgramCalendar(
  user: SessionUser,
  programId: number,
  year: number,
  month: number,
): Promise<ProgramCalendar | null> {
  assertDeliveryAccess(user);
  const [row] = await db
    .select({ id: programs.id, name: programs.name, accountName: accounts.name })
    .from(programs)
    .innerJoin(accounts, eq(programs.accountId, accounts.id))
    .where(eq(programs.id, programId))
    .limit(1);
  if (!row) return null;

  const days = monthDays(year, month);
  const first = days[0];
  const last = days[days.length - 1];

  const [eventRows, activityRows] = await Promise.all([
    // Events overlapping the month (may bleed in from either side).
    db
      .select({
        id: deliveryEvents.id,
        title: deliveryEvents.title,
        status: deliveryEvents.status,
        startDate: deliveryEvents.startDate,
        endDate: deliveryEvents.endDate,
      })
      .from(deliveryEvents)
      .where(
        and(
          eq(deliveryEvents.programId, programId),
          lte(deliveryEvents.startDate, last),
          gte(sql`coalesce(${deliveryEvents.endDate}, ${deliveryEvents.startDate})`, first),
        ),
      ),
    db
      .select({
        id: deliveryActivities.id,
        type: deliveryActivities.type,
        title: deliveryActivities.title,
        activityDate: deliveryActivities.activityDate,
        cost: deliveryActivities.cost,
      })
      .from(deliveryActivities)
      .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
      .where(
        and(
          eq(deliveryEvents.programId, programId),
          gte(deliveryActivities.activityDate, first),
          lte(deliveryActivities.activityDate, last),
        ),
      ),
  ]);

  const activities = activityRows.map((a) => ({ ...a, cost: Number(a.cost) }));
  return {
    program: row,
    days,
    cells: buildCalendarCells(days, eventRows, activities),
    summary: {
      events: eventRows.length,
      activities: activities.length,
      cost: activities.reduce((s, a) => s + a.cost, 0),
    },
  };
}
