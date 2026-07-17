import { describe, it, expect } from "vitest";
import { getReportData } from "./reports";
import { getPortfolioForUser } from "./portfolio";
import {
  REPORT_CATEGORIES,
  selectReport,
  type ReportMetrics,
} from "@/lib/money/report-view";

const SUPER = { id: 1, role: "super-admin" as const };
const YEAR = "FY26–27";

/**
 * Every money field both `getReportData` and `portfolio.ts` expose. Portfolio
 * reaches these numbers through a completely independent loop, so parity here is
 * what guards the DAL's metric←engine mapping: swap `tdsIn`/`tdsOut` and this
 * fails.
 *
 * The slice-sum test below cannot catch that — both sides of that identity
 * consume the same mapping, so it holds under any mis-mapping.
 */
const PARITY: readonly (keyof ReportMetrics)[] = [
  "billed", "received", "outstanding", "payable", "paidToOem",
  "outstandingToOem", "netMargin", "netGst", "tdsReceivable",
  "tdsPayable", "advanceTdsCost",
];

describe("getReportData", () => {
  it("per-account rows aggregate to the same totals as the portfolio", async () => {
    const data = await getReportData(SUPER, YEAR);
    const r = selectReport(data, REPORT_CATEGORIES);
    const p = await getPortfolioForUser(SUPER, YEAR);

    expect(r.rows.length).toBe(p.counts.accounts);
    expect(r.byOem.some((o) => o.oem === "IBM")).toBe(true);

    const expected: Record<string, number> = { ...p.totals, ...p.reserves };
    expect(Object.keys(expected).length).toBe(PARITY.length); // no field left unasserted
    for (const k of PARITY) {
      expect(Math.round(r.totals[k]), k).toBe(Math.round(expected[k]));
    }

    // Sanity: a table of zeros must not satisfy the parity loop above.
    expect(r.totals.billed).toBeGreaterThan(0);
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
