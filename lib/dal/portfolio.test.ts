import { describe, it, expect } from "vitest";
import { getPortfolioForUser } from "./portfolio";

// Integration — requires `npm run db:seed`.
describe("getPortfolioForUser (super-admin, FY26–27)", () => {
  it("aggregates all accounts with rollups + reserves (Excel reconciliation ≥ ₹3.77 Cr)", async () => {
    const p = await getPortfolioForUser({ id: 1, roles: ["super-admin"] }, "FY26–27");
    expect(p.counts.accounts).toBeGreaterThanOrEqual(21);
    // The 21 Excel accounts reconcile to ₹3,77,18,375; demo accounts only add to it.
    expect(Math.round(p.totals.netMargin)).toBeGreaterThanOrEqual(37_718_375);
    expect(p.totals.billed).toBeGreaterThan(0);
    expect(p.reserves.netGst).toBeGreaterThan(0);
    expect(p.marginByOem.some((m) => m.oem === "AAFM")).toBe(true);
    expect(p.rows.length).toBe(p.counts.accounts);
  });
});
