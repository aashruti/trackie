import { describe, it, expect } from "vitest";
import { getReportData } from "./reports";
import { getPortfolioForUser } from "./portfolio";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

describe("getReportData", () => {
  it("per-account rows aggregate to the same totals as the portfolio", async () => {
    const r = await getReportData(SUPER, YEAR);
    const p = await getPortfolioForUser(SUPER, YEAR);

    expect(r.rows.length).toBe(p.counts.accounts);
    expect(Math.round(r.totals.netMargin)).toBe(Math.round(p.totals.netMargin));
    expect(Math.round(r.totals.billed)).toBe(Math.round(p.totals.billed));
    expect(Math.round(r.totals.outstanding)).toBe(Math.round(p.totals.outstanding));
    expect(r.byOem.some((o) => o.oem === "IBM")).toBe(true);
    // Reserves present.
    expect(r.totals.netGst).toBeGreaterThan(0);
    expect(r.totals.tdsReceivable).toBeGreaterThan(0);
  });
});
