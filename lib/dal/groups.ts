import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  accountGroups,
  accounts,
  deliveryActivities,
  deliveryEvents,
  programs,
} from "@/lib/db/schema";
import { assertGroupsManage, scopeAccountIds, type SessionUser } from "./authz";
import { assignedIds, listAccountsForUser } from "./accounts";
import { UserError } from "./errors";

/**
 * Account groups — the grouped profitability view. One real-world university
 * often exists as several account rows; a group sums their numbers so
 * management can judge the institution as a whole. Nothing is persisted beyond
 * the grouping itself: sales rollups reuse the money engine per account and
 * are summed in JS; delivery rollups are two grouped queries. Group net =
 * sales net margin + (delivery allocated − spent) — the "delivery result" —
 * per the user's definition; the UI always shows the formula.
 *
 * Visibility: Finance-only (super-admin + admin), and every rollup counts ONLY
 * accounts in the caller's RBAC scope. A group with zero visible members is
 * hidden from that caller.
 */

export type GroupSales = {
  billing: number;
  received: number;
  outstanding: number;
  payable: number;
  netMargin: number;
};

export type GroupDelivery = {
  programs: number;
  allocated: number;
  spent: number;
  /** allocated − spent ("delivery profit"; negative = overran budgets). */
  result: number;
};

export type GroupRow = {
  id: number;
  name: string;
  /** Members visible to the caller (scope-filtered). */
  memberCount: number;
  sales: GroupSales;
  delivery: GroupDelivery;
  /** sales.netMargin + delivery.result — the headline profitable-or-not figure. */
  groupNet: number;
};

export type GroupMember = {
  id: number;
  name: string;
  type: string;
  oem: string;
  billing: number;
  netMargin: number;
  deliverySpent: number;
  status: string;
};

export type GroupDetail = GroupRow & { members: GroupMember[] };

const EMPTY_SALES: GroupSales = { billing: 0, received: 0, outstanding: 0, payable: 0, netMargin: 0 };
const EMPTY_DELIVERY: GroupDelivery = { programs: 0, allocated: 0, spent: 0, result: 0 };

/**
 * One assignedIds round-trip per DAL call: `assigned` feeds listAccountsForUser
 * as its override (so it doesn't re-fetch), `scope` (null = unrestricted) feeds
 * the delivery queries and membership checks.
 */
async function scopeFor(user: SessionUser): Promise<{ assigned: number[]; scope: number[] | null }> {
  const assigned = user.roles.includes("super-admin") ? [] : await assignedIds(user.id);
  return { assigned, scope: scopeAccountIds(user, assigned) };
}

function scopeCondition(scope: number[] | null) {
  return scope === null ? undefined : inArray(accounts.id, scope.length ? scope : [-1]);
}

/**
 * Delivery rollups for grouped accounts, keyed by group id — 2 grouped queries
 * (never per-group). Budgets exclude cancelled events (allocation freed);
 * spend counts every activity cost (money burned stays burned).
 */
async function loadDeliveryByGroup(scope: number[] | null): Promise<Map<number, GroupDelivery>> {
  const [budgetRows, costRows] = await Promise.all([
    db
      .select({
        groupId: accounts.groupId,
        programs: sql<number>`count(distinct ${programs.id})::int`,
        allocated: sql<string>`coalesce(sum(${deliveryEvents.budget}) filter (where ${deliveryEvents.status} <> 'cancelled'), 0)::text`,
      })
      .from(programs)
      .innerJoin(accounts, eq(programs.accountId, accounts.id))
      .leftJoin(deliveryEvents, eq(deliveryEvents.programId, programs.id))
      .where(and(sql`${accounts.groupId} is not null`, scopeCondition(scope)))
      .groupBy(accounts.groupId),
    db
      .select({
        groupId: accounts.groupId,
        spent: sql<string>`coalesce(sum(${deliveryActivities.cost}), 0)::text`,
      })
      .from(deliveryActivities)
      .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
      .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
      .innerJoin(accounts, eq(programs.accountId, accounts.id))
      .where(and(sql`${accounts.groupId} is not null`, scopeCondition(scope)))
      .groupBy(accounts.groupId),
  ]);

  const byGroup = new Map<number, GroupDelivery>();
  for (const r of budgetRows) {
    if (r.groupId === null) continue;
    byGroup.set(r.groupId, { programs: r.programs, allocated: Number(r.allocated), spent: 0, result: 0 });
  }
  for (const r of costRows) {
    if (r.groupId === null) continue;
    const d = byGroup.get(r.groupId) ?? { ...EMPTY_DELIVERY };
    d.spent = Number(r.spent);
    byGroup.set(r.groupId, d);
  }
  for (const d of byGroup.values()) d.result = d.allocated - d.spent;
  return byGroup;
}

/** Per-account delivery spend (for group-member rows) — one grouped query. */
async function loadSpentByAccount(accountIds: number[]): Promise<Map<number, number>> {
  const spent = new Map<number, number>();
  if (!accountIds.length) return spent;
  const rows = await db
    .select({
      accountId: programs.accountId,
      spent: sql<string>`coalesce(sum(${deliveryActivities.cost}), 0)::text`,
    })
    .from(deliveryActivities)
    .innerJoin(deliveryEvents, eq(deliveryActivities.eventId, deliveryEvents.id))
    .innerJoin(programs, eq(deliveryEvents.programId, programs.id))
    .where(inArray(programs.accountId, accountIds))
    .groupBy(programs.accountId);
  for (const r of rows) spent.set(r.accountId, Number(r.spent));
  return spent;
}

type AccountRowWithGroup = Awaited<ReturnType<typeof listAccountsForUser>>[number];

function sumSales(rows: AccountRowWithGroup[]): GroupSales {
  return rows.reduce(
    (s, r) => ({
      billing: s.billing + r.billing,
      received: s.received + r.received,
      outstanding: s.outstanding + r.outstanding,
      payable: s.payable + r.payable,
      netMargin: s.netMargin + r.netMargin,
    }),
    { ...EMPTY_SALES },
  );
}

/** Total member counts per group (unscoped — distinguishes EMPTY from hidden). */
async function loadTotalMemberCounts(): Promise<Map<number, number>> {
  const rows = await db
    .select({ groupId: accounts.groupId, n: sql<number>`count(*)::int` })
    .from(accounts)
    .where(sql`${accounts.groupId} is not null`)
    .groupBy(accounts.groupId);
  return new Map(rows.filter((r) => r.groupId !== null).map((r) => [r.groupId!, r.n]));
}

/**
 * Groups visible to the caller, with cumulative rollups. A group is visible
 * when it has an in-scope member OR no members at all (empty groups must stay
 * reachable so they can be refilled or deleted — never orphaned). Groups whose
 * members are ALL out of the caller's scope stay hidden.
 */
export async function listGroups(user: SessionUser, yearLabel: string): Promise<GroupRow[]> {
  assertGroupsManage(user);
  const { assigned, scope } = await scopeFor(user);
  const [groups, accountRows, deliveryByGroup, totalCounts] = await Promise.all([
    db.select().from(accountGroups).orderBy(asc(accountGroups.name)),
    listAccountsForUser(user, yearLabel, assigned),
    loadDeliveryByGroup(scope),
    loadTotalMemberCounts(),
  ]);

  const membersByGroup = new Map<number, AccountRowWithGroup[]>();
  for (const row of accountRows) {
    if (row.groupId === null) continue;
    const list = membersByGroup.get(row.groupId) ?? [];
    list.push(row);
    membersByGroup.set(row.groupId, list);
  }

  return groups
    .filter((g) => (membersByGroup.get(g.id)?.length ?? 0) > 0 || (totalCounts.get(g.id) ?? 0) === 0)
    .map((g) => {
      const members = membersByGroup.get(g.id) ?? [];
      const sales = sumSales(members);
      const delivery = deliveryByGroup.get(g.id) ?? { ...EMPTY_DELIVERY };
      return {
        id: g.id,
        name: g.name,
        memberCount: members.length,
        sales,
        delivery,
        groupNet: sales.netMargin + delivery.result,
      };
    });
}

/**
 * One group with member rows. Null when missing, or when the group HAS members
 * but none are in the caller's scope (hidden). An empty group (zero members)
 * is returned with members: [] so it stays manageable — refill or delete.
 */
export async function getGroupDetail(
  user: SessionUser,
  id: number,
  yearLabel: string,
): Promise<GroupDetail | null> {
  assertGroupsManage(user);
  const { assigned, scope } = await scopeFor(user);
  const [[group], accountRows, deliveryByGroup, [totalRow]] = await Promise.all([
    db.select().from(accountGroups).where(eq(accountGroups.id, id)).limit(1),
    listAccountsForUser(user, yearLabel, assigned),
    loadDeliveryByGroup(scope),
    db.select({ n: sql<number>`count(*)::int` }).from(accounts).where(eq(accounts.groupId, id)),
  ]);
  if (!group) return null;

  const memberRows = accountRows.filter((r) => r.groupId === id);
  const totalMembers = totalRow?.n ?? 0;
  if (!memberRows.length && totalMembers > 0) return null; // members exist, none visible → hidden

  const spentByAccount = await loadSpentByAccount(memberRows.map((r) => r.id));
  const sales = sumSales(memberRows);
  const delivery = deliveryByGroup.get(id) ?? { ...EMPTY_DELIVERY };

  return {
    id: group.id,
    name: group.name,
    memberCount: memberRows.length,
    sales,
    delivery,
    groupNet: sales.netMargin + delivery.result,
    members: memberRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      oem: r.oem,
      billing: r.billing,
      netMargin: r.netMargin,
      deliverySpent: spentByAccount.get(r.id) ?? 0,
      status: r.status,
    })),
  };
}

/** In-scope accounts not yet in any group (for the create/add pickers). */
export async function listUngroupedAccounts(user: SessionUser): Promise<{ id: number; name: string }[]> {
  assertGroupsManage(user);
  const { scope } = await scopeFor(user);
  return db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(isNull(accounts.groupId), scopeCondition(scope)))
    .orderBy(asc(accounts.name));
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new UserError("Give the group a name (usually the university's name).");
  if (trimmed.length > 120) throw new UserError("Group name is too long.");
  return trimmed;
}

function isUniqueViolation(e: unknown): boolean {
  let cur = e as { code?: string; message?: string; cause?: unknown } | undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur.code === "23505" || (cur.message && /unique|duplicate/i.test(cur.message))) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

/** Every id must exist, be in the caller's scope, and be ungrouped. */
async function assertGroupableAccounts(
  scope: number[] | null,
  accountIds: number[],
): Promise<void> {
  if (!accountIds.length) throw new UserError("Pick at least one account.");
  const rows = await db
    .select({ id: accounts.id, groupId: accounts.groupId })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  if (rows.length !== new Set(accountIds).size) throw new UserError("One of those accounts doesn't exist.");
  if (scope !== null) {
    const allowed = new Set(scope);
    if (rows.some((r) => !allowed.has(r.id))) {
      throw new UserError("You can only group accounts assigned to you.");
    }
  }
  const grouped = rows.find((r) => r.groupId !== null);
  if (grouped) throw new UserError("One of those accounts is already in a group — remove it there first.");
}

/**
 * Guarded membership write: only rows that are STILL ungrouped are claimed
 * (concurrent grouping loses the race loudly instead of silently stealing
 * members). Returns the claimed ids; rolls itself back on a partial claim.
 */
async function claimAccounts(groupId: number, accountIds: number[]): Promise<void> {
  const claimed = await db
    .update(accounts)
    .set({ groupId })
    .where(and(inArray(accounts.id, accountIds), isNull(accounts.groupId)))
    .returning({ id: accounts.id });
  if (claimed.length !== accountIds.length) {
    // Someone grouped one of these concurrently — undo our partial claim.
    if (claimed.length) {
      await db
        .update(accounts)
        .set({ groupId: null })
        .where(and(inArray(accounts.id, claimed.map((c) => c.id)), eq(accounts.groupId, groupId)));
    }
    throw new UserError("One of those accounts was just added to another group — refresh and try again.");
  }
}

/**
 * A group is MANAGEABLE by the caller when it is visible to them: it has an
 * in-scope member, or no members at all. Rename/delete act on the group as a
 * whole — an admin who can see a group may rename or delete it even when some
 * members sit outside their scope, because deletion only clears grouping
 * metadata (FK SET NULL); accounts themselves are never touched. Groups whose
 * members are ALL out of scope behave as if they don't exist.
 */
async function assertGroupManageable(user: SessionUser, groupId: number): Promise<number[] | null> {
  const [{ scope }, [group], memberRows] = await Promise.all([
    scopeFor(user),
    db.select({ id: accountGroups.id }).from(accountGroups).where(eq(accountGroups.id, groupId)).limit(1),
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.groupId, groupId)),
  ]);
  if (!group) throw new UserError("Group not found.");
  if (scope !== null && memberRows.length > 0) {
    const allowed = new Set(scope);
    if (!memberRows.some((m) => allowed.has(m.id))) throw new UserError("Group not found.");
  }
  return scope;
}

export async function createGroup(
  user: SessionUser,
  name: string,
  accountIds: number[],
): Promise<{ id: number }> {
  assertGroupsManage(user);
  const label = cleanName(name);
  const { scope } = await scopeFor(user);
  await assertGroupableAccounts(scope, accountIds);
  let groupId: number;
  try {
    const [row] = await db.insert(accountGroups).values({ name: label }).returning({ id: accountGroups.id });
    groupId = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(`A group named “${label}” already exists.`);
    throw e;
  }
  try {
    await claimAccounts(groupId, accountIds);
  } catch (e) {
    // No transactions on neon-http — compensate so no empty group is left behind.
    await db.delete(accountGroups).where(eq(accountGroups.id, groupId));
    throw e;
  }
  return { id: groupId };
}

export async function renameGroup(user: SessionUser, id: number, name: string): Promise<void> {
  assertGroupsManage(user);
  const label = cleanName(name);
  await assertGroupManageable(user, id);
  try {
    const updated = await db
      .update(accountGroups)
      .set({ name: label })
      .where(eq(accountGroups.id, id))
      .returning({ id: accountGroups.id });
    if (!updated.length) throw new UserError("Group not found.");
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(`A group named “${label}” already exists.`);
    throw e;
  }
}

export async function addAccountsToGroup(user: SessionUser, id: number, accountIds: number[]): Promise<void> {
  assertGroupsManage(user);
  const scope = await assertGroupManageable(user, id);
  await assertGroupableAccounts(scope, accountIds);
  await claimAccounts(id, accountIds);
}

export async function removeAccountFromGroup(user: SessionUser, accountId: number): Promise<void> {
  assertGroupsManage(user);
  const { scope } = await scopeFor(user);
  if (scope !== null && !scope.includes(accountId)) {
    throw new UserError("You can only manage accounts assigned to you.");
  }
  await db.update(accounts).set({ groupId: null }).where(eq(accounts.id, accountId));
}

/** Deleting a group only ungroups its members (FK SET NULL) — accounts stay intact. */
export async function deleteGroup(user: SessionUser, id: number): Promise<void> {
  assertGroupsManage(user);
  await assertGroupManageable(user, id);
  const deleted = await db.delete(accountGroups).where(eq(accountGroups.id, id)).returning({ id: accountGroups.id });
  if (!deleted.length) throw new UserError("Group not found.");
}
