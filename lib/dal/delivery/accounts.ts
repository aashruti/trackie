import "server-only";

import { asc, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, accountStayOptions, programs } from "@/lib/db/schema";
import { assignedIds } from "@/lib/dal/accounts";
import { assertDeliveryAccess, scopeAccountIds, type SessionUser } from "@/lib/dal/authz";

export type DeliveryAccountListRow = {
  id: number;
  name: string;
  city: string | null;
  hasCampusLocation: boolean;
  guestHouseAvailable: boolean | null;
  guestHouseCostPerNight: number | null;
  preferredStayCount: number;
  programCount: number;
  activeProgramCount: number;
};

/**
 * Finance-free account directory for Delivery. Non-super users only receive
 * universities assigned through user_accounts, including accounts that do not
 * have a delivery program yet.
 */
export async function listDeliveryAccounts(user: SessionUser): Promise<DeliveryAccountListRow[]> {
  assertDeliveryAccess(user);
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  const scope = scopeAccountIds(user, assigned);

  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      city: accounts.city,
      latitude: accounts.latitude,
      longitude: accounts.longitude,
      guestHouseAvailable: accounts.guestHouseAvailable,
      guestHouseCostPerNight: accounts.guestHouseCostPerNight,
    })
    .from(accounts)
    .where(scope ? inArray(accounts.id, scope.length ? scope : [-1]) : undefined)
    .orderBy(asc(accounts.name));

  const accountIds = rows.map((row) => row.id);
  if (!accountIds.length) return [];

  const [stayCounts, programCounts] = await Promise.all([
    db
      .select({
        accountId: accountStayOptions.accountId,
        count: sql<number>`count(*)::int`,
      })
      .from(accountStayOptions)
      .where(inArray(accountStayOptions.accountId, accountIds))
      .groupBy(accountStayOptions.accountId),
    db
      .select({
        accountId: programs.accountId,
        count: sql<number>`count(*)::int`,
        activeCount: sql<number>`count(*) filter (where ${programs.status} = 'active')::int`,
      })
      .from(programs)
      .where(inArray(programs.accountId, accountIds))
      .groupBy(programs.accountId),
  ]);

  const staysByAccount = new Map(stayCounts.map((row) => [row.accountId, row.count]));
  const programsByAccount = new Map(
    programCounts.map((row) => [row.accountId, { count: row.count, activeCount: row.activeCount }]),
  );

  return rows.map((row) => {
    const programRollup = programsByAccount.get(row.id);
    return {
      id: row.id,
      name: row.name,
      city: row.city,
      hasCampusLocation: row.latitude != null && row.longitude != null,
      guestHouseAvailable: row.guestHouseAvailable,
      guestHouseCostPerNight:
        row.guestHouseCostPerNight == null ? null : Number(row.guestHouseCostPerNight),
      preferredStayCount: staysByAccount.get(row.id) ?? 0,
      programCount: programRollup?.count ?? 0,
      activeProgramCount: programRollup?.activeCount ?? 0,
    };
  });
}
