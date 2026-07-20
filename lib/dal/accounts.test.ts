import { describe, it, expect } from "vitest";
import { listAccountsForUser } from "./accounts";

// Integration test — requires `npm run db:seed` to have run against the local DB.
describe("listAccountsForUser", () => {
  it("super-admin sees all accounts with computed rollups", async () => {
    const rows = await listAccountsForUser({ id: 1, roles: ["super-admin"] }, "FY26–27");
    expect(rows.length).toBeGreaterThanOrEqual(21); // 21 from Excel (+ any demo accounts)
    expect(rows.some((r) => r.name.includes("Pillai"))).toBe(true);
    const sample = rows[0];
    expect(sample).toHaveProperty("billing");
    expect(sample).toHaveProperty("netMargin");
    expect(sample).toHaveProperty("status");
  });

  it("sales with no assignments sees no accounts", async () => {
    const rows = await listAccountsForUser({ id: 2, roles: ["sales"] }, "FY26–27", []);
    expect(rows.length).toBe(0);
  });

  it("sales sees only its assigned accounts", async () => {
    const all = await listAccountsForUser({ id: 1, roles: ["super-admin"] }, "FY26–27");
    const pick = all.slice(0, 2).map((a) => a.id);
    const rows = await listAccountsForUser({ id: 2, roles: ["sales"] }, "FY26–27", pick);
    expect(rows.map((r) => r.id).sort()).toEqual([...pick].sort());
  });
});
