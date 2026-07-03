import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employeeProfiles,
  hrSettings,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
  attendanceRecords,
} from "@/lib/db/schema";
import { assertHrAccess, canManageHr, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import type { AttendanceDayType, LeaveRequestStatus } from "@/lib/db/enums";

export type LeaveTypeRow = {
  id: number;
  name: string;
  code: string;
  isPaid: boolean;
  annualEntitlement: number;
  monthlyAccrual: number;
};

export type LeaveRequestRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  leaveTypeId: number;
  leaveTypeName: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

export type BalanceLedgerRow = {
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  dateOfJoining: string | null;
  types: {
    leaveTypeId: number;
    code: string;
    name: string;
    entitlement: number;
    carriedForward: number;
    accrued: number;
    used: number;
    unpaidTaken: number;
    pending: number; // carriedForward + accrued − used
  }[];
};

function n(v: string | number | null): number {
  return v == null ? 0 : Number(v);
}
const round2 = (x: number) => Math.round(x * 100) / 100;

export async function listLeaveTypes(user: SessionUser): Promise<LeaveTypeRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.active, true))
    .orderBy(asc(leaveTypes.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    isPaid: r.isPaid,
    annualEntitlement: n(r.annualEntitlement),
    monthlyAccrual: n(r.monthlyAccrual),
  }));
}

/** Active leave types, no HR gate — for the employee self-service apply form. */
export async function listLeaveTypesPublic(): Promise<LeaveTypeRow[]> {
  const rows = await db
    .select()
    .from(leaveTypes)
    .where(eq(leaveTypes.active, true))
    .orderBy(asc(leaveTypes.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    isPaid: r.isPaid,
    annualEntitlement: n(r.annualEntitlement),
    monthlyAccrual: n(r.monthlyAccrual),
  }));
}

const requestSelect = {
  id: leaveRequests.id,
  employeeId: leaveRequests.employeeId,
  employeeName: users.name,
  employeeCode: employeeProfiles.employeeCode,
  employeeEmail: users.email,
  employeeEmailVerified: users.emailVerifiedAt,
  leaveTypeId: leaveRequests.leaveTypeId,
  leaveTypeName: leaveTypes.name,
  leaveTypeCode: leaveTypes.code,
  startDate: leaveRequests.startDate,
  endDate: leaveRequests.endDate,
  isHalfDay: leaveRequests.isHalfDay,
  days: leaveRequests.days,
  reason: leaveRequests.reason,
  status: leaveRequests.status,
  reviewedAt: leaveRequests.reviewedAt,
  createdAt: leaveRequests.createdAt,
};

function mapRequest(r: Record<string, unknown>): LeaveRequestRow {
  return {
    id: r.id as number,
    employeeId: r.employeeId as number,
    employeeName: r.employeeName as string,
    employeeCode: r.employeeCode as string,
    employeeEmail: r.employeeEmail as string,
    leaveTypeId: r.leaveTypeId as number,
    leaveTypeName: r.leaveTypeName as string,
    leaveTypeCode: r.leaveTypeCode as string,
    startDate: r.startDate as string,
    endDate: r.endDate as string,
    isHalfDay: r.isHalfDay as boolean,
    days: n(r.days as string),
    reason: r.reason as string,
    status: r.status as LeaveRequestStatus,
    reviewedByName: null,
    reviewedAt: (r.reviewedAt as Date | null) ?? null,
    createdAt: r.createdAt as Date,
  };
}

/** Pending approvals queue (oldest first). */
export async function listPendingRequests(user: SessionUser): Promise<LeaveRequestRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select(requestSelect)
    .from(leaveRequests)
    .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.status, "pending"))
    .orderBy(asc(leaveRequests.createdAt));
  return rows.map(mapRequest);
}

/** All requests, newest first (optionally filtered by status). */
export async function listAllRequests(
  user: SessionUser,
  status?: LeaveRequestStatus,
): Promise<LeaveRequestRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select(requestSelect)
    .from(leaveRequests)
    .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(status ? eq(leaveRequests.status, status) : undefined)
    .orderBy(desc(leaveRequests.createdAt));
  return rows.map(mapRequest);
}

/** Per-employee balance ledger for a calendar year. */
export async function listBalanceLedger(
  user: SessionUser,
  year: number,
): Promise<BalanceLedgerRow[]> {
  assertHrAccess(user);
  const emps = await db
    .select({
      employeeId: employeeProfiles.id,
      employeeName: users.name,
      employeeCode: employeeProfiles.employeeCode,
      dateOfJoining: employeeProfiles.dateOfJoining,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(eq(employeeProfiles.status, "active"))
    .orderBy(asc(employeeProfiles.employeeCode));
  if (!emps.length) return [];

  const empIds = emps.map((e) => e.employeeId);
  const [types, balances] = await Promise.all([
    db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(asc(leaveTypes.name)),
    db
      .select()
      .from(leaveBalances)
      .where(and(inArray(leaveBalances.employeeId, empIds), eq(leaveBalances.year, year))),
  ]);

  const byEmpType = new Map<string, (typeof balances)[number]>();
  for (const b of balances) byEmpType.set(`${b.employeeId}:${b.leaveTypeId}`, b);

  return emps.map((e) => ({
    employeeId: e.employeeId,
    employeeName: e.employeeName,
    employeeCode: e.employeeCode,
    dateOfJoining: e.dateOfJoining ?? null,
    types: types.map((t) => {
      const b = byEmpType.get(`${e.employeeId}:${t.id}`);
      const carriedForward = n(b?.carriedForward ?? "0");
      const accrued = n(b?.accrued ?? "0");
      const used = n(b?.used ?? "0");
      return {
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        entitlement: b?.entitlement != null ? n(b.entitlement) : n(t.annualEntitlement),
        carriedForward,
        accrued,
        used,
        unpaidTaken: n(b?.unpaidTaken ?? "0"),
        pending: carriedForward + accrued - used,
      };
    }),
  }));
}

/** HR sets an employee's balance for a leave type + year (upsert; preserves unpaidTaken). */
export async function setLeaveBalance(
  user: SessionUser,
  employeeId: number,
  leaveTypeId: number,
  year: number,
  values: { entitlement: number; carriedForward: number; accrued: number; used: number },
): Promise<void> {
  assertHrAccess(user);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("Invalid year.");
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new UserError(`Invalid ${k} value.`);
  }
  const set = {
    entitlement: String(values.entitlement),
    carriedForward: String(values.carriedForward),
    accrued: String(values.accrued),
    used: String(values.used),
  };
  await db
    .insert(leaveBalances)
    .values({ employeeId, leaveTypeId, year, ...set })
    .onConflictDoUpdate({
      target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
      set,
    });
}

/** Months of accrual an employee has earned in `year` as of the reference month —
 *  pro-rated from date-of-joining (join in-year → accrue from the join month). */
export function monthsAccruedToDate(doj: string | null, year: number, asOfMonth: number): number {
  let startMonth = 1;
  if (doj && /^\d{4}-\d{2}/.test(doj)) {
    const dy = Number(doj.slice(0, 4));
    const dm = Number(doj.slice(5, 7));
    if (dy > year) return 0; // joined after this leave year
    if (dy === year) startMonth = dm; // joined mid-year → accrue from join month
    // joined before this year → full year (startMonth stays 1)
  }
  return Math.max(0, Math.min(12, asOfMonth - startMonth + 1));
}

/** The reference month for "accrue to date": the current month for the ongoing
 *  year, the full 12 for a past year, 0 for a future year. */
function asOfMonthFor(year: number): number {
  const now = new Date();
  const cy = now.getUTCFullYear();
  if (year < cy) return 12;
  if (year > cy) return 0;
  return now.getUTCMonth() + 1;
}

// Accrued-to-date = months elapsed × the monthly rate (entitlement / 12), so a
// per-employee entitlement override scales the accrual (higher/lower leave count).
const proRataAccrued = (doj: string | null, year: number, entitlement: number) =>
  round2(monthsAccruedToDate(doj, year, asOfMonthFor(year)) * (entitlement / 12));

/** Bulk: set every active employee's accrued (for each monthly-accruing type) to
 *  its pro-rata to-date value, honouring each row's entitlement override. */
export async function accrueAllToDate(user: SessionUser, year: number): Promise<{ employees: number }> {
  assertHrAccess(user);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("Invalid year.");
  const [emps, types] = await Promise.all([
    db.select({ id: employeeProfiles.id, doj: employeeProfiles.dateOfJoining }).from(employeeProfiles).where(eq(employeeProfiles.status, "active")),
    db.select().from(leaveTypes).where(and(eq(leaveTypes.active, true), eq(leaveTypes.accrualMode, "monthly"))),
  ]);
  const empIds = emps.map((e) => e.id);
  const balances = empIds.length
    ? await db
        .select({ employeeId: leaveBalances.employeeId, leaveTypeId: leaveBalances.leaveTypeId, entitlement: leaveBalances.entitlement })
        .from(leaveBalances)
        .where(and(inArray(leaveBalances.employeeId, empIds), eq(leaveBalances.year, year)))
    : [];
  const override = new Map<string, number>();
  for (const b of balances) if (b.entitlement != null) override.set(`${b.employeeId}:${b.leaveTypeId}`, n(b.entitlement));

  const rows = types.flatMap((t) =>
    emps.map((e) => {
      const ent = override.get(`${e.id}:${t.id}`) ?? n(t.annualEntitlement);
      return { employeeId: e.id, leaveTypeId: t.id, year, accrued: String(proRataAccrued(e.doj ?? null, year, ent)) };
    }),
  );
  if (rows.length) {
    // Update only `accrued` — the entitlement override and other columns are preserved.
    await db
      .insert(leaveBalances)
      .values(rows)
      .onConflictDoUpdate({ target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year], set: { accrued: sql`excluded.accrued` } });
  }
  return { employees: emps.length };
}

/** Approve or reject a pending request. Debits balance + writes leave days on approve. */
export async function reviewLeaveRequest(
  user: SessionUser,
  requestId: number,
  decision: "approved" | "rejected",
  note: string | null,
): Promise<{
  employeeName: string;
  employeeEmail: string;
  employeeEmailVerified: boolean;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: number;
  decision: "approved" | "rejected";
}> {
  assertHrAccess(user);
  const [req] = await db
    .select(requestSelect)
    .from(leaveRequests)
    .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.id, requestId))
    .limit(1);
  if (!req) throw new UserError("Leave request not found");
  if (req.status !== "pending") throw new UserError("This request has already been reviewed");

  const employeeId = req.employeeId as number;
  const leaveTypeId = req.leaveTypeId as number;
  const days = n(req.days);
  const isHalf = req.isHalfDay as boolean;
  // Calendar-year balances: a leave crossing New Year still debits its start year
  // (a documented limitation — leave rarely spans the boundary).
  const year = new Date((req.startDate as string) + "T00:00:00Z").getUTCFullYear();

  let isPaid = true;
  if (decision === "approved") {
    const [type] = await db
      .select({ isPaid: leaveTypes.isPaid })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, leaveTypeId))
      .limit(1);
    isPaid = type?.isPaid ?? true;
    // No reject-on-insufficient guard: paid (Earned) leave beyond the balance
    // overflows into unpaid leave (= loss of pay) at approval, rather than blocking.
  }

  // Atomically claim the request: only one caller can flip it out of 'pending',
  // so a double-click / concurrent approval can't double-process it. (neon-http
  // has no interactive transactions, so we use per-statement atomicity + a
  // compensating revert below instead of a wrapping tx.)
  const claimed = await db
    .update(leaveRequests)
    .set({ status: decision, reviewedByUserId: user.id, reviewedAt: new Date(), reviewNote: note })
    .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, "pending")))
    .returning({ id: leaveRequests.id });
  if (!claimed.length) throw new UserError("This request has already been reviewed");

  if (decision === "approved") {
    // Split the request into paid days (covered by the Earned balance) and unpaid
    // days (overflow = loss of pay). The paid budget is drawn down greedily so a
    // fractional balance is used to the half-day (never forfeited): a boundary day
    // that's half-covered becomes a half-day (0.5 paid / 0.5 unpaid).
    const dates = isHalf
      ? [req.startDate as string]
      : enumerateDates(req.startDate as string, req.endDate as string).filter((d) => new Date(d + "T00:00:00Z").getUTCDay() !== 0);

    let available = Infinity; // unpaid types never draw a balance
    if (isPaid) {
      const [bal] = await db
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)))
        .limit(1);
      available = Math.max(0, n(bal?.carriedForward ?? "0") + n(bal?.accrued ?? "0") - n(bal?.used ?? "0"));
    } else {
      available = 0;
    }

    const EPS = 1e-9;
    let paidDays = 0;
    let rows: { employeeId: number; date: string; dayType: AttendanceDayType; source: "leave"; lopDays: string }[] = [];
    if (isHalf) {
      const paid = available >= days - EPS; // half-day is paid iff fully covered
      paidDays = paid ? days : 0;
      rows = [{ employeeId, date: dates[0], dayType: paid ? "paid-leave" : "unpaid-leave", source: "leave", lopDays: paid ? "0" : "0.5" }];
    } else {
      let budget = Math.min(days, available);
      rows = dates.map((d) => {
        if (budget >= 1 - EPS) {
          budget -= 1;
          paidDays += 1;
          return { employeeId, date: d, dayType: "paid-leave" as AttendanceDayType, source: "leave" as const, lopDays: "0" };
        }
        if (budget >= 0.5 - EPS) {
          budget -= 0.5;
          paidDays += 0.5;
          return { employeeId, date: d, dayType: "half-day" as AttendanceDayType, source: "leave" as const, lopDays: "0.5" };
        }
        return { employeeId, date: d, dayType: "unpaid-leave" as AttendanceDayType, source: "leave" as const, lopDays: "1" };
      });
    }
    paidDays = round2(paidDays);
    const unpaidDays = round2(days - paidDays);

    let balanceApplied = false;
    try {
      // Balance: used += paidDays, unpaidTaken += unpaidDays (on this type's row).
      if (paidDays > 0 || unpaidDays > 0) {
        await db
          .insert(leaveBalances)
          .values({ employeeId, leaveTypeId, year, used: String(paidDays), unpaidTaken: String(unpaidDays) })
          .onConflictDoUpdate({
            target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
            set: { used: sql`${leaveBalances.used} + ${paidDays}`, unpaidTaken: sql`${leaveBalances.unpaidTaken} + ${unpaidDays}` },
          });
        balanceApplied = true;
      }

      // Attendance truth table. Leave beats an auto-applied SCANNER row (so unpaid
      // days count as LOP), but a deliberate HR decision — a manual cell override or
      // an imported grid day — wins over leave and is left untouched.
      if (dates.length) {
        await db
          .insert(attendanceRecords)
          .values(rows)
          .onConflictDoUpdate({
            target: [attendanceRecords.employeeId, attendanceRecords.date],
            set: { dayType: sql`excluded.day_type`, lopDays: sql`excluded.lop_days`, source: sql`excluded.source` },
            setWhere: sql`${attendanceRecords.source} in ('scanner', 'leave')`,
          });
      }
    } catch (e) {
      // Compensate under neon-http (no interactive tx): undo the balance debit if it
      // landed, then revert the request to 'pending' so a retry can't double-count.
      if (balanceApplied) {
        await db
          .update(leaveBalances)
          .set({ used: sql`${leaveBalances.used} - ${paidDays}`, unpaidTaken: sql`${leaveBalances.unpaidTaken} - ${unpaidDays}` })
          .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)));
      }
      await db
        .update(leaveRequests)
        .set({ status: "pending", reviewedByUserId: null, reviewedAt: null, reviewNote: null })
        .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, "approved")));
      throw e;
    }
  }

  return {
    employeeName: req.employeeName as string,
    employeeEmail: req.employeeEmail as string,
    employeeEmailVerified: req.employeeEmailVerified != null,
    leaveTypeName: req.leaveTypeName as string,
    startDate: req.startDate as string,
    endDate: req.endDate as string,
    days,
    decision,
  };
}

/* ------------------------------------------------------------------ *
 * Self-service (an employee acting on their own leave)               *
 * ------------------------------------------------------------------ */

export type SelfEmployee = {
  employeeId: number;
  name: string;
  employeeCode: string;
  email: string;
  emailVerified: boolean;
};

/** The caller's employee identity, or null if they aren't an employee. */
export async function getEmployeeForUser(userId: number): Promise<SelfEmployee | null> {
  const [row] = await db
    .select({
      employeeId: employeeProfiles.id,
      name: users.name,
      employeeCode: employeeProfiles.employeeCode,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(and(eq(employeeProfiles.userId, userId), eq(employeeProfiles.status, "active")))
    .limit(1);
  if (!row) return null;
  return {
    employeeId: row.employeeId,
    name: row.name,
    employeeCode: row.employeeCode,
    email: row.email,
    emailVerified: row.emailVerifiedAt != null,
  };
}

/** Count leave days: half-day → 0.5, else inclusive span minus Sundays. */
export function countLeaveDays(start: string, end: string, isHalfDay: boolean): number {
  if (isHalfDay) return 0.5;
  const dates = enumerateDates(start, end);
  return dates.filter((d) => new Date(d + "T00:00:00Z").getUTCDay() !== 0).length;
}

export type ApplyLeaveInput = {
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  reason: string;
};

/** Employee applies for leave (status pending). Returns the row for notifying HR. */
export async function applyForLeave(
  user: SessionUser,
  input: ApplyLeaveInput,
): Promise<{
  requestId: number;
  employeeName: string;
  employeeEmail: string;
  employeeEmailVerified: boolean;
  leaveTypeName: string;
  days: number;
  startDate: string;
  endDate: string;
}> {
  const me = await getEmployeeForUser(user.id);
  if (!me) throw new UserError("You are not registered as an employee");
  if (input.endDate < input.startDate) throw new UserError("End date is before start date");
  const days = countLeaveDays(input.startDate, input.endDate, input.isHalfDay);
  if (days <= 0) throw new UserError("Selected range has no working days");

  const [type] = await db
    .select({ name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, input.leaveTypeId))
    .limit(1);
  if (!type) throw new UserError("Unknown leave type");

  const [row] = await db
    .insert(leaveRequests)
    .values({
      employeeId: me.employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay: input.isHalfDay,
      days: String(days),
      reason: input.reason.trim(),
    })
    .returning({ id: leaveRequests.id });

  return {
    requestId: row.id,
    employeeName: me.name,
    employeeEmail: me.email,
    employeeEmailVerified: me.emailVerified,
    leaveTypeName: type.name,
    days,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}

/** The caller's own leave requests, newest first. */
export async function listMyRequests(user: SessionUser): Promise<LeaveRequestRow[]> {
  const me = await getEmployeeForUser(user.id);
  if (!me) return [];
  const rows = await db
    .select(requestSelect)
    .from(leaveRequests)
    .innerJoin(employeeProfiles, eq(leaveRequests.employeeId, employeeProfiles.id))
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.employeeId, me.employeeId))
    .orderBy(desc(leaveRequests.createdAt));
  return rows.map(mapRequest);
}

/** The caller's own balances (single-employee ledger) for a year. */
export async function listMyBalances(
  user: SessionUser,
  year: number,
): Promise<BalanceLedgerRow["types"]> {
  const me = await getEmployeeForUser(user.id);
  if (!me) return [];
  const [types, balances] = await Promise.all([
    db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(asc(leaveTypes.name)),
    db
      .select()
      .from(leaveBalances)
      .where(and(eq(leaveBalances.employeeId, me.employeeId), eq(leaveBalances.year, year))),
  ]);
  const byType = new Map(balances.map((b) => [b.leaveTypeId, b]));
  return types.map((t) => {
    const b = byType.get(t.id);
    const carriedForward = n(b?.carriedForward ?? "0");
    const accrued = n(b?.accrued ?? "0");
    const used = n(b?.used ?? "0");
    return {
      leaveTypeId: t.id,
      code: t.code,
      name: t.name,
      entitlement: n(t.annualEntitlement),
      carriedForward,
      accrued,
      used,
      unpaidTaken: n(b?.unpaidTaken ?? "0"),
      pending: carriedForward + accrued - used,
    };
  });
}

/**
 * Recipients for leave-application notifications:
 *  - individual HR / super-admin users who have VERIFIED their email, plus
 *  - the shared HR inbox from hr_settings.notification_email (a controlled
 *    address, so no verification is required for it).
 * Deduplicated, lowercased.
 */
export async function hrRecipientEmails(): Promise<string[]> {
  const [rows, settings] = await Promise.all([
    db.select({ email: users.email, role: users.role, verified: users.emailVerifiedAt }).from(users),
    db.select({ email: hrSettings.notificationEmail }).from(hrSettings).limit(1),
  ]);
  const verified = rows
    .filter((r) => canManageHr({ id: 0, role: r.role }) && r.verified != null)
    .map((r) => r.email);
  const shared = settings[0]?.email?.trim();
  const all = shared ? [...verified, shared] : verified;
  return [...new Set(all.map((e) => e.toLowerCase()))];
}

/** Inclusive list of ISO dates between start and end (bounded to 366). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  let guard = 0;
  while (d <= last && guard < 366) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
  }
  return out;
}
