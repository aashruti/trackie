import { describe, it, expect } from "vitest";
import { fmt, fmtExact, statusMeta } from "./format";

describe("fmt", () => {
  it("formats with en-IN grouping and ₹", () => {
    expect(fmt(4121280)).toBe("₹41,21,280");
  });
  it("uses a real minus sign for negatives", () => {
    expect(fmt(-75600)).toBe("−₹75,600");
  });
  it("renders em-dash for null/NaN", () => {
    expect(fmt(null)).toBe("—");
  });
  it("never abbreviates large figures", () => {
    expect(fmt(127168487.15)).toBe("₹12,71,68,487");
  });
});

describe("fmtExact", () => {
  it("keeps every rupee", () => {
    expect(fmtExact(159876)).toBe("₹1,59,876");
    expect(fmtExact(127168487.15)).toBe("₹12,71,68,487.15");
  });
  it("shows paise only when non-zero", () => {
    expect(fmtExact(1234.5)).toBe("₹1,234.50");
    expect(fmtExact(1234)).toBe("₹1,234");
  });
  it("uses a real minus sign for negatives", () => {
    expect(fmtExact(-75600)).toBe("−₹75,600");
  });
  it("renders em-dash for null/NaN", () => {
    expect(fmtExact(null)).toBe("—");
    expect(fmtExact(NaN)).toBe("—");
  });
});

describe("statusMeta", () => {
  it("maps status to [tone, label]", () => {
    expect(statusMeta("partially-paid")).toEqual(["pending", "Partially Paid"]);
  });
});
