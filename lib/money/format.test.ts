import { describe, it, expect } from "vitest";
import { fmt, fmtCompact, statusMeta } from "./format";

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
});

describe("fmtCompact", () => {
  it("crores", () => {
    expect(fmtCompact(45000000)).toBe("₹4.5Cr");
  });
  it("lakhs", () => {
    expect(fmtCompact(412128)).toBe("₹4.1L");
  });
  it("thousands", () => {
    expect(fmtCompact(75600)).toBe("₹76K");
  });
});

describe("statusMeta", () => {
  it("maps status to [tone, label]", () => {
    expect(statusMeta("partially-paid")).toEqual(["pending", "Partially Paid"]);
  });
});
