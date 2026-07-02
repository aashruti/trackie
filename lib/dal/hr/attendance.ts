import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attendanceRecords, attendanceUploads, employeeProfiles, shifts, users } from "@/lib/db/schema";
import { assertHrAccess, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import { getEmployeeForUser } from "./leave";
import { ATTENDANCE_DAY_TYPES, type AttendanceDayType } from "@/lib/db/enums";
import { parseBasicWorkDurationReport, type NormalizedDay } from "./parsers/basic-work-duration";

// Fallback schedule when an employee has no shift assigned.
const DEFAULT_SHIFT = { startMin: 600, endMin: 1140, grace: 15, earlyBefore: 60, halfAfter: 180 }; // 10:00–19:00

function hhmmToMin(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Map the device status + annotation to our day_type + per-day LOP. */
function classify(d: NormalizedDay): { dayType: AttendanceDayType; lop: number } {
  const a = (d.annotation ?? "").toLowerCase();
  if (a.includes("wfh")) return { dayType: "wfh", lop: 0 };
  if (a.includes("official") || a.includes("visit")) return { dayType: "official-visit", lop: 0 };
  if (a.includes("holiday")) return { dayType: "holiday", lop: 0 };
  if (a.includes("leave")) return { dayType: "paid-leave", lop: 0 };
  const s = d.status.replace(/\s/g, "");
  if (s.includes("WO")) return { dayType: "weekly-off", lop: 0 };
  if (s.includes("½P") || s.toLowerCase().includes("hd")) return { dayType: "half-day", lop: 0.5 };
  if (s === "A") return { dayType: "absent", lop: 1 };
  return { dayType: "office", lop: 0 };
}

export type ProposedRecord = {
  date: string;
  dayType: AttendanceDayType;
  isLate: boolean;
  lateMinutes: number;
  isEarlyLeave: boolean;
  earlyMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lopDays: number;
};

export type PreviewEmployee = {
  employeeId: number;
  employeeCode: string;
  name: string;
  records: ProposedRecord[];
};

export type AttendancePreview = {
  periodStart: string | null;
  periodEnd: string | null;
  matched: PreviewEmployee[];
  unmatched: { code: string; name: string; days: number }[];
  totalDays: number;
};

type ShiftCfg = { startMin: number; endMin: number; grace: number; earlyBefore: number; halfAfter: number };

function buildRecord(d: NormalizedDay, shift: ShiftCfg): ProposedRecord {
  const { dayType, lop } = classify(d);
  const inMin = hhmmToMin(d.inTime);
  const outMin = hhmmToMin(d.outTime);
  const isPresentish = dayType === "office" || dayType === "half-day" || dayType === "wfh";
  const isLate = isPresentish && inMin != null && inMin > shift.startMin + shift.grace;
  const isEarly = isPresentish && outMin != null && outMin < shift.endMin - shift.earlyBefore;
  return {
    date: d.date,
    dayType,
    isLate: !!isLate,
    lateMinutes: isLate && inMin != null ? inMin - shift.startMin : 0,
    isEarlyLeave: !!isEarly,
    earlyMinutes: isEarly && outMin != null ? shift.endMin - outMin : 0,
    firstIn: d.inTime,
    lastOut: d.outTime,
    workedMinutes: d.totalMinutes,
    lopDays: lop,
  };
}

async function loadEmployeeShifts(): Promise<{
  byBiometric: Map<string, { id: number; code: string; name: string; shift: ShiftCfg }>;
}> {
  const rows = await db
    .select({
      id: employeeProfiles.id,
      code: employeeProfiles.employeeCode,
      biometricId: employeeProfiles.biometricId,
      name: users.name,
      sStart: shifts.startTime,
      sEnd: shifts.endTime,
      grace: shifts.graceMinutes,
      early: shifts.earlyLeaveBeforeMinutes,
      half: shifts.halfDayAfterMinutes,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .leftJoin(shifts, eq(employeeProfiles.shiftId, shifts.id));
  const byBiometric = new Map<string, { id: number; code: string; name: string; shift: ShiftCfg }>();
  for (const r of rows) {
    if (!r.biometricId) continue;
    const shift: ShiftCfg = r.sStart
      ? {
          startMin: hhmmToMin(r.sStart)!,
          endMin: hhmmToMin(r.sEnd)!,
          grace: r.grace ?? 0,
          earlyBefore: r.early ?? DEFAULT_SHIFT.earlyBefore,
          halfAfter: r.half ?? DEFAULT_SHIFT.halfAfter,
        }
      : DEFAULT_SHIFT;
    byBiometric.set(r.biometricId.trim(), { id: r.id, code: r.code, name: r.name, shift });
  }
  return { byBiometric };
}

function buildPreview(parsed: ReturnType<typeof parseBasicWorkDurationReport>, byBiometric: Awaited<ReturnType<typeof loadEmployeeShifts>>["byBiometric"]): AttendancePreview {
  const matchedMap = new Map<number, PreviewEmployee>();
  const unmatchedMap = new Map<string, { code: string; name: string; days: number }>();
  for (const d of parsed.days) {
    const emp = byBiometric.get(d.code.trim());
    if (!emp) {
      const u = unmatchedMap.get(d.code) ?? { code: d.code, name: d.name, days: 0 };
      u.days++;
      unmatchedMap.set(d.code, u);
      continue;
    }
    let pe = matchedMap.get(emp.id);
    if (!pe) {
      pe = { employeeId: emp.id, employeeCode: emp.code, name: emp.name, records: [] };
      matchedMap.set(emp.id, pe);
    }
    pe.records.push(buildRecord(d, emp.shift));
  }
  const matched = [...matchedMap.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  for (const pe of matched) pe.records.sort((a, b) => a.date.localeCompare(b.date));
  return {
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    matched,
    unmatched: [...unmatchedMap.values()].sort((a, b) => Number(a.code) - Number(b.code)),
    totalDays: parsed.days.length,
  };
}

/** Parse + match a scanner file WITHOUT writing — for the preview screen. */
export async function previewAttendance(user: SessionUser, bytes: Buffer): Promise<AttendancePreview> {
  assertHrAccess(user);
  const parsed = parseBasicWorkDurationReport(bytes);
  const { byBiometric } = await loadEmployeeShifts();
  return buildPreview(parsed, byBiometric);
}

/** Commit a scanner file: upsert attendance_records, never clobbering approved-leave days. */
export async function commitAttendance(
  user: SessionUser,
  bytes: Buffer,
  fileName: string,
  blobUrl: string | null,
): Promise<{ committed: number; matchedEmployees: number; unmatched: number }> {
  assertHrAccess(user);
  const parsed = parseBasicWorkDurationReport(bytes);
  const { byBiometric } = await loadEmployeeShifts();
  const preview = buildPreview(parsed, byBiometric);

  const [upload] = await db
    .insert(attendanceUploads)
    .values({
      uploadedByUserId: user.id,
      fileName,
      blobUrl,
      periodStart: preview.periodStart,
      periodEnd: preview.periodEnd,
      rowCount: preview.totalDays,
      matchedCount: preview.matched.reduce((n, e) => n + e.records.length, 0),
      unmatchedCount: preview.unmatched.reduce((n, u) => n + u.days, 0),
      status: "committed",
    })
    .returning({ id: attendanceUploads.id });

  let committed = 0;
  const values = preview.matched.flatMap((e) =>
    e.records.map((r) => ({
      employeeId: e.employeeId,
      date: r.date,
      dayType: r.dayType,
      isLate: r.isLate,
      lateMinutes: r.lateMinutes,
      isEarlyLeave: r.isEarlyLeave,
      earlyMinutes: r.earlyMinutes,
      firstIn: r.firstIn,
      lastOut: r.lastOut,
      workedMinutes: r.workedMinutes,
      lopDays: String(r.lopDays),
      source: "scanner" as const,
      uploadId: upload.id,
    })),
  );
  // Upsert in chunks; preserve any day already sourced from an approved leave.
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500);
    await db
      .insert(attendanceRecords)
      .values(chunk)
      .onConflictDoUpdate({
        target: [attendanceRecords.employeeId, attendanceRecords.date],
        set: {
          dayType: sql`excluded.day_type`,
          isLate: sql`excluded.is_late`,
          lateMinutes: sql`excluded.late_minutes`,
          isEarlyLeave: sql`excluded.is_early_leave`,
          earlyMinutes: sql`excluded.early_minutes`,
          firstIn: sql`excluded.first_in`,
          lastOut: sql`excluded.last_out`,
          workedMinutes: sql`excluded.worked_minutes`,
          lopDays: sql`excluded.lop_days`,
          source: sql`excluded.source`,
          uploadId: sql`excluded.upload_id`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${attendanceRecords.source} <> 'leave'`,
      });
    committed += chunk.length;
  }

  return {
    committed,
    matchedEmployees: preview.matched.length,
    unmatched: preview.unmatched.length,
  };
}

export type MonthGridCell = {
  date: string;
  dayType: AttendanceDayType;
  isLate: boolean;
  isEarlyLeave: boolean;
  lopDays: number;
};
export type MonthGridRow = { employeeId: number; employeeCode: string; name: string; cells: Record<string, MonthGridCell> };

/** Attendance grid for a calendar month (rows = employees, keyed by date). */
export async function getMonthGrid(user: SessionUser, year: number, month: number): Promise<{ days: string[]; rows: MonthGridRow[] }> {
  assertHrAccess(user);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  const days = Array.from({ length: endDate }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);

  const emps = await db
    .select({ id: employeeProfiles.id, code: employeeProfiles.employeeCode, name: users.name })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(eq(employeeProfiles.status, "active"))
    .orderBy(asc(employeeProfiles.employeeCode));
  if (!emps.length) return { days, rows: [] };

  const recs = await db
    .select()
    .from(attendanceRecords)
    .where(and(inArray(attendanceRecords.employeeId, emps.map((e) => e.id)), gte(attendanceRecords.date, start), lte(attendanceRecords.date, end)));

  const byEmp = new Map<number, MonthGridRow>();
  for (const e of emps) byEmp.set(e.id, { employeeId: e.id, employeeCode: e.code, name: e.name, cells: {} });
  for (const r of recs) {
    const row = byEmp.get(r.employeeId);
    if (row) row.cells[r.date] = { date: r.date, dayType: r.dayType, isLate: r.isLate, isEarlyLeave: r.isEarlyLeave, lopDays: Number(r.lopDays) };
  }
  return { days, rows: [...byEmp.values()] };
}

export type MyAttendance = {
  isEmployee: boolean;
  days: string[];
  cells: Record<string, MonthGridCell>;
  summary: { present: number; wfh: number; leave: number; absent: number; lateCount: number; lopDays: number };
};

/** The caller's own attendance for a month + a quick summary. */
export async function getMyAttendanceMonth(user: SessionUser, year: number, month: number): Promise<MyAttendance> {
  const me = await getEmployeeForUser(user.id);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  const days = Array.from({ length: endDate }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
  if (!me) return { isEmployee: false, days, cells: {}, summary: { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, lopDays: 0 } };

  const recs = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, me.employeeId), gte(attendanceRecords.date, start), lte(attendanceRecords.date, end)))
    .orderBy(asc(attendanceRecords.date));

  const cells: Record<string, MonthGridCell> = {};
  const summary = { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, lopDays: 0 };
  for (const r of recs) {
    cells[r.date] = { date: r.date, dayType: r.dayType, isLate: r.isLate, isEarlyLeave: r.isEarlyLeave, lopDays: Number(r.lopDays) };
    if (r.dayType === "office" || r.dayType === "half-day") summary.present++;
    else if (r.dayType === "wfh") summary.wfh++;
    else if (r.dayType === "paid-leave" || r.dayType === "unpaid-leave") summary.leave++;
    else if (r.dayType === "absent") summary.absent++;
    if (r.isLate) summary.lateCount++;
    summary.lopDays += Number(r.lopDays);
  }
  return { isEmployee: true, days, cells, summary };
}

/** Per-day LOP implied by a day type (used when HR overrides a cell). */
export function lopForDayType(dt: AttendanceDayType): number {
  if (dt === "absent" || dt === "unpaid-leave") return 1;
  if (dt === "half-day") return 0.5;
  return 0;
}

/** HR override of a single day — sets day_type manually and clears late/early
 *  flags (a manual designation isn't a scanned late arrival). */
export async function overrideAttendanceDay(
  user: SessionUser,
  employeeId: number,
  date: string,
  dayType: AttendanceDayType,
): Promise<void> {
  assertHrAccess(user);
  if (!(ATTENDANCE_DAY_TYPES as readonly string[]).includes(dayType)) {
    throw new UserError("Unknown day type.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new UserError("Invalid date.");
  }
  const lop = String(lopForDayType(dayType));
  const cleared = { isLate: false, lateMinutes: 0, isEarlyLeave: false, earlyMinutes: 0 };
  await db
    .insert(attendanceRecords)
    .values({ employeeId, date, dayType, source: "manual", overriddenByUserId: user.id, lopDays: lop, ...cleared })
    .onConflictDoUpdate({
      target: [attendanceRecords.employeeId, attendanceRecords.date],
      set: { dayType, lopDays: lop, source: "manual", overriddenByUserId: user.id, updatedAt: sql`now()`, ...cleared },
    });
}

/** Toggle the late flag on a day (keeps the day-type; auto-marks office if unset). */
export async function setAttendanceLate(user: SessionUser, employeeId: number, date: string, isLate: boolean): Promise<void> {
  assertHrAccess(user);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Invalid date.");
  await db
    .insert(attendanceRecords)
    .values({ employeeId, date, dayType: "office", source: "manual", overriddenByUserId: user.id, lopDays: "0", isLate, lateMinutes: 0, isEarlyLeave: false, earlyMinutes: 0 })
    .onConflictDoUpdate({
      target: [attendanceRecords.employeeId, attendanceRecords.date],
      // Preserve day_type/source; only flip the late flag (zero minutes when clearing).
      set: { isLate, lateMinutes: isLate ? sql`${attendanceRecords.lateMinutes}` : 0, overriddenByUserId: user.id, updatedAt: sql`now()` },
    });
}

export type DayMark = { dayType: AttendanceDayType; isLate: boolean; isEarlyLeave: boolean };

/** Every active employee's mark (if any) on a single date — for the day-wise marker. */
export async function getDayAttendance(user: SessionUser, date: string): Promise<Record<number, DayMark>> {
  assertHrAccess(user);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Invalid date.");
  const rows = await db
    .select({ employeeId: attendanceRecords.employeeId, dayType: attendanceRecords.dayType, isLate: attendanceRecords.isLate, isEarlyLeave: attendanceRecords.isEarlyLeave })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.date, date));
  const out: Record<number, DayMark> = {};
  for (const r of rows) out[r.employeeId] = { dayType: r.dayType, isLate: r.isLate, isEarlyLeave: r.isEarlyLeave };
  return out;
}

export async function listActiveEmployees(user: SessionUser): Promise<{ id: number; code: string; name: string }[]> {
  assertHrAccess(user);
  return db
    .select({ id: employeeProfiles.id, code: employeeProfiles.employeeCode, name: users.name })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(eq(employeeProfiles.status, "active"))
    .orderBy(asc(employeeProfiles.employeeCode));
}

/** HR view of one employee's month calendar + summary. */
export async function getEmployeeCalendar(
  user: SessionUser,
  employeeId: number,
  year: number,
  month: number,
): Promise<{ name: string; code: string } & MyAttendance> {
  assertHrAccess(user);
  const [emp] = await db
    .select({ code: employeeProfiles.employeeCode, name: users.name })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(eq(employeeProfiles.id, employeeId))
    .limit(1);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  const days = Array.from({ length: endDate }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
  const recs = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, employeeId), gte(attendanceRecords.date, start), lte(attendanceRecords.date, end)))
    .orderBy(asc(attendanceRecords.date));
  const cells: Record<string, MonthGridCell> = {};
  const summary = { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, lopDays: 0 };
  for (const r of recs) {
    cells[r.date] = { date: r.date, dayType: r.dayType, isLate: r.isLate, isEarlyLeave: r.isEarlyLeave, lopDays: Number(r.lopDays) };
    if (r.dayType === "office" || r.dayType === "half-day") summary.present++;
    else if (r.dayType === "wfh") summary.wfh++;
    else if (r.dayType === "paid-leave" || r.dayType === "unpaid-leave") summary.leave++;
    else if (r.dayType === "absent") summary.absent++;
    if (r.isLate) summary.lateCount++;
    summary.lopDays += Number(r.lopDays);
  }
  return { name: emp?.name ?? "", code: emp?.code ?? "", isEmployee: true, days, cells, summary };
}
