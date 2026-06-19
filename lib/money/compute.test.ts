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
  it("bills the university NET of the advance prepaid (no double-count)", () => {
    const c = computeInvoice(pillaiNew); // advanceAdj 1,000,000
    expect(c.taxableIn).toBe(3_816_000); // full — margin basis, unchanged
    expect(c.billedTaxableIn).toBe(2_816_000); // 3_816_000 − 1_000_000 advance prepaid
    expect(c.gstIn).toBe(506_880);
    expect(c.billing).toBe(3_322_880);
    expect(c.tdsIn).toBe(281_600);
    expect(c.afterTds).toBe(3_041_280);
  });

  it("bills full when there is no advance", () => {
    const c = computeInvoice({ ...pillaiNew, advanceAdj: 0 });
    expect(c.billedTaxableIn).toBe(3_816_000);
    expect(c.billing).toBe(4_502_880);
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
    expect(c.netMargin).toBe(486_000); // 180 * (21200 - 18500) — advance-independent
    expect(c.gstDiff).toBe(87_480); // net GST = 18% of margin (gstIn 506,880 − gstOut 419,400)
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

  it("self-supplied (Datagami's own product): no OEM transfer, margin = revenue", () => {
    const ownProduct = {
      category: "new" as const,
      semester: "none" as const,
      students: 100,
      priceToUni: 30000,
      priceToDatagami: 0, // no internal cost
      gstRate: 0.18,
      tdsRate: 0.1,
      selfSupplied: true,
    };
    const c = computeInvoice(ownProduct);
    expect(c.payable).toBe(0); // no transfer to any OEM
    expect(c.gstOut).toBe(0);
    expect(c.tdsOut).toBe(0);
    expect(c.taxableIn).toBe(3_000_000);
    expect(c.netMargin).toBe(3_000_000); // full revenue is profit
    expect(c.gstDiff).toBe(540_000); // full GST remitted (no input credit)
  });

  it("own-product advance is a 0-margin prepayment (no OEM, no TDS fronted)", () => {
    const c = computeInvoice({
      category: "advance",
      semester: "none",
      students: 1,
      priceToUni: 500_000,
      priceToDatagami: 0,
      gstRate: 0.18,
      tdsRate: 0.1,
      selfSupplied: true,
    });
    expect(c.payable).toBe(0); // nothing transferred out
    expect(c.advanceTdsCost).toBe(0); // no OEM transfer → no fronted TDS
    expect(c.netMargin).toBe(0); // pure prepayment, not profit
  });

  it("OEM advance margin is just the fronted TDS (unchanged)", () => {
    const c = computeInvoice({
      category: "advance",
      semester: "none",
      students: 1,
      priceToUni: 1_000_000,
      priceToDatagami: 1_000_000,
      gstRate: 0.18,
      tdsRate: 0.1,
    });
    expect(c.netMargin).toBe(-100_000);
  });

  it("self-supplied with an internal cost subtracts it from margin only", () => {
    const c = computeInvoice({
      category: "new",
      semester: "none",
      students: 100,
      priceToUni: 30000,
      priceToDatagami: 12000, // internal cost
      gstRate: 0.18,
      tdsRate: 0.1,
      selfSupplied: true,
    });
    expect(c.payable).toBe(0);
    expect(c.netMargin).toBe(100 * (30000 - 12000)); // 1_800_000
  });

  it("prices old students per cohort (locked at enrollment), blended margin", () => {
    // Year-3 old students: Y1 batch (21000 uni / 18000 oem) + Y2 batch (23000 / 20000).
    const c = computeInvoice({
      category: "old",
      semester: "none",
      students: 150, // 100 + 50
      priceToUni: 25000, // invoice default (fallback) — not used since cohorts priced
      priceToDatagami: 22000,
      gstRate: 0.18,
      tdsRate: 0.1,
      cohortPricing: [
        { count: 100, priceToUni: 21000, priceToDatagami: 18000 }, // Y1 batch
        { count: 50, priceToUni: 23000, priceToDatagami: 20000 }, // Y2 batch
      ],
    });
    expect(c.taxableIn).toBe(100 * 21000 + 50 * 23000); // 3,250,000
    expect(c.taxableOut).toBe(100 * 18000 + 50 * 20000); // 2,800,000
    expect(c.netMargin).toBe(3_250_000 - 2_800_000); // 450,000 blended
  });

  it("falls back to the invoice price for cohorts without a price", () => {
    const c = computeInvoice({
      category: "old",
      semester: "none",
      students: 90,
      priceToUni: 14830.5,
      priceToDatagami: 10500,
      gstRate: 0.18,
      tdsRate: 0.1,
      cohortPricing: [{ count: 60, priceToUni: null, priceToDatagami: null }, { count: 30 }],
    });
    // No cohort prices → all 90 at the invoice price (current behaviour).
    expect(c.taxableIn).toBe(90 * 14830.5);
    expect(c.netMargin).toBe(90 * (14830.5 - 10500));
  });

  it("treats received/outstanding from the payment ledger", () => {
    const c = computeInvoice({ ...pillaiNew, payments: [{ amount: 2_000_000 }] });
    expect(c.received).toBe(2_000_000);
    expect(c.outstanding).toBe(1_041_280); // afterTds (3,041,280) - received
  });

  it("tracks OEM payments paid vs payable", () => {
    const c = computeInvoice({
      ...pillaiNew,
      oemPayments: [{ amount: 1_000_000 }, { amount: 500_000 }],
    });
    expect(c.payable).toBe(2_516_400);
    expect(c.paidToOem).toBe(1_500_000);
    expect(c.outstandingToOem).toBe(1_016_400); // payable − paid
  });
});

import { computeAccount, accountStatus } from "./compute";

describe("computeAccount", () => {
  const invoices = [
    {
      category: "advance" as const,
      semester: "none" as const,
      students: 1,
      priceToUni: 1_000_000,
      priceToDatagami: 1_000_000,
      gstRate: 0.18,
      tdsRate: 0.1,
      status: "paid" as const,
      payments: [{ amount: 1_080_000 }],
    },
    {
      category: "new" as const,
      semester: "none" as const,
      students: 180,
      priceToUni: 21200,
      priceToDatagami: 18500,
      gstRate: 0.18,
      tdsRate: 0.1,
      advanceAdj: 1_000_000,
      status: "overdue" as const,
      payments: [],
    },
  ];

  it("sums rollups; advance TDS reduces profit but does not trip hasNegative", () => {
    const a = computeAccount(invoices);
    // advance billed full (1,180,000) + new billed NET of advance (3,322,880).
    expect(a.billing).toBe(1_180_000 + 3_322_880);
    expect(a.netMargin).toBe(-100_000 + 486_000); // advance −100k TDS + new 486k = 386k
    expect(a.hasNegative).toBe(false); // advance's structural negative is excluded
    expect(a.status).toBe("overdue"); // any overdue invoice → overdue
  });

  it("hasNegative is true for a genuine below-cost student invoice", () => {
    const a = computeAccount([
      {
        category: "old",
        semester: "none",
        students: 100,
        priceToUni: 20_000,
        priceToDatagami: 21_000,
        gstRate: 0.18,
        tdsRate: 0.1,
        status: "raised",
        payments: [],
      },
    ]);
    expect(a.hasNegative).toBe(true);
  });
});

describe("computeAccount reserves", () => {
  it("surfaces GST/TDS set-aside figures separate from profit", () => {
    const a = computeAccount([
      { category: "new", semester: "none", students: 180, priceToUni: 21200, priceToDatagami: 18500, gstRate: 0.18, tdsRate: 0.1, advanceAdj: 1_000_000, status: "raised", payments: [] },
      { category: "advance", semester: "none", students: 1, priceToUni: 1_000_000, priceToDatagami: 1_000_000, gstRate: 0.18, tdsRate: 0.1, status: "raised", payments: [] },
    ]);
    // Net GST = 18% of value-add: new gstDiff (506,880 − 419,400 = 87,480) + advance 0.
    expect(a.netGst).toBe(87_480);
    expect(a.advanceTdsCost).toBe(100_000); // advance × tds
    // TDS withheld by uni on the BILLED (net) amounts: new 281,600 + advance 100,000.
    expect(a.tdsReceivable).toBe(381_600);
    expect(a.tdsPayable).toBeGreaterThan(0);
  });
});

describe("accountStatus", () => {
  it("paid when outstanding <= 1 and no overdue", () => {
    expect(accountStatus([{ status: "paid", outstanding: 0 }])).toBe("paid");
  });
  it("partially-paid when some received but outstanding remains", () => {
    expect(
      accountStatus([{ status: "raised", outstanding: 500, received: 100 }]),
    ).toBe("partially-paid");
  });
  it("draft when every invoice is draft (freshly rolled-over year)", () => {
    expect(
      accountStatus([
        { status: "draft", outstanding: 500 },
        { status: "draft", outstanding: 200 },
      ]),
    ).toBe("draft");
  });
});
