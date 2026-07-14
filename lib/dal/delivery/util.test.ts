import { describe, it, expect } from "vitest";
import { buildCalendarCells, monthDays } from "./util";

describe("monthDays", () => {
  it("produces every ISO date of the month", () => {
    const july = monthDays(2026, 7);
    expect(july.length).toBe(31);
    expect(july[0]).toBe("2026-07-01");
    expect(july[30]).toBe("2026-07-31");
  });
  it("handles February and leap years", () => {
    expect(monthDays(2026, 2).length).toBe(28);
    expect(monthDays(2028, 2).length).toBe(29);
  });
});

describe("buildCalendarCells", () => {
  const days = monthDays(2026, 7);
  const evt = (id: number, startDate: string, endDate: string | null) => ({
    id,
    title: `E${id}`,
    status: "planned" as const,
    startDate,
    endDate,
  });

  it("a single-day event lands on exactly one cell with starts+ends", () => {
    const cells = buildCalendarCells(days, [evt(1, "2026-07-10", null)], []);
    expect(Object.keys(cells)).toEqual(["2026-07-10"]);
    expect(cells["2026-07-10"].events[0]).toMatchObject({ id: 1, starts: true, ends: true });
  });

  it("a spanning event fills every day with correct edge flags", () => {
    const cells = buildCalendarCells(days, [evt(2, "2026-07-05", "2026-07-07")], []);
    expect(cells["2026-07-05"].events[0]).toMatchObject({ starts: true, ends: false });
    expect(cells["2026-07-06"].events[0]).toMatchObject({ starts: false, ends: false });
    expect(cells["2026-07-07"].events[0]).toMatchObject({ starts: false, ends: true });
  });

  it("events bleeding across month boundaries are clamped but keep true edges", () => {
    const cells = buildCalendarCells(days, [evt(3, "2026-06-28", "2026-07-02"), evt(4, "2026-07-30", "2026-08-02")], []);
    // Bleeds in: visible from the 1st, but `starts` stays false (true start was June).
    expect(cells["2026-07-01"].events[0]).toMatchObject({ id: 3, starts: false });
    expect(cells["2026-07-02"].events[0]).toMatchObject({ id: 3, ends: true });
    // Bleeds out: visible until the 31st, `ends` false (true end is August).
    expect(cells["2026-07-31"].events[0]).toMatchObject({ id: 4, ends: false });
    expect(cells["2026-07-30"].events[0]).toMatchObject({ id: 4, starts: true });
  });

  it("activities land as dots on their date; outside-month activities are dropped", () => {
    const cells = buildCalendarCells(
      days,
      [],
      [
        { id: 9, type: "expense", title: "Venue booking", activityDate: "2026-07-10", cost: 5000 },
        { id: 10, type: "note", title: "Old note", activityDate: "2026-06-10", cost: 0 },
      ],
    );
    expect(cells["2026-07-10"].activities).toHaveLength(1);
    expect(cells["2026-07-10"].activities[0].cost).toBe(5000);
    expect(cells["2026-06-10"]).toBeUndefined();
  });
});
