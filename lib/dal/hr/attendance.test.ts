import { describe, expect, it } from "vitest";
import {
  attendanceBalanceEffect,
  normalizeCompanyDayType,
} from "./attendance";

describe("normalizeCompanyDayType — Saturday policy", () => {
  it("counts company-wide Saturday WFH rows as Present", () => {
    expect(normalizeCompanyDayType("2026-07-04", "wfh")).toBe("office");
    expect(normalizeCompanyDayType("2026-07-11", "wfh")).toBe("office");
  });

  it("keeps optional WFH on other weekdays distinct", () => {
    expect(normalizeCompanyDayType("2026-07-03", "wfh")).toBe("wfh");
    expect(normalizeCompanyDayType("2026-07-06", "wfh")).toBe("wfh");
  });
});

describe("attendanceBalanceEffect — manual marks update leave ledger", () => {
  it("draws paid leave and half-days from Used", () => {
    expect(attendanceBalanceEffect("paid-leave")).toEqual({ used: 1, unpaid: 0 });
    expect(attendanceBalanceEffect("paid-leave", 0, true)).toEqual({ used: 0.5, unpaid: 0 });
    expect(attendanceBalanceEffect("half-day")).toEqual({ used: 0.5, unpaid: 0 });
  });

  it("tracks unpaid leave and absences in Unpaid", () => {
    expect(attendanceBalanceEffect("unpaid-leave")).toEqual({ used: 0, unpaid: 1 });
    expect(attendanceBalanceEffect("absent")).toEqual({ used: 0, unpaid: 1 });
    expect(attendanceBalanceEffect("unpaid-leave", 0.5)).toEqual({ used: 0, unpaid: 0.5 });
  });

  it("does not change leave balances for worked or paid company days", () => {
    for (const dayType of ["office", "wfh", "official-visit", "comp-off", "weekly-off", "holiday"] as const) {
      expect(attendanceBalanceEffect(dayType)).toEqual({ used: 0, unpaid: 0 });
    }
  });
});
