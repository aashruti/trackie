import { describe, it, expect } from "vitest";
import { monthsAccruedToDate } from "./leave";

/** Pro-rata accrual months for Earned leave (1.5/mo), given date-of-joining. */
describe("monthsAccruedToDate — pro-rata for mid-year joiners", () => {
  it("no DOJ / joined a prior year → full months elapsed", () => {
    expect(monthsAccruedToDate(null, 2026, 7)).toBe(7); // Jan–Jul
    expect(monthsAccruedToDate("2025-01-07", 2026, 7)).toBe(7);
    expect(monthsAccruedToDate("2023-12-01", 2026, 6)).toBe(6);
  });

  it("joined mid-year → accrues from the join month (inclusive)", () => {
    expect(monthsAccruedToDate("2026-05-26", 2026, 7)).toBe(3); // May, Jun, Jul → 3 mo → ×1.5 = 4.5 (Abhishek)
    expect(monthsAccruedToDate("2026-01-05", 2026, 3)).toBe(3); // Jan–Mar
    expect(monthsAccruedToDate("2026-05-26", 2026, 12)).toBe(8); // May–Dec
  });

  it("joined this month → 1 month", () => {
    expect(monthsAccruedToDate("2026-07-15", 2026, 7)).toBe(1);
  });

  it("joined after the leave year → 0", () => {
    expect(monthsAccruedToDate("2027-01-01", 2026, 7)).toBe(0);
    expect(monthsAccruedToDate("2026-08-01", 2026, 7)).toBe(0); // joins next month
  });

  it("caps at 12 months", () => {
    expect(monthsAccruedToDate("2020-01-01", 2026, 12)).toBe(12);
    expect(monthsAccruedToDate(null, 2026, 12)).toBe(12);
  });
});
