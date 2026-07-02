import { describe, it, expect } from "vitest";
import { computePay, cycleRange, SALARY_SPLIT, DAYS_IN_MONTH } from "./payroll";

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

describe("cycleRange — 26→25 cycle boundaries", () => {
  it("June 2026 runs 26 May → 25 Jun (31 days)", () => {
    const c = cycleRange(2026, 6, 26);
    expect(c.start).toBe("2026-05-26");
    expect(c.end).toBe("2026-06-25");
    expect(c.dates.length).toBe(31);
    expect(c.dates.includes("2026-05-31")).toBe(true);
    expect(c.dates.includes("2026-06-01")).toBe(true);
  });

  it("January wraps to the previous December", () => {
    const c = cycleRange(2026, 1, 26);
    expect(c.start).toBe("2025-12-26");
    expect(c.end).toBe("2026-01-25");
  });

  it("honours a different cycle start day", () => {
    const c = cycleRange(2026, 6, 1); // 1st→last-of-prev
    expect(c.start).toBe("2026-05-01");
    expect(c.end).toBe("2026-05-31");
  });
});
