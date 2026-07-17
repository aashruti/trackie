import { describe, it, expect } from "vitest";
import {
  REPORT_CATEGORIES,
  categorySlug,
  emptyByCategory,
  emptyMetrics,
  parseCategories,
  selectReport,
  toggleCategory,
  type ReportMetrics,
  type ReportRow,
} from "./report-view";

const metrics = (p: Partial<ReportMetrics>): ReportMetrics => ({ ...emptyMetrics(), ...p });

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: 1,
  name: "Pillai",
  oem: "IBM",
  byCategory: emptyByCategory(),
  bills: [],
  ...over,
});

describe("selectReport", () => {
  it("sums only the selected bill types", () => {
    const r = row({
      byCategory: {
        advance: metrics({ billed: 100, netMargin: -10 }),
        old: metrics({ billed: 200, netMargin: 20, students: 5 }),
        new: metrics({ billed: 400, netMargin: 40, students: 9 }),
      },
    });
    const v = selectReport({ rows: [r] }, ["advance", "new"]);
    expect(v.totals.billed).toBe(500);
    expect(v.totals.netMargin).toBe(30);
    expect(v.totals.students).toBe(9); // `old` excluded
  });

  it("the three slices sum back to the unfiltered total", () => {
    const data = {
      rows: [
        row({
          byCategory: {
            advance: metrics({ billed: 100, netMargin: -10 }),
            old: metrics({ billed: 200, netMargin: 20 }),
            new: metrics({ billed: 400, netMargin: 40 }),
          },
        }),
      ],
    };
    const all = selectReport(data, [...REPORT_CATEGORIES]);
    const sum = REPORT_CATEGORIES.reduce(
      (a, c) => a + selectReport(data, [c]).totals.netMargin,
      0,
    );
    expect(sum).toBe(all.totals.netMargin);
  });

  it("re-derives account status from the filtered bills only", () => {
    const r = row({
      bills: [
        { category: "new", status: "paid", outstanding: 0, received: 500 },
        { category: "advance", status: "overdue", outstanding: 100, received: 0 },
      ],
    });
    expect(selectReport({ rows: [r] }, [...REPORT_CATEGORIES]).rows[0].status).toBe("overdue");
    expect(selectReport({ rows: [r] }, ["new"]).rows[0].status).toBe("paid");
  });

  it("marks an account with no bills of the selected type as draft", () => {
    const r = row({ bills: [{ category: "new", status: "paid", outstanding: 0, received: 5 }] });
    expect(selectReport({ rows: [r] }, ["advance"]).rows[0].status).toBe("draft");
  });

  it("buckets aging from the filtered bills only", () => {
    const r = row({
      bills: [
        { category: "advance", status: "overdue", outstanding: 900, received: 0 },
        { category: "new", status: "partially-paid", outstanding: 500, received: 10 },
        { category: "old", status: "raised", outstanding: 300, received: 0 },
      ],
    });
    expect(selectReport({ rows: [r] }, [...REPORT_CATEGORIES]).aging).toEqual({
      current: 300,
      d31_60: 500,
      d61_90: 0,
      d90plus: 900,
    });
    expect(selectReport({ rows: [r] }, ["new"]).aging).toEqual({
      current: 0,
      d31_60: 500,
      d61_90: 0,
      d90plus: 0,
    });
  });

  it("ignores bills outstanding by ≤ ₹1 when aging", () => {
    const r = row({ bills: [{ category: "new", status: "raised", outstanding: 1, received: 0 }] });
    expect(selectReport({ rows: [r] }, ["new"]).aging.current).toBe(0);
  });

  it("regroups by OEM on the filtered numbers, sorted by net margin desc", () => {
    const a = row({
      id: 1,
      name: "A",
      oem: "IBM",
      byCategory: { ...emptyByCategory(), new: metrics({ billed: 10, netMargin: 5 }) },
    });
    const b = row({
      id: 2,
      name: "B",
      oem: "AAFM",
      byCategory: { ...emptyByCategory(), new: metrics({ billed: 20, netMargin: 50 }) },
    });
    const v = selectReport({ rows: [a, b] }, ["new"]);
    expect(v.byOem.map((o) => o.oem)).toEqual(["AAFM", "IBM"]);
    expect(v.byOem[0].netMargin).toBe(50);
  });

  it("sorts rows by filtered billed, so order responds to the filter", () => {
    const a = row({
      id: 1,
      name: "A",
      byCategory: { advance: metrics({ billed: 900 }), old: emptyMetrics(), new: metrics({ billed: 1 }) },
    });
    const b = row({
      id: 2,
      name: "B",
      byCategory: { advance: metrics({ billed: 1 }), old: emptyMetrics(), new: metrics({ billed: 900 }) },
    });
    expect(selectReport({ rows: [a, b] }, ["advance"]).rows.map((r) => r.name)).toEqual(["A", "B"]);
    expect(selectReport({ rows: [a, b] }, ["new"]).rows.map((r) => r.name)).toEqual(["B", "A"]);
  });
});

describe("toggleCategory", () => {
  it("adds and removes, keeping canonical order", () => {
    expect(toggleCategory(["advance"], "new")).toEqual(["advance", "new"]);
    expect(toggleCategory(["advance", "old", "new"], "old")).toEqual(["advance", "new"]);
  });

  it("refuses to unselect the last remaining type", () => {
    expect(toggleCategory(["new"], "new")).toEqual(["new"]);
  });
});

describe("parseCategories", () => {
  it("defaults to all types", () => {
    expect(parseCategories(null)).toEqual(["advance", "old", "new"]);
    expect(parseCategories("")).toEqual(["advance", "old", "new"]);
  });

  it("drops unknown values and dedupes, keeping canonical order", () => {
    expect(parseCategories("new,bogus,advance,new")).toEqual(["advance", "new"]);
  });

  it("falls back to all when nothing valid remains", () => {
    expect(parseCategories("bogus")).toEqual(["advance", "old", "new"]);
  });
});

describe("categorySlug", () => {
  it("collapses a full selection to 'all'", () => {
    expect(categorySlug(["advance", "old", "new"])).toBe("all");
  });

  it("joins a partial selection in canonical order", () => {
    expect(categorySlug(["new", "advance"])).toBe("advance+new");
  });
});
