import { describe, expect, it } from "vitest";
import { computePoTotals, parseMoneyInput } from "./po-status";

const t = (poValue: number | null, received = 0, tds = 0, gstRate = 18) =>
  computePoTotals({ poValue, gstRate, received, tds });

describe("computePoTotals", () => {
  it("works out amount due from PO value and GST", () => {
    expect(t(431340).due).toBe(508981.2);
    expect(t(431340, 0, 0, 0).due).toBe(431340);
  });
  it("reports each status at its boundary", () => {
    expect(t(null).status).toBe("no_value");
    expect(t(null, 5000).status).toBe("value_missing");
    expect(t(100000).status).toBe("not_received");
    expect(t(100000, 117998.99).status).toBe("part_received");
    expect(t(100000, 117999).status).toBe("fully_received");
    expect(t(100000, 118001).status).toBe("fully_received");
    expect(t(100000, 118001.01).status).toBe("over_received");
  });
  it("counts TDS towards the settled amount", () => {
    const r = t(100000, 108000, 10000);
    expect(r.settled).toBe(118000);
    expect(r.status).toBe("fully_received");
  });
  it("never reports negative or rounding-only outstanding", () => {
    expect(t(100000, 50000).outstanding).toBe(68000);
    expect(t(100000, 118500).outstanding).toBe(0);
    expect(t(100000, 117999.5).outstanding).toBe(0);
    expect(t(null, 5000).outstanding).toBe(0);
  });
  it("rounds to paise so floats don't change the status", () => {
    expect(t(0.1 + 0.2, 0, 0, 0).due).toBe(0.3);
  });
});

describe("parseMoneyInput", () => {
  it("parses money the way people type it", () => {
    expect(parseMoneyInput("4,31,340")).toBe(431340);
    expect(parseMoneyInput("₹ 1,000.50")).toBe(1000.5);
    expect(parseMoneyInput("  ")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNaN();
  });
});
