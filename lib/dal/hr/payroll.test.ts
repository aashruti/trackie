import { describe, it, expect } from "vitest";
import { computePay, runningMonthLop, absenceUnits, lateLopDays, cycleRange, SALARY_SPLIT, DAYS_IN_MONTH } from "./payroll";

const M = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

/**
 * Ground truth: "Copy of Datagami - Salary June 2026.xlsx" → sheet "June 2026".
 * Formula: perDay = gross/30; earned = perDay × (30 − lopDays);
 * takeHome = earned − insurance − professionalTax − tds + additions.
 */
describe("computePay — reproduces the June 2026 salary sheet", () => {
  const CASES: {
    who: string;
    gross: number;
    lopDays: number;
    insurance?: number;
    professionalTax?: number;
    tds?: number;
    earned: number;
    net: number;
  }[] = [
    { who: "DG008 Shweta (full month)", gross: 75000, lopDays: 0, professionalTax: 200, earned: 75000, net: 74800 },
    { who: "DG009 Suresh (full month)", gross: 85000, lopDays: 0, professionalTax: 200, earned: 85000, net: 84800 },
    { who: "DG019 Kunal (full month)", gross: 50000, lopDays: 0, professionalTax: 200, earned: 50000, net: 49800 },
    { who: "DG015 Joseph (TDS ₹15k, no PT)", gross: 150000, lopDays: 0, tds: 15000, professionalTax: 0, earned: 150000, net: 135000 },
    { who: "DG025 Bini (insurance ₹500)", gross: 30000, lopDays: 0, insurance: 500, professionalTax: 200, earned: 30000, net: 29300 },
    { who: "DG020 Kiran (7 LOP days)", gross: 40000, lopDays: 7, professionalTax: 200, earned: 30666.67, net: 30466.67 },
    { who: "DG028 Mangesh (4.5 LOP + insurance)", gross: 35000, lopDays: 4.5, insurance: 500, professionalTax: 200, earned: 29750, net: 29050 },
    { who: "DG032 Abhishek (half-day LOP + insurance)", gross: 37000, lopDays: 0.5, insurance: 500, professionalTax: 200, earned: 36383.33, net: 35683.33 },
    { who: "Prachi (freelancer, no PT)", gross: 12000, lopDays: 0, professionalTax: 0, earned: 12000, net: 12000 },
    { who: "DG033 Divya (intern, 8 LOP)", gross: 10000, lopDays: 8, professionalTax: 0, earned: 7333.33, net: 7333.33 },
  ];

  for (const c of CASES) {
    it(c.who, () => {
      const p = computePay({ gross: c.gross, lopDays: c.lopDays, insurance: c.insurance, professionalTax: c.professionalTax, tds: c.tds });
      expect(p.earnedGross).toBe(c.earned);
      expect(p.netPay).toBe(c.net);
      expect(p.daysWorked).toBe(DAYS_IN_MONTH - c.lopDays);
    });
  }
});

describe("computePay — invariants", () => {
  it("full-month pay equals gross exactly (no rounding drift)", () => {
    // 85000/30 = 2833.333… — must NOT round the per-day before multiplying
    expect(computePay({ gross: 85000, lopDays: 0 }).earnedGross).toBe(85000);
    expect(computePay({ gross: 100000, lopDays: 0 }).earnedGross).toBe(100000);
  });

  it("splits gross into Basic 40% / HRA 16% / Other 44%", () => {
    const p = computePay({ gross: 50000, lopDays: 0 });
    expect(p.basic).toBe(20000);
    expect(p.hra).toBe(8000);
    expect(p.otherAllowance).toBe(22000);
    expect(p.basic + p.hra + p.otherAllowance).toBe(50000);
    expect(SALARY_SPLIT.basic + SALARY_SPLIT.hra + SALARY_SPLIT.other).toBe(1);
  });

  it("net is floored at 0 (deductions can zero pay but never go negative)", () => {
    expect(computePay({ gross: 10000, lopDays: 0, tds: 999999 }).netPay).toBe(0);
  });

  it("caps LOP at the month length (fully absent → 0 earned)", () => {
    const p = computePay({ gross: 60000, lopDays: 40 });
    expect(p.lopDays).toBe(30);
    expect(p.daysWorked).toBe(0);
    expect(p.earnedGross).toBe(0);
    expect(p.netPay).toBe(0);
  });

  it("half-day LOP docks exactly half a day of pay", () => {
    const full = computePay({ gross: 30000, lopDays: 0 }).earnedGross;
    const half = computePay({ gross: 30000, lopDays: 0.5 }).earnedGross;
    expect(full - half).toBe(500); // 30000/30 × 0.5
  });

  it("additions are added; insurance/PT/TDS are deducted", () => {
    const p = computePay({ gross: 30000, lopDays: 0, additions: 1000, insurance: 500, professionalTax: 200, tds: 300 });
    expect(p.netPay).toBe(30000 + 1000 - 500 - 200 - 300);
  });
});

describe("lateLopDays — 3 free lates/month, then half-day each", () => {
  it("0–3 lates are free", () => {
    expect(lateLopDays(0)).toBe(0);
    expect(lateLopDays(3)).toBe(0);
  });
  it("each late beyond 3 docks half a day", () => {
    expect(lateLopDays(4)).toBe(0.5); // 1 over → 0.5
    expect(lateLopDays(5)).toBe(1); // 2 over → 1.0
    expect(lateLopDays(7)).toBe(2); // 4 over → 2.0
  });
});

describe("absenceUnits — which days draw the leave balance", () => {
  it("leave/absent draw; worked & paid days don't", () => {
    expect(absenceUnits("absent")).toBe(1);
    expect(absenceUnits("paid-leave")).toBe(1);
    expect(absenceUnits("unpaid-leave")).toBe(1);
    expect(absenceUnits("half-day")).toBe(0.5);
    for (const dt of ["office", "wfh", "official-visit", "comp-off", "holiday", "weekly-off"] as const) expect(absenceUnits(dt)).toBe(0);
  });
});

describe("runningMonthLop — overdraw beyond accumulated leave = LOP", () => {
  const AC = 1.5; // 18/yr

  it("absences within the accumulated balance → 0 LOP", () => {
    // by June: 6×1.5 = 9 accrued; 3 absences fit → paid
    expect(runningMonthLop(M({ 6: 3 }), 1, 6, AC, 0)).toBe(0);
  });

  it("the user's example: 4.5 accumulated, take 6 → 1.5 LOP, balance resets", () => {
    // 3 clean months build 4.5, then month 4 takes 6 (its own 1.5 makes 4.5 available)... use carry to reach 4.5 at the target
    // Month 3: balance after accrual = 4.5 (3×1.5), take 6 → over 1.5.
    expect(runningMonthLop(M({ 3: 6 }), 1, 3, AC, 0)).toBe(1.5);
    // Next month starts fresh at 1.5: an absence of 2 → over 0.5.
    expect(runningMonthLop(M({ 3: 6, 4: 2 }), 1, 4, AC, 0)).toBe(0.5);
  });

  it("no negative carry — a prior overdraw doesn't dock a clean later month", () => {
    // Month 3 overdrew; month 4 has 1 absence but balance reset to 0 then +1.5 → fits
    expect(runningMonthLop(M({ 3: 6, 4: 1 }), 1, 4, AC, 0)).toBe(0);
  });

  it("carry-forward from last year is available", () => {
    // 5 carried + 1.5 (month 1) = 6.5; take 6 in month 1 → 0 LOP
    expect(runningMonthLop(M({ 1: 6 }), 1, 1, AC, 5)).toBe(0);
  });

  it("mid-year joiner accrues only from the join month", () => {
    // joined May (start 5); by June 2×1.5 = 3 accrued; 4 absences → 1 LOP
    expect(runningMonthLop(M({ 6: 4 }), 5, 6, AC, 0)).toBe(1);
    // target before start → not employed → 0
    expect(runningMonthLop(M({ 4: 5 }), 5, 4, AC, 0)).toBe(0);
  });
});

describe("cycleRange — calendar month vs 26→25 cycle", () => {
  it("cycleStartDay<=1 → the calendar month", () => {
    const c = cycleRange(2026, 6, 1);
    expect(c.start).toBe("2026-06-01");
    expect(c.end).toBe("2026-06-30");
    expect(c.dates.length).toBe(30);
  });
  it("cycleStartDay=26 → the 26→25 cycle (26 May → 25 Jun)", () => {
    const c = cycleRange(2026, 6, 26);
    expect(c.start).toBe("2026-05-26");
    expect(c.end).toBe("2026-06-25");
    expect(c.dates.length).toBe(31);
    expect(c.dates.includes("2026-05-31")).toBe(true);
    expect(c.dates.includes("2026-06-01")).toBe(true);
  });

  it("January (26→25) wraps to the previous December", () => {
    const c = cycleRange(2026, 1, 26);
    expect(c.start).toBe("2025-12-26");
    expect(c.end).toBe("2026-01-25");
  });
});
