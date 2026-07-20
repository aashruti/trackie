import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  users,
  authSessions,
  userAccounts,
  userRoles,
  auditLog,
  employeeProfiles,
  leaveRequests,
  leaveTypes,
  tasks,
} from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import {
  createUser,
  listUsers,
  setUserAccounts,
  setUserRoles,
  wouldOrphanSuperAdmins,
  deleteUser,
  resetUserPassword,
  signOutUserEverywhere,
} from "./user-admin";
import { listAccountsForUser } from "./accounts";
import { createSession, sessionExists } from "./sessions";
import { getOrCreateEmployeeForUser, applyForLeave } from "./hr/leave";

const SUPER = { id: 1, roles: ["super-admin" as const] };

describe("user-admin", () => {
  let userId: number | null = null;

  it("super-admin creates a user and assigns accounts", async () => {
    const all = await listAccountsForUser(SUPER, "FY26–27");
    const pick = all.slice(0, 2).map((a) => a.id);

    const u = await createUser(SUPER, {
      name: "Test Manager",
      email: "test-manager@datagami.local",
      password: "secret123",
      roles: ["sales"],
    });
    userId = u.id;

    await setUserAccounts(SUPER, u.id, pick);

    const allUsers = await listUsers(SUPER);
    const created = allUsers.find((x) => x.id === u.id)!;
    expect(created.roles).toEqual(["sales"]);
    expect(created.assignedAccountIds.sort()).toEqual([...pick].sort());

    // The new sales user now sees exactly those accounts — proves createUser
    // actually seeds user_roles (not just the users.role scalar), since
    // scopeAccountIds/canEdit read the role SET.
    const scoped = await listAccountsForUser({ id: u.id, roles: ["sales"] }, "FY26–27");
    expect(scoped.map((a) => a.id).sort()).toEqual([...pick].sort());

    // The audit trigger reads updated_by off the row to attribute the audit_log
    // entry — assert the app actually stamped both columns on insert, on both
    // the users row and its user_roles row.
    const [userRow] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    expect(userRow.createdBy).toBe(SUPER.id);
    expect(userRow.updatedBy).toBe(SUPER.id);
    const [roleRow] = await db.select().from(userRoles).where(eq(userRoles.userId, u.id)).limit(1);
    expect(roleRow.createdBy).toBe(SUPER.id);
    expect(roleRow.updatedBy).toBe(SUPER.id);
  });

  it("rejects a non-super-admin", async () => {
    await expect(
      listUsers({ id: 2, roles: ["sales"] }),
    ).rejects.toThrow();
    await expect(
      createUser({ id: 2, roles: ["sales"] }, { name: "x", email: "x@y.z", password: "secret123", roles: ["viewer"] }),
    ).rejects.toThrow();
  });

  it("createUser defaults to [\"viewer\"] and seeds user_roles — closes the lockout gap", async () => {
    // Before Task 6, createUser wrote only the users.role scalar; a freshly
    // created user had ZERO user_roles rows and logged in with roles: [],
    // locked out of every gated surface. Prove the row actually exists.
    const u = await createUser(SUPER, {
      name: "No Roles Given",
      email: "no-roles-given@datagami.local",
      password: "secret123",
    });
    try {
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role)).toEqual(["viewer"]);
      const created = (await listUsers(SUPER)).find((x) => x.id === u.id)!;
      expect(created.roles).toEqual(["viewer"]);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("createUser seeds a stacked role set into user_roles, and users.role scalar = roles[0]", async () => {
    const u = await createUser(SUPER, {
      name: "Stacked Creation",
      email: "stacked-creation@datagami.local",
      password: "secret123",
      roles: ["sales", "delivery"],
    });
    try {
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role).sort()).toEqual(["delivery", "sales"]);
      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      expect(row.role).toBe("sales"); // roles[0] — the rollback-seed scalar
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("resets another user's password so the new one works and the old one stops", async () => {
    const u = await createUser(SUPER, {
      name: "Reset Target",
      email: "reset-target@datagami.local",
      password: "oldpassword1",
      roles: ["viewer"],
    });
    try {
      await resetUserPassword(SUPER, u.id, "brandnewpass1");

      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      // Verify by BEHAVIOUR, not by "the hash changed" — a garbage hash would
      // also change, and would also pass that weaker assertion.
      expect(await verifyPassword("brandnewpass1", row.passwordHash)).toBe(true);
      expect(await verifyPassword("oldpassword1", row.passwordHash)).toBe(false);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("refuses a non-super-admin actor for every other role", async () => {
    for (const role of ["sales", "hr", "delivery", "viewer"] as const) {
      await expect(
        resetUserPassword({ id: 2, roles: [role] }, 3, "brandnewpass1"),
      ).rejects.toThrow(/Super Admin/i);
    }
  });

  it("refuses a password shorter than 8 characters", async () => {
    await expect(resetUserPassword(SUPER, 3, "short12")).rejects.toThrow(/8 characters/i);
  });

  it("refuses resetting your own password — that belongs in profile", async () => {
    await expect(resetUserPassword(SUPER, SUPER.id, "brandnewpass1")).rejects.toThrow(/profile/i);
  });

  it("refuses an unknown user", async () => {
    await expect(resetUserPassword(SUPER, 999999, "brandnewpass1")).rejects.toThrow(/not found/i);
  });

  it("createUser now requires 8 characters too", async () => {
    await expect(
      createUser(SUPER, { name: "x", email: "too-short@datagami.local", password: "short12", roles: ["viewer"] }),
    ).rejects.toThrow(/8 characters/i);
  });

  it("sign out everywhere ends sessions without touching the password", async () => {
    const u = await createUser(SUPER, {
      name: "Kick Target",
      email: "kick-target@datagami.local",
      password: "keepthispass1",
      roles: ["viewer"],
    });
    try {
      const sid = await createSession(u.id);
      const ended = await signOutUserEverywhere(SUPER, u.id);
      expect(ended).toBe(1);
      expect(await sessionExists(sid)).toBe(false);

      // The password is untouched — that is the whole distinction from a reset.
      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      expect(await verifyPassword("keepthispass1", row.passwordHash)).toBe(true);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("only a super admin can sign someone out everywhere", async () => {
    for (const role of ["sales", "hr", "delivery", "viewer"] as const) {
      await expect(signOutUserEverywhere({ id: 2, roles: [role] }, 3)).rejects.toThrow(/Super Admin/i);
    }
  });

  it("a password reset ends the target's sessions", async () => {
    const u = await createUser(SUPER, {
      name: "Revoke Target",
      email: "revoke-target@datagami.local",
      password: "oldpassword1",
      roles: ["viewer"],
    });
    try {
      const sid = await createSession(u.id);
      expect(await sessionExists(sid)).toBe(true);
      await resetUserPassword(SUPER, u.id, "brandnewpass1");
      // The whole point: the reset locks out anyone already signed in.
      expect(await sessionExists(sid)).toBe(false);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("revokes before changing the password, so a mid-way failure can't lock anyone out", async () => {
    const u = await createUser(SUPER, {
      name: "Order Target",
      email: "order-target@datagami.local",
      password: "oldpassword1",
      roles: ["viewer"],
    });
    try {
      await createSession(u.id);
      // These two steps cannot be atomic — the neon-http driver used in
      // production has no transaction support — so ORDER is the only safeguard.
      // Revoke-then-change fails safe: the old password still works. The reverse
      // fails catastrophically, changing the password while reporting failure, so
      // nobody relays the new one and the user is locked out of an account their
      // intruder is still inside.
      //
      // Proven, not assumed: make the password update throw, then check what
      // survived.
      const spy = vi.spyOn(db, "update").mockImplementationOnce(() => {
        throw new Error("simulated DB failure mid-reset");
      });
      await expect(resetUserPassword(SUPER, u.id, "brandnewpass1")).rejects.toThrow(/simulated/);
      spy.mockRestore();

      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      // Password untouched — the user can still get in.
      expect(await verifyPassword("oldpassword1", row.passwordHash)).toBe(true);
      // And the sessions were still revoked, so an intruder is out either way.
      const [{ n }] = await db
        .select({ n: count() })
        .from(authSessions)
        .where(eq(authSessions.userId, u.id));
      expect(n).toBe(0);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  afterAll(async () => {
    if (userId) await deleteUser(SUPER, userId);
  });
});

describe("setUserRoles — the multi-select role set", () => {
  it("rejects a non-super-admin actor", async () => {
    await expect(
      setUserRoles({ id: 2, roles: ["sales"] }, 3, ["viewer"]),
    ).rejects.toThrow(/Super Admin/i);
  });

  it("rejects an empty role set — a user must hold at least one", async () => {
    const u = await createUser(SUPER, {
      name: "Empty Roles Target",
      email: "empty-roles-target@datagami.local",
      password: "secret123",
      roles: ["viewer"],
    });
    try {
      await expect(setUserRoles(SUPER, u.id, [])).rejects.toThrow(/at least one role/i);
      // Rejected — the user's role set is untouched.
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role)).toEqual(["viewer"]);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("replaces the set (delete-all + re-insert) and writes users.role = roles[0]", async () => {
    const u = await createUser(SUPER, {
      name: "Stacking Target",
      email: "stacking-target@datagami.local",
      password: "secret123",
      roles: ["viewer"],
    });
    try {
      await setUserRoles(SUPER, u.id, ["sales", "delivery"]);
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role).sort()).toEqual(["delivery", "sales"]);
      const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
      expect(row.role).toBe("sales"); // roles[0]

      // Narrowing back to a single role fully replaces the set, not merges it.
      await setUserRoles(SUPER, u.id, ["hr"]);
      const narrowed = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(narrowed.map((r) => r.role)).toEqual(["hr"]);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("dedupes a role passed twice", async () => {
    const u = await createUser(SUPER, {
      name: "Dedup Target",
      email: "dedup-target@datagami.local",
      password: "secret123",
      roles: ["viewer"],
    });
    try {
      await setUserRoles(SUPER, u.id, ["sales", "sales"]);
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role)).toEqual(["sales"]);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("allows demoting a throwaway super-admin away from super-admin when other super-admins exist", async () => {
    // We can't safely engineer the local DB down to exactly one super-admin
    // (it holds real staff records) to exercise the BLOCKING branch end to
    // end — that's what wouldOrphanSuperAdmins (below) proves in isolation.
    // This proves the ALLOW branch's wiring: a throwaway super-admin can step
    // down as long as the real staff super-admins keep the total above one.
    const u = await createUser(SUPER, {
      name: "Demotable Super",
      email: "demotable-super@datagami.local",
      password: "secret123",
      roles: ["super-admin"],
    });
    try {
      await setUserRoles(SUPER, u.id, ["viewer"]);
      const rows = await db.select().from(userRoles).where(eq(userRoles.userId, u.id));
      expect(rows.map((r) => r.role)).toEqual(["viewer"]);
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });

  it("refuses a super-admin removing their OWN super-admin, even when others exist", async () => {
    // Self-demotion guard, distinct from the orphan guard: it fires on the
    // actor editing themselves regardless of how many other super-admins exist.
    // Throws before any delete/insert, so it doesn't mutate the seed super-admin.
    await expect(setUserRoles(SUPER, SUPER.id, ["sales"])).rejects.toThrow(/your own Super Admin/i);
    // The set is untouched — still super-admin.
    const rows = await db.select().from(userRoles).where(eq(userRoles.userId, SUPER.id));
    expect(rows.map((r) => r.role)).toContain("super-admin");
  });

  it("a role change never touches user_accounts", async () => {
    const all = await listAccountsForUser(SUPER, "FY26–27");
    const pick = all.slice(0, 1).map((a) => a.id);
    const u = await createUser(SUPER, {
      name: "Accounts Untouched",
      email: "accounts-untouched@datagami.local",
      password: "secret123",
      roles: ["sales"],
    });
    try {
      await setUserAccounts(SUPER, u.id, pick);
      await setUserRoles(SUPER, u.id, ["sales", "delivery"]);
      const after = (await listUsers(SUPER)).find((x) => x.id === u.id)!;
      expect(after.assignedAccountIds.sort()).toEqual([...pick].sort());
    } finally {
      await deleteUser(SUPER, u.id);
    }
  });
});

describe("deleteUser — cascade audit regression", () => {
  it("succeeds even when the target's own user_roles row has updated_by = target (self-edit)", async () => {
    const u = await createUser(SUPER, {
      name: "Self Editor",
      email: "self-editor@datagami.local",
      password: "secret123",
      roles: ["super-admin"],
    });
    try {
      // The target edits their own role set as themselves, so user_roles's
      // updated_by ends up = the target's own id. Deleting the target
      // cascade-deletes this row; its DELETE audit trigger reads updated_by
      // (the target, about to be deleted) as the actor — which used to
      // violate audit_log.actor_id's FK and abort the whole deleteUser
      // mid-cascade. deleteUser must now stamp the cascaded rows first.
      await setUserRoles({ id: u.id, roles: ["super-admin"] }, u.id, ["super-admin"]);

      await deleteUser(SUPER, u.id);

      const rows = await db.select().from(users).where(eq(users.id, u.id));
      expect(rows).toHaveLength(0);
    } finally {
      // No-op if the assertions above already confirm deletion — deleteUser
      // on an already-gone user is a harmless silent 0-row no-op.
      await deleteUser(SUPER, u.id);
    }
  });

  it("succeeds for a user with a self-stamped employee profile AND a self-filed leave request", async () => {
    // The shape that aborted deleteUser while audit_log.actor_id still had an
    // FK to users.id. employee_profiles.user_id is ON DELETE CASCADE and
    // getOrCreateEmployeeForUser provisions the profile with
    // created_by/updated_by = the user themselves; applying for leave does the
    // same on leave_requests. Deleting the user cascades users →
    // employee_profiles → leave_requests, and EACH cascaded row's DELETE audit
    // trigger reads its own updated_by (this user, already removed in the same
    // statement) as the actor. With the FK in place that INSERT is a dangling
    // reference and the whole delete rolls back.
    //
    // Pre-stamping alone was never enough to make the delete SUCCEED —
    // stamping employee_profiles but not leave_requests still aborted, and the
    // cascade reaches leave_balances / attendance_records / payslips too. What
    // makes it succeed is that audit_log.actor_id has no FK at all, so an audit
    // row can outlive the actor it names. Pre-stamping the whole subtree
    // (deleteUser does that now) is the separate, complementary fix: it decides
    // WHO those surviving rows name.
    const u = await createUser(SUPER, {
      name: "Cascading Employee",
      email: "cascading-employee@datagami.local",
      password: "secret123",
      roles: ["viewer"],
    });
    const self = { id: u.id, roles: ["viewer" as const] };
    let employeeId: number | null = null;
    let requestId: number | null = null;
    try {
      // Self-stamped profile: created_by = updated_by = u.id.
      const me = await getOrCreateEmployeeForUser(u.id);
      expect(me).not.toBeNull();
      employeeId = me!.employeeId;
      const [profile] = await db
        .select()
        .from(employeeProfiles)
        .where(eq(employeeProfiles.id, employeeId))
        .limit(1);
      expect(profile.updatedBy).toBe(u.id); // the self-reference that used to break the delete

      // Self-filed leave request: also created_by = updated_by = u.id, and it
      // hangs off the profile, so it is a SECOND cascade level.
      const [type] = await db.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
      const applied = await applyForLeave(self, {
        leaveTypeId: type.id,
        startDate: "2026-08-03",
        endDate: "2026-08-03",
        isHalfDay: false,
        reason: "cascade regression fixture",
      });
      requestId = applied.requestId;

      await deleteUser(SUPER, u.id);

      // The user and both cascade levels are gone — no mid-cascade abort.
      expect(await db.select().from(users).where(eq(users.id, u.id))).toHaveLength(0);
      expect(
        await db.select().from(employeeProfiles).where(eq(employeeProfiles.id, employeeId)),
      ).toHaveLength(0);
      expect(
        await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId)),
      ).toHaveLength(0);

      // And the audit trail survived the actor it names — the other half of
      // dropping the FK. Under ON DELETE SET NULL this attribution would have
      // been retroactively NULLed the moment the user was deleted. The INSERT
      // row is the one that names the now-deleted user: they provisioned their
      // own profile, so its actor is them, and it is still readable afterwards.
      const profileRows = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "employee_profiles"), eq(auditLog.rowId, String(employeeId))))
        .orderBy(auditLog.id);
      const profileInsert = profileRows.filter((r) => r.op === "INSERT");
      expect(profileInsert).toHaveLength(1);
      expect(profileInsert[0].actorId).toBe(u.id); // outlived the user it names

      // The DELETE, by contrast, names the ADMIN who deleted them — deleteUser
      // pre-stamps the HR subtree. Before that fix this row read u.id, i.e. the
      // log claimed the deleted user deleted their own payroll history.
      const profileDelete = profileRows.filter((r) => r.op === "DELETE");
      expect(profileDelete).toHaveLength(1);
      expect(profileDelete[0].actorId).toBe(SUPER.id);
    } finally {
      await deleteUser(SUPER, u.id); // no-op if already deleted
      // Purge this test's audit_log rows so repeated local runs don't accumulate.
      const scopes: Array<[string, number | null]> = [
        ["users", u.id],
        ["employee_profiles", employeeId],
        ["leave_requests", requestId],
      ];
      for (const [tableName, rowId] of scopes) {
        if (rowId === null) continue;
        await db
          .delete(auditLog)
          .where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
      }
    }
  });
});

/**
 * user_roles and user_accounts have composite PKs, so audit_row() writes
 * row_id = NULL for them (there is no `id` column to record). Locate their
 * audit rows through the before/after images instead.
 */
function jsonEq(column: typeof auditLog.before, key: string, value: string | number) {
  return sql`coalesce(${column} ->> ${sql.raw(`'${key}'`)}, '') = ${String(value)}`;
}

describe("revoke attribution — a revoke names the REVOKER, not the previous granter", () => {
  const RUN = String(Date.now()).slice(-9);
  // Three DISTINCT real users: SUPER creates, GRANTER grants, REVOKER revokes.
  // Without three, a wrong-actor bug could land on the right id by accident and
  // the assertions below would not discriminate.
  let GRANTER: { id: number; roles: ["super-admin"] };
  let REVOKER: { id: number; roles: ["super-admin"] };
  const fx = { granterId: 0, revokerId: 0, targetId: 0, accountId: 0 };

  beforeAll(async () => {
    const g = await createUser(SUPER, {
      name: `Revoke Granter ${RUN}`,
      email: `revoke-granter-${RUN}@test.local`,
      password: "secret123",
      roles: ["super-admin"],
    });
    fx.granterId = g.id;
    GRANTER = { id: g.id, roles: ["super-admin"] };

    const r = await createUser(SUPER, {
      name: `Revoke Revoker ${RUN}`,
      email: `revoke-revoker-${RUN}@test.local`,
      password: "secret123",
      roles: ["super-admin"],
    });
    fx.revokerId = r.id;
    REVOKER = { id: r.id, roles: ["super-admin"] };

    const t = await createUser(SUPER, {
      name: `Revoke Target ${RUN}`,
      email: `revoke-target-${RUN}@test.local`,
      password: "secret123",
      roles: ["viewer"],
    });
    fx.targetId = t.id;

    const all = await listAccountsForUser(SUPER, "FY26–27");
    fx.accountId = all[0].id;
  });

  afterAll(async () => {
    for (const id of [fx.targetId, fx.granterId, fx.revokerId]) {
      if (id) await deleteUser(SUPER, id);
    }
    // Purge every audit_log row this describe produced. user_roles /
    // user_accounts rows carry row_id = NULL, so scope them by the user_id
    // inside the before/after image; users rows scope by row_id as usual.
    for (const id of [fx.targetId, fx.granterId, fx.revokerId]) {
      if (!id) continue;
      for (const tableName of ["user_roles", "user_accounts"]) {
        await db
          .delete(auditLog)
          .where(
            and(
              eq(auditLog.tableName, tableName),
              sql`coalesce(${auditLog.before} ->> 'user_id', ${auditLog.after} ->> 'user_id') = ${String(id)}`,
            ),
          );
      }
      await db.delete(auditLog).where(and(eq(auditLog.tableName, "users"), eq(auditLog.rowId, String(id))));
    }
  });

  it("setUserRoles: the user_roles DELETE audit row for the revoked role names the revoker", async () => {
    // GRANTER grants "sales" — the row now carries updated_by = GRANTER.
    await setUserRoles(GRANTER, fx.targetId, ["sales"]);
    const [granted] = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, fx.targetId), eq(userRoles.role, "sales")))
      .limit(1);
    expect(granted.updatedBy).toBe(GRANTER.id);

    // REVOKER takes it away.
    await setUserRoles(REVOKER, fx.targetId, ["viewer"]);
    expect(
      await db.select().from(userRoles).where(and(eq(userRoles.userId, fx.targetId), eq(userRoles.role, "sales"))),
    ).toHaveLength(0);

    const deletes = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "user_roles"),
          eq(auditLog.op, "DELETE"),
          jsonEq(auditLog.before, "user_id", fx.targetId),
          jsonEq(auditLog.before, "role", "sales"),
        ),
      )
      .orderBy(auditLog.id);

    expect(deletes).toHaveLength(1);
    // The whole point: "who revoked this role" must answer REVOKER. An
    // unstamped delete records OLD.updated_by, which is GRANTER — a real,
    // uninvolved admin, which is worse than no actor at all.
    expect(deletes[0].actorId).toBe(REVOKER.id);
    expect(deletes[0].actorId).not.toBe(GRANTER.id);
    expect(deletes[0].actorId).not.toBe(SUPER.id);
  });

  it("setUserAccounts: the user_accounts DELETE audit row for the revoked assignment names the revoker", async () => {
    await setUserAccounts(GRANTER, fx.targetId, [fx.accountId]);
    const [assigned] = await db
      .select()
      .from(userAccounts)
      .where(and(eq(userAccounts.userId, fx.targetId), eq(userAccounts.accountId, fx.accountId)))
      .limit(1);
    expect(assigned.updatedBy).toBe(GRANTER.id);

    await setUserAccounts(REVOKER, fx.targetId, []);
    expect(await db.select().from(userAccounts).where(eq(userAccounts.userId, fx.targetId))).toHaveLength(0);

    const deletes = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "user_accounts"),
          eq(auditLog.op, "DELETE"),
          jsonEq(auditLog.before, "user_id", fx.targetId),
          jsonEq(auditLog.before, "account_id", fx.accountId),
        ),
      )
      .orderBy(auditLog.id);

    expect(deletes).toHaveLength(1);
    expect(deletes[0].actorId).toBe(REVOKER.id);
    expect(deletes[0].actorId).not.toBe(GRANTER.id);
  });
});

describe("deleteUser — the full cascade names the DELETER", () => {
  const RUN = String(Date.now()).slice(-9);

  it("employee profile, leave request and un-assigned task all carry the deleting admin as actor", async () => {
    const deleterRow = await createUser(SUPER, {
      name: `Cascade Deleter ${RUN}`,
      email: `cascade-deleter-${RUN}@test.local`,
      password: "secret123",
      roles: ["super-admin"],
    });
    const DELETER = { id: deleterRow.id, roles: ["super-admin" as const] };

    const u = await createUser(SUPER, {
      name: `Cascade Victim ${RUN}`,
      email: `cascade-victim-${RUN}@test.local`,
      password: "secret123",
      roles: ["viewer"],
    });
    const self = { id: u.id, roles: ["viewer" as const] };

    let employeeId: number | null = null;
    let requestId: number | null = null;
    let taskId: number | null = null;
    try {
      // Self-stamped HR subtree: created_by = updated_by = the user themselves.
      const me = await getOrCreateEmployeeForUser(u.id);
      employeeId = me!.employeeId;
      const [type] = await db.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
      const applied = await applyForLeave(self, {
        leaveTypeId: type.id,
        startDate: "2026-09-07",
        endDate: "2026-09-07",
        isHalfDay: false,
        reason: "delete-cascade attribution fixture",
      });
      requestId = applied.requestId;

      // A task assigned to them, last touched by SUPER. tasks.assignee_id is
      // ON DELETE SET NULL, so the task survives as an audited UPDATE.
      const [task] = await db
        .insert(tasks)
        .values({
          title: `Cascade Task ${RUN}`,
          assigneeId: u.id,
          createdBy: SUPER.id,
          updatedBy: SUPER.id,
        })
        .returning({ id: tasks.id });
      taskId = task.id;

      await deleteUser(DELETER, u.id);

      // employee_profiles: previously attributed to the deleted user themselves.
      const profileDelete = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tableName, "employee_profiles"),
            eq(auditLog.rowId, String(employeeId)),
            eq(auditLog.op, "DELETE"),
          ),
        );
      expect(profileDelete).toHaveLength(1);
      expect(profileDelete[0].actorId).toBe(DELETER.id);
      expect(profileDelete[0].actorId).not.toBe(u.id);

      // leave_requests: a SECOND cascade level (users → employee_profiles →
      // leave_requests), so this proves the stamp reached the grandchildren.
      const requestDelete = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tableName, "leave_requests"),
            eq(auditLog.rowId, String(requestId)),
            eq(auditLog.op, "DELETE"),
          ),
        );
      expect(requestDelete).toHaveLength(1);
      expect(requestDelete[0].actorId).toBe(DELETER.id);
      expect(requestDelete[0].actorId).not.toBe(u.id);

      // tasks: the SET NULL un-assignment. Identify it by its before/after
      // images rather than by position, so the pre-stamp UPDATE can't be
      // mistaken for it.
      const unassign = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.tableName, "tasks"),
            eq(auditLog.rowId, String(taskId)),
            eq(auditLog.op, "UPDATE"),
            jsonEq(auditLog.before, "assignee_id", u.id),
            sql`${auditLog.after} ->> 'assignee_id' IS NULL`,
          ),
        );
      expect(unassign).toHaveLength(1);
      expect(unassign[0].actorId).toBe(DELETER.id);
      expect(unassign[0].actorId).not.toBe(SUPER.id);

      const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      expect(taskRow.assigneeId).toBeNull(); // orphaned, not deleted
    } finally {
      if (taskId) await db.delete(tasks).where(eq(tasks.id, taskId));
      await deleteUser(SUPER, u.id); // no-op if already gone
      await deleteUser(SUPER, DELETER.id);
      const scopes: Array<[string, number | null]> = [
        ["users", u.id],
        ["users", DELETER.id],
        ["employee_profiles", employeeId],
        ["leave_requests", requestId],
        ["tasks", taskId],
      ];
      for (const [tableName, rowId] of scopes) {
        if (rowId === null) continue;
        await db
          .delete(auditLog)
          .where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, String(rowId))));
      }
      for (const id of [u.id, DELETER.id]) {
        for (const tableName of ["user_roles", "user_accounts"]) {
          await db
            .delete(auditLog)
            .where(
              and(
                eq(auditLog.tableName, tableName),
                sql`coalesce(${auditLog.before} ->> 'user_id', ${auditLog.after} ->> 'user_id') = ${String(id)}`,
              ),
            );
        }
      }
    }
  });
});

describe("wouldOrphanSuperAdmins — pure guard logic (no DB)", () => {
  it("blocks only when the target currently holds super-admin, the new set drops it, and they're the last one", () => {
    expect(wouldOrphanSuperAdmins(true, 1, ["viewer"])).toBe(true); // the exact lockout scenario
    expect(wouldOrphanSuperAdmins(true, 2, ["viewer"])).toBe(false); // another super-admin remains
    expect(wouldOrphanSuperAdmins(false, 1, ["viewer"])).toBe(false); // target wasn't super-admin — count unaffected
    expect(wouldOrphanSuperAdmins(true, 1, ["super-admin", "delivery"])).toBe(false); // still holds it
    expect(wouldOrphanSuperAdmins(true, 0, ["viewer"])).toBe(true); // defensive: 0 is also "last or fewer"
  });
});
