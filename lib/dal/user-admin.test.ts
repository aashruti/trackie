import { describe, it, expect, afterAll } from "vitest";
import { createUser, listUsers, setUserAccounts, deleteUser } from "./user-admin";
import { listAccountsForUser } from "./accounts";

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

  afterAll(async () => {
    if (userId) await deleteUser(SUPER, userId);
  });
});
