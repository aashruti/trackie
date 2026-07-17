import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, invoices } from "@/lib/db/schema";
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

  /**
   * The only test here that can catch money landing in the WRONG category
   * bucket. Parity checks the all-types total and the slice-sum adds all three
   * back — both hold under any permutation of the category labels. This one
   * pins a label to a category-specific number: `compute.ts` zeroes
   * `advanceTdsCost` on every non-advance bill by construction, so swapping
   * advance↔new fails both legs at once. Zero/nonzero only — no amounts — so a
   * reseed cannot make it brittle.
   */
  it("only advance bills carry advance TDS cost", async () => {
    const data = await getReportData(SUPER, YEAR);
    expect(selectReport(data, ["old"]).totals.advanceTdsCost).toBe(0);
    expect(selectReport(data, ["new"]).totals.advanceTdsCost).toBe(0);
    // Sanity: needs an OEM advance in the seed — self-supplied advances cost 0.
    expect(selectReport(data, ["advance"]).totals.advanceTdsCost).toBeGreaterThan(0);
  });

  it("each bill type's students match the invoices actually in that category", async () => {
    const data = await getReportData(SUPER, YEAR);

    // Expectation comes straight from the invoices table — NOT from the DAL under
    // test. The parity and slice-sum tests are both invariant under a category
    // permutation (both sides read the same buckets), so only an independent
    // source can catch old↔new money landing in the wrong bucket.
    const [year] = await db
      .select()
      .from(academicYears)
      .where(eq(academicYears.label, YEAR))
      .limit(1);
    const invs = await db
      .select({ cat: invoices.category, students: invoices.students })
      .from(invoices)
      .where(eq(invoices.yearId, year.id));

    for (const c of ["old", "new"] as const) {
      const expected = invs
        .filter((i) => i.cat === c)
        .reduce((s, i) => s + i.students, 0);
      expect(selectReport(data, [c]).totals.students).toBe(expected);
    }
  });
});
