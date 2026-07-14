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

/** null = unrestricted (super-admin); otherwise the caller's assigned account ids. */
async function scopeFor(user: SessionUser): Promise<number[] | null> {
  const assigned = user.role === "super-admin" ? [] : await assignedIds(user.id);
  return scopeAccountIds(user, assigned);
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

/** All groups visible to the caller (≥1 in-scope member), with cumulative rollups. */
export async function listGroups(user: SessionUser, yearLabel: string): Promise<GroupRow[]> {
  assertGroupsManage(user);
  const scope = await scopeFor(user);
  const [groups, accountRows, deliveryByGroup] = await Promise.all([
    db.select().from(accountGroups).orderBy(asc(accountGroups.name)),
    listAccountsForUser(user, yearLabel),
    loadDeliveryByGroup(scope),
  ]);

  const membersByGroup = new Map<number, AccountRowWithGroup[]>();
  for (const row of accountRows) {
    if (row.groupId === null) continue;
    const list = membersByGroup.get(row.groupId) ?? [];
    list.push(row);
    membersByGroup.set(row.groupId, list);
  }

  return groups
    .filter((g) => (membersByGroup.get(g.id)?.length ?? 0) > 0)
    .map((g) => {
      const members = membersByGroup.get(g.id)!;
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

/** One group with member rows. Null when missing or no member is in the caller's scope. */
export async function getGroupDetail(
  user: SessionUser,
  id: number,
  yearLabel: string,
): Promise<GroupDetail | null> {
  assertGroupsManage(user);
  const scope = await scopeFor(user);
  const [[group], accountRows, deliveryByGroup] = await Promise.all([
    db.select().from(accountGroups).where(eq(accountGroups.id, id)).limit(1),
    listAccountsForUser(user, yearLabel),
    loadDeliveryByGroup(scope),
  ]);
  if (!group) return null;

  const memberRows = accountRows.filter((r) => r.groupId === id);
  if (!memberRows.length) return null; // nothing visible → hidden for this caller

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
  const scope = await scopeFor(user);
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

/** Every id must exist, be in the caller's scope, and (for grouping) be ungrouped. */
async function assertGroupableAccounts(user: SessionUser, accountIds: number[]): Promise<void> {
  if (!accountIds.length) throw new UserError("Pick at least one account.");
  const scope = await scopeFor(user);
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

export async function createGroup(
  user: SessionUser,
  name: string,
  accountIds: number[],
): Promise<{ id: number }> {
  assertGroupsManage(user);
  const label = cleanName(name);
  await assertGroupableAccounts(user, accountIds);
  let groupId: number;
  try {
    const [row] = await db.insert(accountGroups).values({ name: label }).returning({ id: accountGroups.id });
    groupId = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(`A group named “${label}” already exists.`);
    throw e;
  }
  await db.update(accounts).set({ groupId }).where(inArray(accounts.id, accountIds));
  return { id: groupId };
}

export async function renameGroup(user: SessionUser, id: number, name: string): Promise<void> {
  assertGroupsManage(user);
  const label = cleanName(name);
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
  const [group] = await db.select({ id: accountGroups.id }).from(accountGroups).where(eq(accountGroups.id, id)).limit(1);
  if (!group) throw new UserError("Group not found.");
  await assertGroupableAccounts(user, accountIds);
  await db.update(accounts).set({ groupId: id }).where(inArray(accounts.id, accountIds));
}

export async function removeAccountFromGroup(user: SessionUser, accountId: number): Promise<void> {
  assertGroupsManage(user);
  const scope = await scopeFor(user);
  if (scope !== null && !scope.includes(accountId)) {
    throw new UserError("You can only manage accounts assigned to you.");
  }
  await db.update(accounts).set({ groupId: null }).where(eq(accounts.id, accountId));
}

/** Deleting a group only ungroups its members (FK SET NULL) — accounts stay intact. */
export async function deleteGroup(user: SessionUser, id: number): Promise<void> {
  assertGroupsManage(user);
  const deleted = await db.delete(accountGroups).where(eq(accountGroups.id, id)).returning({ id: accountGroups.id });
  if (!deleted.length) throw new UserError("Group not found.");
}
