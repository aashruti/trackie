import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attendanceRecords,
  attendanceUploads,
  employeeProfiles,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  shifts,
  users,
} from "@/lib/db/schema";
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

/**
 * Saturday is a company-wide working day. Legacy imports labelled it WFH for
 * everyone, which made the self-service WFH count look like optional WFH usage.
 */
export function normalizeCompanyDayType(date: string, dayType: AttendanceDayType): AttendanceDayType {
  return dayType === "wfh" && new Date(date + "T00:00:00Z").getUTCDay() === 6
    ? "office"
    : dayType;
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
  const classified = classify(d);
  const dayType = normalizeCompanyDayType(d.date, classified.dayType);
  const lop = classified.lop;
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
      createdBy: user.id,
      updatedBy: user.id,
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
      createdBy: user.id,
      updatedBy: user.id,
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
          updatedBy: user.id,
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
  lateMinutes: number;
  isEarlyLeave: boolean;
  earlyMinutes: number;
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
    if (row) {
      row.cells[r.date] = {
        date: r.date,
        dayType: normalizeCompanyDayType(r.date, r.dayType),
        isLate: r.isLate,
        lateMinutes: r.lateMinutes,
        isEarlyLeave: r.isEarlyLeave,
        earlyMinutes: r.earlyMinutes,
        lopDays: Number(r.lopDays),
      };
    }
  }
  return { days, rows: [...byEmp.values()] };
}

export type MyAttendance = {
  isEmployee: boolean;
  days: string[];
  cells: Record<string, MonthGridCell>;
  summary: { present: number; wfh: number; leave: number; absent: number; lateCount: number; earlyCount: number; lopDays: number };
};

/** The caller's own attendance for a month + a quick summary. */
export async function getMyAttendanceMonth(user: SessionUser, year: number, month: number): Promise<MyAttendance> {
  const me = await getEmployeeForUser(user.id);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  const days = Array.from({ length: endDate }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
  if (!me) return { isEmployee: false, days, cells: {}, summary: { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, earlyCount: 0, lopDays: 0 } };

  const recs = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, me.employeeId), gte(attendanceRecords.date, start), lte(attendanceRecords.date, end)))
    .orderBy(asc(attendanceRecords.date));

  const cells: Record<string, MonthGridCell> = {};
  const summary = { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, earlyCount: 0, lopDays: 0 };
  for (const r of recs) {
    const dayType = normalizeCompanyDayType(r.date, r.dayType);
    cells[r.date] = {
      date: r.date,
      dayType,
      isLate: r.isLate,
      lateMinutes: r.lateMinutes,
      isEarlyLeave: r.isEarlyLeave,
      earlyMinutes: r.earlyMinutes,
      lopDays: Number(r.lopDays),
    };
    if (dayType === "office" || dayType === "half-day") summary.present++;
    else if (dayType === "wfh") summary.wfh++;
    else if (dayType === "paid-leave" || dayType === "unpaid-leave") summary.leave++;
    else if (dayType === "absent") summary.absent++;
    if (r.isLate) summary.lateCount++;
    if (r.isEarlyLeave) summary.earlyCount++;
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

export type AttendanceBalanceEffect = { used: number; unpaid: number };

/** Leave-ledger units contributed by one HR/leave attendance mark. */
export function attendanceBalanceEffect(
  dayType: AttendanceDayType,
  lopDays = lopForDayType(dayType),
  halfDayPaidLeave = false,
): AttendanceBalanceEffect {
  if (dayType === "paid-leave") return { used: halfDayPaidLeave ? 0.5 : 1, unpaid: 0 };
  if (dayType === "half-day") return { used: 0.5, unpaid: 0 };
  if (dayType === "absent" || dayType === "unpaid-leave") {
    return { used: 0, unpaid: lopDays > 0 ? Math.min(1, lopDays) : 1 };
  }
  return { used: 0, unpaid: 0 };
}

type ExistingBalanceMark = {
  dayType: AttendanceDayType;
  source: "scanner" | "manual" | "import" | "leave" | "auto-off";
  lopDays: string;
} | null;

/**
 * Keep the Earned-leave ledger in step with HR's manual attendance decisions.
 * Imported/scanner rows are excluded because their opening used/unpaid totals
 * may already have been imported separately. App-created manual/leave rows are
 * safe to reverse and replace.
 */
async function syncAttendanceBalance(
  user: SessionUser,
  employeeId: number,
  date: string,
  previous: ExistingBalanceMark,
  nextDayType: AttendanceDayType,
): Promise<void> {
  const [earned] = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(eq(leaveTypes.code, "EL"))
    .limit(1);
  if (!earned) return;

  let before: AttendanceBalanceEffect = { used: 0, unpaid: 0 };
  if (previous && (previous.source === "manual" || previous.source === "leave")) {
    let halfDayPaidLeave = false;
    if (previous.source === "leave" && previous.dayType === "paid-leave") {
      const [half] = await db
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.startDate, date),
          eq(leaveRequests.endDate, date),
          eq(leaveRequests.isHalfDay, true),
          eq(leaveRequests.status, "approved"),
        ))
        .limit(1);
      halfDayPaidLeave = !!half;
    }
    before = attendanceBalanceEffect(previous.dayType, Number(previous.lopDays), halfDayPaidLeave);
    // A boundary day created by approval can contain half a paid day and half
    // an unpaid day. Its day type is half-day and lop_days carries the unpaid half.
    if (previous.source === "leave" && previous.dayType === "half-day" && Number(previous.lopDays) > 0) {
      before = { used: 0.5, unpaid: 0.5 };
    }
  }
  const after = attendanceBalanceEffect(nextDayType);
  const usedDelta = after.used - before.used;
  const unpaidDelta = after.unpaid - before.unpaid;
  if (usedDelta === 0 && unpaidDelta === 0) return;

  const year = Number(date.slice(0, 4));
  await db
    .insert(leaveBalances)
    .values({
      employeeId,
      leaveTypeId: earned.id,
      year,
      used: String(Math.max(0, usedDelta)),
      unpaidTaken: String(Math.max(0, unpaidDelta)),
      createdBy: user.id,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
      set: {
        used: sql`greatest(0, ${leaveBalances.used} + ${usedDelta})`,
        unpaidTaken: sql`greatest(0, ${leaveBalances.unpaidTaken} + ${unpaidDelta})`,
        updatedBy: user.id,
      },
    });
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
  const [existing] = await db
    .select({
      dayType: attendanceRecords.dayType,
      source: attendanceRecords.source,
      lopDays: attendanceRecords.lopDays,
    })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date)))
    .limit(1);
  const normalizedDayType = normalizeCompanyDayType(date, dayType);
  const lop = String(lopForDayType(normalizedDayType));
  const cleared = { isLate: false, lateMinutes: 0, isEarlyLeave: false, earlyMinutes: 0 };
  await db
    .insert(attendanceRecords)
    .values({
      employeeId,
      date,
      dayType: normalizedDayType,
      source: "manual",
      overriddenByUserId: user.id,
      lopDays: lop,
      ...cleared,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [attendanceRecords.employeeId, attendanceRecords.date],
      set: { dayType: normalizedDayType, lopDays: lop, source: "manual", overriddenByUserId: user.id, updatedBy: user.id, ...cleared },
    });
  await syncAttendanceBalance(user, employeeId, date, existing ?? null, normalizedDayType);
}

export type AttendanceExceptions = {
  isLate: boolean;
  lateMinutes: number;
  isEarlyLeave: boolean;
  earlyMinutes: number;
};

/** Set late / leaving-early flags and their minute counts on a present day. */
export async function setAttendanceExceptions(
  user: SessionUser,
  employeeId: number,
  date: string,
  input: AttendanceExceptions,
): Promise<void> {
  assertHrAccess(user);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Invalid date.");
  const lateMinutes = input.isLate ? input.lateMinutes : 0;
  const earlyMinutes = input.isEarlyLeave ? input.earlyMinutes : 0;
  for (const [label, value, active] of [
    ["late-coming", lateMinutes, input.isLate],
    ["leaving-early", earlyMinutes, input.isEarlyLeave],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 1440 || (active && value === 0)) {
      throw new UserError(`Enter ${label} time in minutes (1–1440).`);
    }
  }
  const [existing] = await db
    .select({ dayType: attendanceRecords.dayType })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date)))
    .limit(1);
  const dayType = existing?.dayType ?? "office";
  if (!["office", "wfh", "official-visit", "comp-off", "half-day"].includes(dayType)) {
    throw new UserError("Late coming and leaving early can only be set on a present day.");
  }
  await db
    .insert(attendanceRecords)
    .values({
      employeeId,
      date,
      dayType,
      source: "manual",
      overriddenByUserId: user.id,
      lopDays: "0",
      isLate: input.isLate,
      lateMinutes,
      isEarlyLeave: input.isEarlyLeave,
      earlyMinutes,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .onConflictDoUpdate({
      target: [attendanceRecords.employeeId, attendanceRecords.date],
      set: {
        isLate: input.isLate,
        lateMinutes,
        isEarlyLeave: input.isEarlyLeave,
        earlyMinutes,
        // An HR edit is authoritative; payroll intentionally ignores untouched
        // scanner flags but must count this manual decision.
        source: "manual",
        overriddenByUserId: user.id,
        updatedBy: user.id,
      },
    });
}

export type DayMark = {
  dayType: AttendanceDayType;
  isLate: boolean;
  lateMinutes: number;
  isEarlyLeave: boolean;
  earlyMinutes: number;
};

/** Every active employee's mark (if any) on a single date — for the day-wise marker. */
export async function getDayAttendance(user: SessionUser, date: string): Promise<Record<number, DayMark>> {
  assertHrAccess(user);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Invalid date.");
  const rows = await db
    .select({
      employeeId: attendanceRecords.employeeId,
      dayType: attendanceRecords.dayType,
      isLate: attendanceRecords.isLate,
      lateMinutes: attendanceRecords.lateMinutes,
      isEarlyLeave: attendanceRecords.isEarlyLeave,
      earlyMinutes: attendanceRecords.earlyMinutes,
    })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.date, date));
  const out: Record<number, DayMark> = {};
  for (const r of rows) {
    out[r.employeeId] = {
      dayType: normalizeCompanyDayType(date, r.dayType),
      isLate: r.isLate,
      lateMinutes: r.lateMinutes,
      isEarlyLeave: r.isEarlyLeave,
      earlyMinutes: r.earlyMinutes,
    };
  }
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
  const summary = { present: 0, wfh: 0, leave: 0, absent: 0, lateCount: 0, earlyCount: 0, lopDays: 0 };
  for (const r of recs) {
    const dayType = normalizeCompanyDayType(r.date, r.dayType);
    cells[r.date] = {
      date: r.date,
      dayType,
      isLate: r.isLate,
      lateMinutes: r.lateMinutes,
      isEarlyLeave: r.isEarlyLeave,
      earlyMinutes: r.earlyMinutes,
      lopDays: Number(r.lopDays),
    };
    if (dayType === "office" || dayType === "half-day") summary.present++;
    else if (dayType === "wfh") summary.wfh++;
    else if (dayType === "paid-leave" || dayType === "unpaid-leave") summary.leave++;
    else if (dayType === "absent") summary.absent++;
    if (r.isLate) summary.lateCount++;
    if (r.isEarlyLeave) summary.earlyCount++;
    summary.lopDays += Number(r.lopDays);
  }
  return { name: emp?.name ?? "", code: emp?.code ?? "", isEmployee: true, days, cells, summary };
}
