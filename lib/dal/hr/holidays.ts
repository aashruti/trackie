import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { holidays, attendanceRecords, employeeProfiles } from "@/lib/db/schema";
import { assertHrAccess, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";

export type HolidayRow = { id: number; date: string; name: string; applied: number };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A company holiday is a paid, org-wide day off. We store it in `holidays` and
 * also *materialize* it into `attendance_records` (day_type='holiday',
 * source='auto-off') for every active employee, so it shows up uniformly in the
 * month grid, the day-wise marker, and the dashboard — and reads as paid in
 * payroll (absenceUnits('holiday') === 0). Materializing never clobbers an
 * existing record (scanner / manual / import / leave), so real attendance wins.
 */

/** Insert a 'holiday' record for every active employee on `date`, preserving any
 *  existing mark. Returns how many rows were newly applied is not tracked here —
 *  callers re-read counts via listHolidays. */
async function materialize(date: string): Promise<void> {
  const emps = await db
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.status, "active"));
  if (!emps.length) return;
  await db
    .insert(attendanceRecords)
    .values(
      emps.map((e) => ({
        employeeId: e.id,
        date,
        dayType: "holiday" as const,
        source: "auto-off" as const,
        lopDays: "0",
        isLate: false,
        isEarlyLeave: false,
      })),
    )
    // Preserve any real attendance already on that date.
    .onConflictDoNothing({ target: [attendanceRecords.employeeId, attendanceRecords.date] });
}

/** Remove only the auto-applied holiday rows for a date (manual holiday marks stay). */
async function dematerialize(date: string): Promise<void> {
  await db
    .delete(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.date, date),
        eq(attendanceRecords.dayType, "holiday"),
        eq(attendanceRecords.source, "auto-off"),
      ),
    );
}

/** All company holidays (soonest first), with how many employees each is applied to. */
export async function listHolidays(user: SessionUser): Promise<HolidayRow[]> {
  assertHrAccess(user);
  const [rows, counts] = await Promise.all([
    db.select({ id: holidays.id, date: holidays.date, name: holidays.name }).from(holidays).orderBy(asc(holidays.date)),
    db
      .select({ date: attendanceRecords.date, n: sql<number>`count(*)::int` })
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.dayType, "holiday"), eq(attendanceRecords.source, "auto-off")))
      .groupBy(attendanceRecords.date),
  ]);
  const byDate = new Map(counts.map((c) => [c.date, c.n]));
  return rows.map((r) => ({ ...r, applied: byDate.get(r.date) ?? 0 }));
}

/** Add (or rename) a company holiday and apply it to every active employee. */
export async function addHoliday(user: SessionUser, date: string, name: string): Promise<void> {
  assertHrAccess(user);
  if (!ISO.test(date)) throw new UserError("Pick a valid date.");
  const label = name.trim();
  if (!label) throw new UserError("Give the holiday a name.");
  if (label.length > 120) throw new UserError("Holiday name is too long.");
  await db
    .insert(holidays)
    .values({ date, name: label })
    .onConflictDoUpdate({ target: holidays.date, set: { name: label } });
  await materialize(date);
}

/** Re-apply an existing holiday (e.g. to include employees enrolled since it was added). */
export async function reapplyHoliday(user: SessionUser, id: number): Promise<void> {
  assertHrAccess(user);
  const [row] = await db.select({ date: holidays.date }).from(holidays).where(eq(holidays.id, id)).limit(1);
  if (!row) throw new UserError("Holiday not found.");
  await materialize(row.date);
}

/** Delete a company holiday and remove its auto-applied attendance rows. */
export async function deleteHoliday(user: SessionUser, id: number): Promise<void> {
  assertHrAccess(user);
  const [row] = await db.select({ date: holidays.date }).from(holidays).where(eq(holidays.id, id)).limit(1);
  if (!row) throw new UserError("Holiday not found.");
  await dematerialize(row.date);
  await db.delete(holidays).where(eq(holidays.id, id));
}
