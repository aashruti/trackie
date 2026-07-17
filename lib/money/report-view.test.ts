import { describe, it, expect } from "vitest";
import {
  DEFAULT_SORT,
  REPORT_CATEGORIES,
  categoryLabels,
  categorySlug,
  emptyByCategory,
  emptyMetrics,
  parseCategories,
  parseSort,
  selectReport,
  sortRows,
  toggleCategory,
  type ReportMetrics,
  type ReportRow,
  type ViewRow,
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

  it("breaks billed ties on id, so row order ignores input order", () => {
    const tied = (id: number, name: string) =>
      row({ id, name, byCategory: { ...emptyByCategory(), new: metrics({ billed: 100 }) } });
    const a = tied(1, "A");
    const b = tied(2, "B");
    // The accounts query has no ORDER BY, so input order is not guaranteed —
    // both feed orders must land on the same output order.
    expect(selectReport({ rows: [a, b] }, ["new"]).rows.map((r) => r.id)).toEqual([1, 2]);
    expect(selectReport({ rows: [b, a] }, ["new"]).rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("breaks OEM net-margin ties on name, so byOem order ignores input order", () => {
    const tied = (id: number, oem: string) =>
      row({ id, oem, byCategory: { ...emptyByCategory(), new: metrics({ netMargin: 10 }) } });
    const a = tied(1, "IBM");
    const b = tied(2, "AAFM");
    expect(selectReport({ rows: [a, b] }, ["new"]).byOem.map((o) => o.oem)).toEqual(["AAFM", "IBM"]);
    expect(selectReport({ rows: [b, a] }, ["new"]).byOem.map((o) => o.oem)).toEqual(["AAFM", "IBM"]);
  });

  it("breaks OEM ties on names a collator calls equal", () => {
    // ICU treats U+200B as ignorable, so `"IBM".localeCompare("IBM​")` is 0
    // even though the names differ — and a 0 lets `sort` fall back to the
    // unordered DB row order. Code-unit order separates them in both runtimes.
    const plain = "IBM";
    const zwsp = "IBM​";
    const tied = (id: number, oem: string) =>
      row({ id, oem, byCategory: { ...emptyByCategory(), new: metrics({ netMargin: 10 }) } });
    const a = tied(1, plain);
    const b = tied(2, zwsp);
    expect(selectReport({ rows: [a, b] }, ["new"]).byOem.map((o) => o.oem)).toEqual([plain, zwsp]);
    expect(selectReport({ rows: [b, a] }, ["new"]).byOem.map((o) => o.oem)).toEqual([plain, zwsp]);
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

  it("holds the last-one guard even when the input repeats a type", () => {
    expect(toggleCategory(["new", "new"], "new")).toEqual(["new"]);
  });
});

describe("categoryLabels", () => {
  it("labels a selection in canonical order", () => {
    expect(categoryLabels(["new", "advance"])).toBe("Advance bill, New students");
  });

  it("returns an empty string for an empty selection", () => {
    expect(categoryLabels([])).toBe("");
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

const vrow = (over: Partial<ViewRow> = {}): ViewRow => ({
  id: 1, name: "A", oem: "IBM", status: "raised",
  ...emptyMetrics(),
  ...over,
});

describe("sortRows", () => {
  it("sorts numbers descending then ascending", () => {
    const rows = [vrow({ id: 1, billed: 10 }), vrow({ id: 2, billed: 30 }), vrow({ id: 3, billed: 20 })];
    expect(sortRows(rows, { key: "billed", dir: "desc" }).map((r) => r.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, { key: "billed", dir: "asc" }).map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("sorts names alphabetically, not by code unit", () => {
    // Code-unit order would put "UOW" (U=85) before "amity" (a=97) — wrong for a
    // user-facing A–Z sort. A pinned collator gets this right.
    const rows = [vrow({ id: 1, name: "UOW" }), vrow({ id: 2, name: "amity" })];
    expect(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual(["amity", "UOW"]);
  });

  it("does not mutate its input", () => {
    const rows = [vrow({ id: 1, billed: 10 }), vrow({ id: 2, billed: 30 })];
    sortRows(rows, { key: "billed", dir: "desc" });
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("breaks ties on id under every key, so order ignores input order", () => {
    const a = vrow({ id: 1, name: "Same", billed: 5 });
    const b = vrow({ id: 2, name: "Same", billed: 5 });
    for (const key of ["billed", "name"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        expect(sortRows([a, b], { key, dir }).map((r) => r.id)).toEqual([1, 2]);
        expect(sortRows([b, a], { key, dir }).map((r) => r.id)).toEqual([1, 2]);
      }
    }
  });

  it("sorts by status (a string field)", () => {
    const rows = [vrow({ id: 1, status: "raised" }), vrow({ id: 2, status: "overdue" })];
    expect(sortRows(rows, { key: "status", dir: "asc" }).map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("parseSort", () => {
  it("defaults when key is absent or unknown", () => {
    expect(parseSort(null, null)).toEqual(DEFAULT_SORT);
    expect(parseSort("bogus", "asc")).toEqual(DEFAULT_SORT);
  });

  it("accepts a known key and direction", () => {
    expect(parseSort("name", "asc")).toEqual({ key: "name", dir: "asc" });
    expect(parseSort("netMargin", "desc")).toEqual({ key: "netMargin", dir: "desc" });
  });

  it("falls back to the default direction when dir is garbage", () => {
    expect(parseSort("name", "sideways")).toEqual({ key: "name", dir: DEFAULT_SORT.dir });
  });
});

describe("selectReport sort argument", () => {
  it("defaults to billed desc — today's order, unchanged", () => {
    const r1 = row({ id: 1, byCategory: { ...emptyByCategory(), new: metrics({ billed: 10 }) } });
    const r2 = row({ id: 2, byCategory: { ...emptyByCategory(), new: metrics({ billed: 30 }) } });
    const data = { rows: [r1, r2] };
    expect(selectReport(data, ["new"]).rows.map((r) => r.id)).toEqual([2, 1]);
    expect(selectReport(data, ["new"], DEFAULT_SORT).rows.map((r) => r.id)).toEqual([2, 1]);
  });

  it("honours an explicit sort", () => {
    const r1 = row({ id: 1, name: "Zeta", byCategory: { ...emptyByCategory(), new: metrics({ billed: 30 }) } });
    const r2 = row({ id: 2, name: "Alpha", byCategory: { ...emptyByCategory(), new: metrics({ billed: 10 }) } });
    const v = selectReport({ rows: [r1, r2] }, ["new"], { key: "name", dir: "asc" });
    expect(v.rows.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});
