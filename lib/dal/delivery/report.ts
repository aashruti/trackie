import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
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
import { assertDeliveryAccess, scopeAccountIds, type SessionUser } from "@/lib/dal/authz";
import { assignedIds } from "@/lib/dal/accounts";
import type { ProgramStatus } from "@/lib/db/enums";
import type { ProgramActivity, ProgramEvent } from "./programs";

/**
 * The renewal/annual report: everything delivery did for an account, program by
 * program, event by event, activity by activity — chronological, printable.
 * Sales (admin role) takes this to renewals, so it is READ-gated only.
 */

export type ReportProgram = {
  id: number;
  name: string;
  description: string | null;
  methodName: string;
  methodCode: string;
  oemName: string;
  status: ProgramStatus;
  startDate: string | null;
  endDate: string | null;
  allocated: number;
  spent: number;
  events: ProgramEvent[];
};

export type AccountDeliveryReport = {
  account: { id: number; name: string; city: string | null; oemName: string };
  totals: { programs: number; events: number; activities: number; allocated: number; spent: number };
  programs: ReportProgram[];
};

export async function getAccountDeliveryReport(
  user: SessionUser,
  accountId: number,
): Promise<AccountDeliveryReport | null> {
  assertDeliveryAccess(user);
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned); // null → unrestricted (super-admin)
  // An account outside the caller's scope reads as "not found" — same
  // not-found contract the function already uses when the account itself
  // doesn't exist, so this never distinguishes "scoped out" from "no such account".
  if (scope && !scope.includes(accountId)) return null;

  const [[account], programRows] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name, city: accounts.city, oemName: oems.name })
      .from(accounts)
      .innerJoin(oems, eq(accounts.oemId, oems.id))
      .where(eq(accounts.id, accountId))
      .limit(1),
    db
      .select({
        id: programs.id,
        name: programs.name,
        description: programs.description,
        methodName: deliveryMethods.name,
        methodCode: deliveryMethods.code,
        oemName: oems.name,
        status: programs.status,
        startDate: programs.startDate,
        endDate: programs.endDate,
      })
      .from(programs)
      .innerJoin(deliveryMethods, eq(programs.deliveryMethodId, deliveryMethods.id))
      .innerJoin(oems, eq(programs.oemId, oems.id))
      .where(eq(programs.accountId, accountId))
      .orderBy(asc(programs.name)),
  ]);
  if (!account) return null;

  const programIds = programRows.map((p) => p.id);
  const eventRows = programIds.length
    ? await db
        .select({
          id: deliveryEvents.id,
          programId: deliveryEvents.programId,
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
        .where(inArray(deliveryEvents.programId, programIds))
        .orderBy(asc(deliveryEvents.startDate), asc(deliveryEvents.id))
    : [];

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
        // Chronological — the report reads as a narrative of the year.
        .orderBy(asc(deliveryActivities.activityDate), asc(deliveryActivities.id))
    : [];

  const activitiesByEvent = new Map<number, ProgramActivity[]>();
  for (const a of activityRows) {
    const list = activitiesByEvent.get(a.eventId) ?? [];
    list.push({ ...a, cost: Number(a.cost) });
    activitiesByEvent.set(a.eventId, list);
  }

  const eventsByProgram = new Map<number, ProgramEvent[]>();
  for (const e of eventRows) {
    const activities = activitiesByEvent.get(e.id) ?? [];
    const list = eventsByProgram.get(e.programId) ?? [];
    list.push({
      id: e.id,
      title: e.title,
      description: e.description,
      venue: e.venue,
      startDate: e.startDate,
      endDate: e.endDate,
      budget: Number(e.budget),
      spent: activities.reduce((s, a) => s + a.cost, 0),
      status: e.status,
      ownerUserId: e.ownerUserId,
      ownerName: e.ownerName,
      activities,
    });
    eventsByProgram.set(e.programId, list);
  }

  const reportPrograms: ReportProgram[] = programRows.map((p) => {
    const events = eventsByProgram.get(p.id) ?? [];
    return {
      ...p,
      allocated: events.filter((e) => e.status !== "cancelled").reduce((s, e) => s + e.budget, 0),
      spent: events.reduce((s, e) => s + e.spent, 0),
      events,
    };
  });

  return {
    account,
    totals: {
      programs: reportPrograms.length,
      events: eventRows.length,
      activities: activityRows.length,
      allocated: reportPrograms.reduce((s, p) => s + p.allocated, 0),
      spent: reportPrograms.reduce((s, p) => s + p.spent, 0),
    },
    programs: reportPrograms,
  };
}
