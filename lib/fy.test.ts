import { describe, it, expect } from "vitest";
import { batchStartYear, nextFyLabel, prevFyLabel, normalizeBatchLabel, yearOfStudy } from "./fy";

describe("normalizeBatchLabel", () => {
  it.each([
    ["2024-25", "FY24–25"],
    ["24-25", "FY24–25"],
    ["FY24-25", "FY24–25"],
    ["FY 24-25", "FY24–25"],
    ["FY24–25", "FY24–25"],
    ["fy24-25", "FY24–25"],
    [" 2024-25 ", "FY24–25"],
  ])("canonicalizes %s → %s", (input, want) => {
    expect(normalizeBatchLabel(input)).toBe(want);
  });

  it.each([["earlier"], ["pre-FY26–27"], ["2024"], ["FY2024-2025"], [""]])(
    "leaves unrecognized %j unchanged (trimmed)",
    (input) => expect(normalizeBatchLabel(input)).toBe(input.trim()),
  );
});

describe("nextFyLabel / prevFyLabel", () => {
  it("advances the canonical form", () => {
    expect(nextFyLabel("FY26–27")).toBe("FY27–28");
    expect(prevFyLabel("FY26–27")).toBe("FY25–26");
  });
  it("round-trips", () => {
    expect(prevFyLabel(nextFyLabel("FY26–27"))).toBe("FY26–27");
  });
  it("normalizes legacy input while stepping", () => {
    expect(nextFyLabel("2024-25")).toBe("FY25–26");
    expect(prevFyLabel("2024-25")).toBe("FY23–24");
  });
  it("wraps the century", () => {
    expect(nextFyLabel("FY99–00")).toBe("FY00–01");
    expect(prevFyLabel("FY00–01")).toBe("FY99–00");
  });
  it("appends a marker for unparseable labels", () => {
    expect(nextFyLabel("weird")).toBe("weird (next)");
    expect(prevFyLabel("weird")).toBe("weird (prev)");
  });
});

describe("batchStartYear / yearOfStudy", () => {
  it("parses both conventions", () => {
    expect(batchStartYear("FY26–27")).toBe(2026);
    expect(batchStartYear("2024-25")).toBe(2024);
    expect(batchStartYear("FY 24-25")).toBe(2024);
    expect(batchStartYear("junk")).toBeNull();
  });
  it("computes ordinal year of study (parity with the old inline copies)", () => {
    expect(yearOfStudy("FY24–25", "FY26–27")).toBe("3rd year");
    expect(yearOfStudy("2024-25", "FY26–27")).toBe("3rd year");
    expect(yearOfStudy("FY26–27", "FY26–27")).toBe("1st year");
    expect(yearOfStudy("FY27–28", "FY26–27")).toBeNull(); // future batch
    expect(yearOfStudy("junk", "FY26–27")).toBeNull();
  });
});
