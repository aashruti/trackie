import { describe, it, expect } from "vitest";
import { parseSheet } from "./excel-parse";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";

describe("parseSheet Pillai (yearly, advance + new only)", () => {
  const r = parseSheet(XLSX_PATH, "Pillai Uni");

  it("extracts account meta", () => {
    expect(r.account.name).toMatch(/Pillai/);
    expect(r.account.oem).toBe("IBM");
    expect(r.account.type).toBe("university");
  });

  it("finds an advance invoice and a new-student invoice", () => {
    const cats = r.invoices.map((i) => i.category).sort();
    expect(cats).toEqual(["advance", "new"]);
  });

  it("new invoice carries the right students + prices + advanceAdj", () => {
    const nw = r.invoices.find((i) => i.category === "new")!;
    expect(nw.students).toBe(180);
    expect(nw.priceToUni).toBe(21200);
    expect(nw.priceToDatagami).toBe(18500);
    expect(nw.advanceAdj).toBe(1_000_000);
    expect(nw.semester).toBe("none");
  });

  it("advance invoice is a 1000000 token", () => {
    const adv = r.invoices.find((i) => i.category === "advance")!;
    expect(adv.priceToUni).toBe(1_000_000);
    expect(adv.priceToDatagami).toBe(1_000_000);
    expect(adv.students).toBe(1);
  });
});

describe("parseSheet Kalinga (semester split + cohorts)", () => {
  const r = parseSheet(XLSX_PATH, "Kalinga");

  it("splits old + new into per-semester invoices", () => {
    const key = r.invoices.map((i) => `${i.category}:${i.semester}`).sort();
    expect(key).toContain("old:1");
    expect(key).toContain("old:2");
    expect(key).toContain("new:1");
    expect(key).toContain("new:2");
  });

  it("captures old-student cohort breakdown that sums to the invoice total", () => {
    const old1 = r.invoices.find((i) => i.category === "old" && i.semester === "1")!;
    expect(old1.cohorts.length).toBeGreaterThan(1);
    expect(old1.cohorts.reduce((a, c) => a + c.count, 0)).toBe(old1.students);
  });

  it("attaches the advance to the column whose OEM transfer was reduced", () => {
    const withAdj = r.invoices.filter((i) => i.advanceAdj > 0);
    expect(withAdj.length).toBe(1);
    expect(withAdj[0].advanceAdj).toBe(1_000_000);
  });
});

describe("parseSheet DG Prog (programme, AAFM)", () => {
  const r = parseSheet(XLSX_PATH, "DG Prog");
  it("detects the programme type and AAFM OEM", () => {
    expect(r.account.oem).toBe("AAFM");
    expect(r.account.type).toBe("programme");
  });
});
