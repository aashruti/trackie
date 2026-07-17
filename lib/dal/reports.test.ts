import { describe, it, expect } from "vitest";
import { getReportData } from "./reports";
import { getPortfolioForUser } from "./portfolio";
import { REPORT_CATEGORIES, selectReport } from "@/lib/money/report-view";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

describe("getReportData", () => {
  it("per-account rows aggregate to the same totals as the portfolio", async () => {
    const data = await getReportData(SUPER, YEAR);
    const r = selectReport(data, REPORT_CATEGORIES);
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

  it("the three bill-type slices sum back to the unfiltered totals", async () => {
    const data = await getReportData(SUPER, YEAR);
    const all = selectReport(data, REPORT_CATEGORIES);
    const slices = REPORT_CATEGORIES.map((c) => selectReport(data, [c]));

    for (const k of ["billed", "netMargin", "outstanding", "netGst"] as const) {
      const summed = slices.reduce((a, s) => a + s.totals[k], 0);
      expect(Math.round(summed)).toBe(Math.round(all.totals[k]));
    }
  });

  it("advances carry no student count", async () => {
    const data = await getReportData(SUPER, YEAR);
    expect(selectReport(data, ["advance"]).totals.students).toBe(0);
    // Sanity: the seeded year does have students on non-advance bills.
    expect(selectReport(data, REPORT_CATEGORIES).totals.students).toBeGreaterThan(0);
  });
});
