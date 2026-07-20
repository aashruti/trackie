import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { programs, deliveryEvents, deliveryActivities } from "@/lib/db/schema";
import { scopeAccountIds, type SessionUser } from "@/lib/dal/authz";
import { assignedIds } from "@/lib/dal/accounts";
import { UserError } from "@/lib/dal/errors";

/**
 * Delivery write-side scoping. Reads are filtered in the queries themselves
 * (programs.ts / dashboard.ts / report.ts); writes take an id, so they must
 * resolve the target's owning account and confirm it is in the caller's scope
 * BEFORE mutating — otherwise a delivery user scoped to university A could edit
 * or delete university B's programs/events/activities by passing B's id (IDOR).
 *
 * super-admin (scope === null) always passes.
 */

/** The caller's account scope: null = unrestricted (super-admin), else the ids. */
async function callerScope(user: SessionUser): Promise<number[] | null> {
  if (user.roles.includes("super-admin")) return null;
  const assigned = await assignedIds(user.id);
  return scopeAccountIds(user, assigned);
}

const OUT_OF_SCOPE = "That delivery record isn't in your assigned universities.";

/** Throw unless `accountId` is in the caller's scope. */
export async function assertAccountInScope(user: SessionUser, accountId: number): Promise<void> {
  const scope = await callerScope(user);
  if (scope === null) return;
  if (!scope.includes(accountId)) throw new UserError(OUT_OF_SCOPE);
}

/** Throw unless the program's account is in the caller's scope. */
export async function assertProgramInScope(user: SessionUser, programId: number): Promise<void> {
  const scope = await callerScope(user);
  if (scope === null) return;
  const [row] = await db
    .select({ accountId: programs.accountId })
    .from(programs)
    .where(eq(programs.id, programId))
    .limit(1);
  // Missing → let the caller's own not-found handling report it, but never allow
  // a write to a program the caller can't see.
  if (!row || !scope.includes(row.accountId)) throw new UserError(OUT_OF_SCOPE);
}

/** Throw unless the event's program's account is in the caller's scope. */
export async function assertEventInScope(user: SessionUser, eventId: number): Promise<void> {
  const scope = await callerScope(user);
  if (scope === null) return;
  const [row] = await db
    .select({ accountId: programs.accountId })
    .from(deliveryEvents)
    .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
    .where(eq(deliveryEvents.id, eventId))
    .limit(1);
  if (!row || !scope.includes(row.accountId)) throw new UserError(OUT_OF_SCOPE);
}

/** Throw unless the activity's event's program's account is in the caller's scope. */
export async function assertActivityInScope(user: SessionUser, activityId: number): Promise<void> {
  const scope = await callerScope(user);
  if (scope === null) return;
  const [row] = await db
    .select({ accountId: programs.accountId })
    .from(deliveryActivities)
    .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
    .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
    .where(eq(deliveryActivities.id, activityId))
    .limit(1);
  if (!row || !scope.includes(row.accountId)) throw new UserError(OUT_OF_SCOPE);
}
