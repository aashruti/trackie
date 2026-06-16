import { describe, it, expect } from "vitest";
import { computeInvoice } from "./compute";

// Pillai "New students" — verified against the source workbook.
const pillaiNew = {
  category: "new" as const,
  semester: "none" as const,
  students: 180,
  priceToUni: 21200,
  priceToDatagami: 18500,
  gstRate: 0.18,
  tdsRate: 0.1,
  advanceAdj: 1_000_000,
};

describe("computeInvoice", () => {
  it("computes the inflow ladder exactly (matches Excel)", () => {
    const c = computeInvoice(pillaiNew);
    expect(c.taxableIn).toBe(3_816_000);
    expect(c.gstIn).toBe(686_880);
    expect(c.billing).toBe(4_502_880);
    expect(c.tdsIn).toBe(381_600);
    expect(c.afterTds).toBe(4_121_280);
  });

  it("nets the advance token PRE-tax on the OEM payable only", () => {
    const c = computeInvoice(pillaiNew);
    expect(c.taxableOut).toBe(3_330_000); // FULL: 180*18500 (used for margin)
    expect(c.oemTaxableNet).toBe(2_330_000); // 3_330_000 - 1_000_000 advance token
    expect(c.gstOut).toBe(419_400); // on the netted amount
    expect(c.tdsOut).toBe(233_000);
    expect(c.payable).toBe(2_516_400); // 2_330_000 + 419_400 - 233_000  (matches Excel)
  });

  it("computes student profit as students × price-diff, advance-INDEPENDENT", () => {
    const c = computeInvoice(pillaiNew); // category "new"
    expect(c.advanceTdsCost).toBe(0); // student invoice → no out-of-pocket TDS
    expect(c.netMargin).toBe(486_000); // 180 * (21200 - 18500)
    expect(c.gstDiff).toBe(267_480);
  });

  it("charges advance TDS to Datagami (advance × tdsRate) as a negative margin", () => {
    const advance = {
      category: "advance" as const,
      semester: "none" as const,
      students: 1,
      priceToUni: 1_000_000,
      priceToDatagami: 1_000_000,
      gstRate: 0.18,
      tdsRate: 0.1,
    };
    const c = computeInvoice(advance);
    expect(c.advanceTdsCost).toBe(100_000); // 1_000_000 * 0.10
    expect(c.netMargin).toBe(-100_000); // 0 (price-diff) − advance TDS
  });

  it("flags a genuine below-cost loss (priceToDatagami > priceToUni)", () => {
    const kaveriish = {
      ...pillaiNew,
      students: 100,
      priceToUni: 20_000,
      priceToDatagami: 21_000,
      advanceAdj: 0,
    };
    expect(computeInvoice(kaveriish).netMargin).toBe(-100_000); // 100 * (20000-21000)
  });

  it("treats received/outstanding from the payment ledger", () => {
    const c = computeInvoice({ ...pillaiNew, payments: [{ amount: 2_000_000 }] });
    expect(c.received).toBe(2_000_000);
    expect(c.outstanding).toBe(2_121_280); // afterTds - received
  });
});
