import { describe, it, expect } from "vitest";
import { listAccountsForUser } from "./accounts";

// Integration test — requires `npm run db:seed` to have run against the local DB.
describe("listAccountsForUser", () => {
  it("super-admin sees all 21 accounts with computed rollups", async () => {
    const rows = await listAccountsForUser({ id: 1, role: "super-admin" }, "FY26–27");
    expect(rows.length).toBe(21);
    const sample = rows[0];
    expect(sample).toHaveProperty("billing");
    expect(sample).toHaveProperty("netMargin");
    expect(sample).toHaveProperty("status");
  });

  it("admin with no assignments sees no accounts", async () => {
    const rows = await listAccountsForUser({ id: 2, role: "admin" }, "FY26–27", []);
    expect(rows.length).toBe(0);
  });

  it("admin sees only its assigned accounts", async () => {
    const all = await listAccountsForUser({ id: 1, role: "super-admin" }, "FY26–27");
    const pick = all.slice(0, 2).map((a) => a.id);
    const rows = await listAccountsForUser({ id: 2, role: "admin" }, "FY26–27", pick);
    expect(rows.map((r) => r.id).sort()).toEqual([...pick].sort());
  });
});
