import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  academicYears,
  accountGroups,
  accounts,
  auditLog,
  deliveryActivities,
  deliveryEvents,
  deliveryMethods,
  invoices,
  oems,
  programs,
  userAccounts,
  userRoles,
  users,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { listAccountsForUser } from "./accounts";
import {
  addAccountsToGroup,
  createGroup,
  deleteGroup,
  getGroupDetail,
  listGroups,
  listUngroupedAccounts,
  removeAccountFromGroup,
  renameGroup,
} from "./groups";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const VIEWER = { id: 999, roles: ["viewer" as const] };
const DELIVERY_ROLE = { id: 998, roles: ["delivery" as const] };
const YEAR = "FY26–27";

const RUN = String(Date.now()).slice(-6);
const fx = { oemId: 0, acc1: 0, acc2: 0, yearId: 0, methodId: 0, adminId: 0, otherId: 0, groupId: 0 };
// A second, throwaway super-admin — used to make the delete-actor test
// discriminating: create as SUPER, delete as OTHER, so a plain unstamped
// delete (which would leave OLD.updated_by as the creator) fails the
// assertion instead of accidentally matching. `roles` is set from this
// object directly (authz reads SessionUser.roles, not the DB); the users/
// user_roles rows created in beforeAll exist only so audit_log's actorId FK
// has something to point at.
const OTHER = { id: 0, roles: ["super-admin" as const] };

beforeAll(async () => {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.label, YEAR)).limit(1);
  fx.yearId = year.id;
  const [oem] = await db.insert(oems).values({ name: `GrpOEM-${RUN}` }).returning({ id: oems.id });
  fx.oemId = oem.id;
  const [a1] = await db
    .insert(accounts)
    .values({ name: `GrpUni-${RUN}`, oemId: oem.id })
    .returning({ id: accounts.id });
  const [a2] = await db
    .insert(accounts)
    .values({ name: `GrpProgramme-${RUN}`, type: "programme", oemId: oem.id })
    .returning({ id: accounts.id });
  fx.acc1 = a1.id;
  fx.acc2 = a2.id;
  // One raised invoice each so the money engine has real numbers to sum.
  await db.insert(invoices).values([
    { accountId: fx.acc1, yearId: fx.yearId, category: "new", students: 10, priceToUni: "1000", priceToDatagami: "600", status: "raised" },
    { accountId: fx.acc2, yearId: fx.yearId, category: "new", students: 5, priceToUni: "2000", priceToDatagami: "1500", status: "raised" },
  ]);
  // Delivery: a program per account; acc1 has a live event (budget 5000, spent
  // 2000), acc2 a CANCELLED event (budget 3000 freed, spent 500 still real).
  const [method] = await db
    .insert(deliveryMethods)
    .values({ name: `GrpStyle-${RUN}`, code: `G${RUN}` })
    .returning({ id: deliveryMethods.id });
  fx.methodId = method.id;
  const [p1] = await db
    .insert(programs)
    .values({ accountId: fx.acc1, oemId: oem.id, deliveryMethodId: method.id, name: `GrpProg1-${RUN}` })
    .returning({ id: programs.id });
  const [p2] = await db
    .insert(programs)
    .values({ accountId: fx.acc2, oemId: oem.id, deliveryMethodId: method.id, name: `GrpProg2-${RUN}` })
    .returning({ id: programs.id });
  const [e1] = await db
    .insert(deliveryEvents)
    .values({ programId: p1.id, title: "Live", startDate: "2026-08-01", budget: "5000" })
    .returning({ id: deliveryEvents.id });
  const [e2] = await db
    .insert(deliveryEvents)
    .values({ programId: p2.id, title: "Cancelled", startDate: "2026-08-02", budget: "3000", status: "cancelled" })
    .returning({ id: deliveryEvents.id });
  await db.insert(deliveryActivities).values([
    { eventId: e1.id, type: "expense", title: "Venue", activityDate: "2026-07-20", cost: "2000", author: "Test" },
    { eventId: e2.id, type: "expense", title: "Deposit", activityDate: "2026-07-21", cost: "500", author: "Test" },
  ]);
  // Admin scoped to acc1 only (for the scoping test).
  const [admin] = await db
    .insert(users)
    .values({ name: `Grp Admin ${RUN}`, email: `grp-admin-${RUN}@test.local`, passwordHash: "x", role: "sales" })
    .returning({ id: users.id });
  fx.adminId = admin.id;
  await db.insert(userAccounts).values({ userId: admin.id, accountId: fx.acc1 });

  // Throwaway second super-admin (OTHER) — see comment above its declaration.
  const [other] = await db
    .insert(users)
    .values({ name: `Grp Other ${RUN}`, email: `grp-other-${RUN}@test.local`, passwordHash: "x", role: "super-admin" })
    .returning({ id: users.id });
  fx.otherId = other.id;
  OTHER.id = other.id;
  await db.insert(userRoles).values({ userId: other.id, role: "super-admin", createdBy: SUPER.id, updatedBy: SUPER.id });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, fx.adminId)); // cascades user_accounts
  await db.delete(users).where(eq(users.id, fx.otherId)); // cascades user_roles; audit_log.actorId FK is set-null
  // Invoices don't cascade from accounts — clear them first; programs/events/
  // activities DO cascade from accounts.
  await db.delete(invoices).where(inArray(invoices.accountId, [fx.acc1, fx.acc2]));
  await db.delete(accounts).where(inArray(accounts.id, [fx.acc1, fx.acc2]));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.id, fx.methodId));
  await db.delete(oems).where(eq(oems.id, fx.oemId));
  if (fx.groupId) await db.delete(accountGroups).where(eq(accountGroups.id, fx.groupId));
});

describe("account groups — rollups & membership", () => {
  it("createGroup groups the accounts; listGroups sums exactly the members' rows", async () => {
    const { id } = await createGroup(SUPER, `Grp ${RUN}`, [fx.acc1, fx.acc2]);
    fx.groupId = id;

    const individual = (await listAccountsForUser(SUPER, YEAR)).filter((r) =>
      [fx.acc1, fx.acc2].includes(r.id),
    );
    expect(individual).toHaveLength(2);
    const expected = {
      billing: individual.reduce((s, r) => s + r.billing, 0),
      netMargin: individual.reduce((s, r) => s + r.netMargin, 0),
    };

    const groups = await listGroups(SUPER, YEAR);
    const g = groups.find((x) => x.id === id)!;
    expect(g.memberCount).toBe(2);
    expect(g.sales.billing).toBe(expected.billing);
    expect(g.sales.netMargin).toBe(expected.netMargin);
    // Delivery: cancelled budget freed, its spend still counted.
    expect(g.delivery).toMatchObject({ programs: 2, allocated: 5000, spent: 2500, result: 2500 });
    expect(g.groupNet).toBe(expected.netMargin + 2500);

    // The audit trigger reads created_by/updated_by off the row — assert the
    // app stamped both the freshly-inserted group and the claimed members.
    const [groupRow] = await db.select().from(accountGroups).where(eq(accountGroups.id, id)).limit(1);
    expect(groupRow.createdBy).toBe(SUPER.id);
    expect(groupRow.updatedBy).toBe(SUPER.id);
    const memberRows = await db.select().from(accounts).where(inArray(accounts.id, [fx.acc1, fx.acc2]));
    for (const m of memberRows) expect(m.updatedBy).toBe(SUPER.id);
  });

  it("getGroupDetail returns member rows with per-account delivery spend", async () => {
    const detail = (await getGroupDetail(SUPER, fx.groupId, YEAR))!;
    expect(detail.members).toHaveLength(2);
    const m1 = detail.members.find((m) => m.id === fx.acc1)!;
    const m2 = detail.members.find((m) => m.id === fx.acc2)!;
    expect(m1.deliverySpent).toBe(2000);
    expect(m2.deliverySpent).toBe(500);
    expect(detail.groupNet).toBe(detail.sales.netMargin + detail.delivery.result);
    expect(await getGroupDetail(SUPER, 99999999, YEAR)).toBeNull();
  });

  it("a scoped admin sees only their members' sums", async () => {
    const admin = { id: fx.adminId, roles: ["sales" as const] };
    const groups = await listGroups(admin, YEAR);
    const g = groups.find((x) => x.id === fx.groupId)!;
    expect(g.memberCount).toBe(1); // acc2 invisible to this admin
    expect(g.delivery.spent).toBe(2000); // acc2's 500 excluded
    const detail = (await getGroupDetail(admin, fx.groupId, YEAR))!;
    expect(detail.members.map((m) => m.id)).toEqual([fx.acc1]);
  });

  it("grouped accounts leave the ungrouped picker; already-grouped is rejected", async () => {
    const ungrouped = await listUngroupedAccounts(SUPER);
    expect(ungrouped.find((a) => a.id === fx.acc1)).toBeUndefined();
    await expect(createGroup(SUPER, `Dup ${RUN}`, [fx.acc1])).rejects.toThrow(/already in a group/);
    await expect(createGroup(SUPER, `Grp ${RUN}`, [999999999])).rejects.toThrow();
  });

  it("scoped admin cannot group accounts outside their assignment", async () => {
    const admin = { id: fx.adminId, roles: ["sales" as const] };
    await removeAccountFromGroup(SUPER, fx.acc2); // acc2 now ungrouped but NOT assigned to admin
    await expect(addAccountsToGroup(admin, fx.groupId, [fx.acc2])).rejects.toThrow(/assigned to you/);
    await addAccountsToGroup(SUPER, fx.groupId, [fx.acc2]); // super-admin can re-add
  });

  it("remove shrinks sums; rename works; delete ungroups without touching accounts", async () => {
    await removeAccountFromGroup(SUPER, fx.acc2);
    const g = (await listGroups(SUPER, YEAR)).find((x) => x.id === fx.groupId)!;
    expect(g.memberCount).toBe(1);
    expect(g.delivery.spent).toBe(2000);

    await renameGroup(SUPER, fx.groupId, `Grp ${RUN} renamed`);
    const renamed = (await listGroups(SUPER, YEAR)).find((x) => x.id === fx.groupId)!;
    expect(renamed.name).toBe(`Grp ${RUN} renamed`);
    const [renamedRow] = await db.select().from(accountGroups).where(eq(accountGroups.id, fx.groupId)).limit(1);
    expect(renamedRow.updatedBy).toBe(SUPER.id);

    await deleteGroup(SUPER, fx.groupId);
    fx.groupId = 0;
    const [acc1Row] = await db.select().from(accounts).where(eq(accounts.id, fx.acc1)).limit(1);
    expect(acc1Row).toBeDefined(); // account survives
    expect(acc1Row.groupId).toBeNull(); // just ungrouped
    expect(acc1Row.updatedBy).toBe(SUPER.id); // claimAccounts stamped it back at creation
  });

  it("delete stamps the deleter, not the group's creator or the member's stale editor", async () => {
    // Create as SUPER, delete as a DIFFERENT super-admin (OTHER), WITH a
    // member still in the group. If deleteGroup were reverted to a plain
    // delete, the FK SET NULL cascade would ungroup fx.acc1 unattributed
    // (leaving its audit row stamped with acc1's stale last editor, SUPER,
    // from the previous test) and OLD.updated_by on the group would still
    // read SUPER's id — so asserting actorId === OTHER.id on BOTH rows only
    // passes when deleteGroup's explicit pre-delete ungroup runs.
    const { id } = await createGroup(SUPER, `DelActor ${RUN}`, [fx.acc1]);
    await deleteGroup(OTHER, id);

    const groupRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "account_groups"), eq(auditLog.rowId, String(id)), eq(auditLog.op, "DELETE")));
    expect(groupRows.length).toBe(1);
    expect(groupRows[0].actorId).toBe(OTHER.id);

    const memberRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, "accounts"), eq(auditLog.rowId, String(fx.acc1)), eq(auditLog.op, "UPDATE")))
      .orderBy(auditLog.id);
    const ungroupRow = memberRows.at(-1)!; // deleteGroup's explicit ungroup is the last UPDATE on this row
    expect(ungroupRow.actorId).toBe(OTHER.id);

    await db.delete(auditLog).where(and(eq(auditLog.tableName, "account_groups"), eq(auditLog.rowId, String(id))));
    await db
      .delete(auditLog)
      .where(
        and(eq(auditLog.tableName, "accounts"), eq(auditLog.rowId, String(fx.acc1)), eq(auditLog.op, "UPDATE"), eq(auditLog.actorId, OTHER.id)),
      );
  });

  it("viewer and delivery roles are rejected", async () => {
    await expect(listGroups(VIEWER, YEAR)).rejects.toThrow();
    await expect(listUngroupedAccounts(DELIVERY_ROLE)).rejects.toThrow();
    await expect(createGroup(VIEWER, "Nope", [fx.acc1])).rejects.toThrow();
  });

  it("an emptied group stays visible and deletable (never orphaned)", async () => {
    const { id } = await createGroup(SUPER, `Empty ${RUN}`, [fx.acc1]);
    await removeAccountFromGroup(SUPER, fx.acc1); // last member out
    const row = (await listGroups(SUPER, YEAR)).find((g) => g.id === id)!;
    expect(row.memberCount).toBe(0); // still listed
    const detail = (await getGroupDetail(SUPER, id, YEAR))!;
    expect(detail.members).toEqual([]); // detail page renders, no 404
    await addAccountsToGroup(SUPER, id, [fx.acc1]); // refillable
    await removeAccountFromGroup(SUPER, fx.acc1);
    await deleteGroup(SUPER, id); // and deletable
    expect((await listGroups(SUPER, YEAR)).find((g) => g.id === id)).toBeUndefined();
  });

  it("a scoped admin can't see, rename, delete or add to a group with only out-of-scope members", async () => {
    const admin = { id: fx.adminId, roles: ["sales" as const] };
    // acc2 is NOT assigned to the admin; group it alone.
    const { id } = await createGroup(SUPER, `Hidden ${RUN}`, [fx.acc2]);
    expect((await listGroups(admin, YEAR)).find((g) => g.id === id)).toBeUndefined();
    expect(await getGroupDetail(admin, id, YEAR)).toBeNull();
    await expect(renameGroup(admin, id, "Stolen")).rejects.toThrow(/not found/i);
    await expect(deleteGroup(admin, id)).rejects.toThrow(/not found/i);
    await expect(addAccountsToGroup(admin, id, [fx.acc1])).rejects.toThrow(/not found/i);
    await deleteGroup(SUPER, id); // super-admin cleans up (acc2 ungroups)
  });
});
