import { describe, it, expect, afterAll, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, authSessions } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import {
  createUser,
  listUsers,
  setUserAccounts,
  deleteUser,
  resetUserPassword,
  signOutUserEverywhere,
} from "./user-admin";
import { listAccountsForUser } from "./accounts";
import { createSession, sessionExists } from "./sessions";

const SUPER = { id: 1, role: "super-admin" as const };

describe("user-admin", () => {
  let userId: number | null = null;

  it("super-admin creates a user and assigns accounts", async () => {
    const all = await listAccountsForUser(SUPER, "FY26–27");
    const pick = all.slice(0, 2).map((a) => a.id);

    const u = await createUser(SUPER, {
      name: "Test Manager",
      email: "test-manager@datagami.local",
      password: "secret123",
      role: "admin",
    });
    userId = u.id;

    await setUserAccounts(SUPER, u.id, pick);

    const users = await listUsers(SUPER);
    const created = users.find((x) => x.id === u.id)!;
    expect(created.role).toBe("admin");
    expect(created.assignedAccountIds.sort()).toEqual([...pick].sort());

    // The new admin now sees exactly those accounts.
    const scoped = await listAccountsForUser({ id: u.id, role: "admin" }, "FY26–27");
    expect(scoped.map((a) => a.id).sort()).toEqual([...pick].sort());
  });

  it("rejects a non-super-admin", async () => {
    await expect(
      listUsers({ id: 2, role: "admin" }),
    ).rejects.toThrow();
    await expect(
      createUser({ id: 2, role: "admin" }, { name: "x", email: "x@y.z", password: "secret123", role: "viewer" }),
    ).rejects.toThrow();
  });

  it("resets another user's password so the new one works and the old one stops", async () => {
    const u = await createUser(SUPER, {
      name: "Reset Target",
      email: "reset-target@datagami.local",
      password: "oldpassword1",
      role: "viewer",
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
    for (const role of ["admin", "hr", "delivery", "viewer"] as const) {
      await expect(
        resetUserPassword({ id: 2, role }, 3, "brandnewpass1"),
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
      createUser(SUPER, { name: "x", email: "too-short@datagami.local", password: "short12", role: "viewer" }),
    ).rejects.toThrow(/8 characters/i);
  });

  it("sign out everywhere ends sessions without touching the password", async () => {
    const u = await createUser(SUPER, {
      name: "Kick Target",
      email: "kick-target@datagami.local",
      password: "keepthispass1",
      role: "viewer",
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
    for (const role of ["admin", "hr", "delivery", "viewer"] as const) {
      await expect(signOutUserEverywhere({ id: 2, role }, 3)).rejects.toThrow(/Super Admin/i);
    }
  });

  it("a password reset ends the target's sessions", async () => {
    const u = await createUser(SUPER, {
      name: "Revoke Target",
      email: "revoke-target@datagami.local",
      password: "oldpassword1",
      role: "viewer",
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
      role: "viewer",
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
