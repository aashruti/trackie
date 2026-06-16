import { describe, it, expect } from "vitest";
import { getPortfolioForUser } from "./portfolio";

// Integration — requires `npm run db:seed`.
describe("getPortfolioForUser (super-admin, FY26–27)", () => {
  it("aggregates all 21 accounts and matches the reconciled grand margin", async () => {
    const p = await getPortfolioForUser({ id: 1, role: "super-admin" }, "FY26–27");
    expect(p.counts.accounts).toBe(21);
    // Grand-total clean margin established in the reconciliation: ₹3,77,18,375.
    expect(Math.round(p.totals.netMargin)).toBe(37_718_375);
    expect(p.totals.billed).toBeGreaterThan(0);
    expect(p.reserves.netGst).toBeGreaterThan(0);
    expect(p.marginByOem.some((m) => m.oem === "AAFM")).toBe(true);
    expect(p.rows.length).toBe(21);
  });
});
