import { UserError } from "@/lib/dal/errors";
import type { DeliveryActivityType, DeliveryEventStatus } from "@/lib/db/enums";

/**
 * Pure helpers for the delivery module — no DB, no "server-only", so they are
 * unit-testable and safe to share. Dates are ISO "YYYY-MM-DD" strings
 * end-to-end (house convention; comparisons are plain string compares).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label: string): void {
  if (!ISO.test(value)) throw new UserError(`Pick a valid ${label}.`);
}

/** Normalise an optional money input → numeric-column string. Rejects negatives. */
export function toMoney(value: number | undefined, label: string, fallback = 0): string {
  const n = value ?? fallback;
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${label} must be zero or a positive amount.`);
  return String(n);
}

export function assertDateOrder(start: string | undefined, end: string | undefined, what: string): void {
  if (start && end && end < start) throw new UserError(`${what} end date can't be before its start date.`);
}

/** Every ISO date of a month (1-based month), e.g. days(2026, 7) → 31 entries. */
export function monthDays(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return Array.from({ length: count }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`);
}

// ── Calendar cells ────────────────────────────────────────────────────────────

export type CalendarEventChip = {
  id: number;
  title: string;
  status: DeliveryEventStatus;
  /** True on the first visible day of the event (rounded left edge / shows title). */
  starts: boolean;
  /** True on the last visible day of the event. */
  ends: boolean;
};

export type CalendarActivityDot = {
  id: number;
  type: DeliveryActivityType;
  title: string;
  cost: number;
};

export type CalendarCell = { events: CalendarEventChip[]; activities: CalendarActivityDot[] };

export type CalendarEventInput = {
  id: number;
  title: string;
  status: DeliveryEventStatus;
  startDate: string;
  endDate: string | null; // null = single-day
};

export type CalendarActivityInput = {
  id: number;
  type: DeliveryActivityType;
  title: string;
  activityDate: string;
  cost: number;
};

/**
 * Expand events (possibly spanning several days / into neighbouring months) and
 * dated activities into per-day cells for one month. `starts`/`ends` flags are
 * about the TRUE event boundaries, so an event bleeding in from last month
 * renders with an "open" left edge.
 */
export function buildCalendarCells(
  days: string[],
  events: CalendarEventInput[],
  activities: CalendarActivityInput[],
): Record<string, CalendarCell> {
  const cells: Record<string, CalendarCell> = {};
  const cell = (d: string) => (cells[d] ??= { events: [], activities: [] });

  if (days.length) {
    const first = days[0];
    const last = days[days.length - 1];
    for (const e of events) {
      const end = e.endDate ?? e.startDate;
      // Clamp the visible span to this month (string compares are safe on ISO).
      const from = e.startDate < first ? first : e.startDate;
      const to = end > last ? last : end;
      for (const d of days) {
        if (d < from || d > to) continue;
        cell(d).events.push({ id: e.id, title: e.title, status: e.status, starts: d === e.startDate, ends: d === end });
      }
    }
  }
  for (const a of activities) {
    if (!days.includes(a.activityDate)) continue;
    cell(a.activityDate).activities.push({ id: a.id, type: a.type, title: a.title, cost: a.cost });
  }
  return cells;
}
