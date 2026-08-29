import { describe, it, expect } from "vitest";
import { fmt, fmtCompact, fmtExact, statusMeta } from "./format";

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

describe("fmtExact", () => {
  it("keeps every rupee that fmtCompact rounds away", () => {
    expect(fmtExact(159876)).toBe("₹1,59,876");
    expect(fmtCompact(159876)).toBe("₹1.6L");
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
