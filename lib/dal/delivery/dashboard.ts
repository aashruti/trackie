import "server-only";

import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, deliveryActivities, deliveryEvents, programs } from "@/lib/db/schema";
import { assertDeliveryAccess, type SessionUser } from "@/lib/dal/authz";
import type { DeliveryActivityType, DeliveryEventStatus } from "@/lib/db/enums";

/** The delivery-role dashboard: programs at a glance, what's coming, what's burning. */

export type DeliveryDashboard = {
  programs: { total: number; active: number };
  /** Planned events starting (or running) in the next 14 days. */
  upcoming: Array<{
    eventId: number;
    title: string;
    programId: number;
    programName: string;
    accountName: string;
    startDate: string;
    endDate: string | null;
    status: DeliveryEventStatus;
  }>;
  /** Events whose spend exceeds their allocation. */
  overBudget: Array<{
    eventId: number;
    title: string;
    programId: number;
    programName: string;
    budget: number;
    spent: number;
  }>;
  /** Latest logged activities across every program. */
  recent: Array<{
    id: number;
    type: DeliveryActivityType;
    title: string;
    activityDate: string;
    author: string;
    programId: number;
    programName: string;
  }>;
};

function isoPlusDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function getDeliveryDashboard(user: SessionUser): Promise<DeliveryDashboard> {
  assertDeliveryAccess(user);
  const today = isoPlusDays(0);
  const horizon = isoPlusDays(14);

  const [counts, upcoming, spendRows, recent] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${programs.status} = 'active')::int`,
      })
      .from(programs),
    db
      .select({
        eventId: deliveryEvents.id,
        title: deliveryEvents.title,
        programId: deliveryEvents.programId,
        programName: programs.name,
        accountName: accounts.name,
        startDate: deliveryEvents.startDate,
        endDate: deliveryEvents.endDate,
        status: deliveryEvents.status,
      })
      .from(deliveryEvents)
      .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
      .innerJoin(accounts, eq(programs.accountId, accounts.id))
      .where(
        and(
          eq(deliveryEvents.status, "planned"),
          lte(deliveryEvents.startDate, horizon),
          gte(sql`coalesce(${deliveryEvents.endDate}, ${deliveryEvents.startDate})`, today),
        ),
      )
      .orderBy(asc(deliveryEvents.startDate))
      .limit(8),
    // Per-event spend vs budget — grouped once, filtered in JS (small set).
    db
      .select({
        eventId: deliveryEvents.id,
        title: deliveryEvents.title,
        programId: deliveryEvents.programId,
        programName: programs.name,
        budget: deliveryEvents.budget,
        spent: sql<string>`coalesce(sum(${deliveryActivities.cost}), 0)::text`,
      })
      .from(deliveryEvents)
      .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
      .innerJoin(deliveryActivities, eq(deliveryActivities.eventId, deliveryEvents.id))
      .groupBy(deliveryEvents.id, deliveryEvents.title, deliveryEvents.programId, programs.name, deliveryEvents.budget)
      .having(sql`coalesce(sum(${deliveryActivities.cost}), 0) > ${deliveryEvents.budget}`),
    db
      .select({
        id: deliveryActivities.id,
        type: deliveryActivities.type,
        title: deliveryActivities.title,
        activityDate: deliveryActivities.activityDate,
        author: deliveryActivities.author,
        programId: deliveryEvents.programId,
        programName: programs.name,
      })
      .from(deliveryActivities)
      .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
      .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
      .orderBy(desc(deliveryActivities.createdAt), desc(deliveryActivities.id))
      .limit(10),
  ]);

  return {
    programs: counts[0] ?? { total: 0, active: 0 },
    upcoming,
    overBudget: spendRows
      .map((r) => ({ ...r, budget: Number(r.budget), spent: Number(r.spent) }))
      .sort((a, b) => b.spent - b.budget - (a.spent - a.budget))
      .slice(0, 5),
    recent,
  };
}
