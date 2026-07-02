import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  employeeProfiles,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
  attendanceRecords,
} from "@/lib/db/schema";
import { assertHrAccess, canManageHr, type SessionUser } from "@/lib/dal/authz";
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
    types: types.map((t) => {
      const b = byEmpType.get(`${e.employeeId}:${t.id}`);
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
    }),
  }));
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
  if (!req) throw new Error("Leave request not found");
  if (req.status !== "pending") throw new Error("This request has already been reviewed");

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

    // Balance-sufficiency guard for paid types (best-effort; the real ceiling is
    // enforced here before we claim the request).
    if (isPaid) {
      const [bal] = await db
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, employeeId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)))
        .limit(1);
      const available = n(bal?.carriedForward ?? "0") + n(bal?.accrued ?? "0") - n(bal?.used ?? "0");
      if (days > available) {
        throw new Error(
          `Insufficient ${req.leaveTypeName} balance: ${available} day(s) available, ${days} requested. Reduce the request or use an unpaid type.`,
        );
      }
    }
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
  if (!claimed.length) throw new Error("This request has already been reviewed");

  if (decision === "approved") {
    try {
      if (isPaid) {
        // Guarded atomic debit: a single UPDATE that only succeeds if enough
        // balance remains, so two concurrent sibling approvals can't both pass a
        // separate check and over-draw into negative.
        const debited = await db
          .update(leaveBalances)
          .set({ used: sql`${leaveBalances.used} + ${days}` })
          .where(
            and(
              eq(leaveBalances.employeeId, employeeId),
              eq(leaveBalances.leaveTypeId, leaveTypeId),
              eq(leaveBalances.year, year),
              sql`${leaveBalances.carriedForward} + ${leaveBalances.accrued} - ${leaveBalances.used} >= ${days}`,
            ),
          )
          .returning({ id: leaveBalances.id });
        if (!debited.length) {
          // No balance row for this year, or insufficient remaining balance.
          throw new Error(
            `Insufficient ${req.leaveTypeName} balance for ${days} day(s). Reduce the request or use an unpaid type.`,
          );
        }
      } else {
        // Unpaid leave has no ceiling — insert-or-increment atomically.
        await db
          .insert(leaveBalances)
          .values({ employeeId, leaveTypeId, year, unpaidTaken: String(days) })
          .onConflictDoUpdate({
            target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
            set: { unpaidTaken: sql`${leaveBalances.unpaidTaken} + ${days}` },
          });
      }

      // Write leave days into the attendance truth table — exactly the days that
      // were counted (exclude Sundays; a half-day is a single 0.5 day). Keeps the
      // balance debit and the attendance rows in agreement.
      const dayType: AttendanceDayType = isPaid ? "paid-leave" : "unpaid-leave";
      const dates = isHalf
        ? [req.startDate as string]
        : enumerateDates(req.startDate as string, req.endDate as string).filter(
            (d) => new Date(d + "T00:00:00Z").getUTCDay() !== 0,
          );
      const perDayLop = isPaid ? "0" : isHalf ? "0.5" : "1";
      if (dates.length) {
        await db
          .insert(attendanceRecords)
          .values(
            dates.map((d) => ({
              employeeId,
              date: d,
              dayType,
              source: "leave" as const,
              lopDays: perDayLop,
            })),
          )
          .onConflictDoNothing({ target: [attendanceRecords.employeeId, attendanceRecords.date] });
      }
    } catch (e) {
      // Compensate: never leave the request 'approved' with no balance/attendance
      // effect. Revert to 'pending' so HR can retry (or see the guard message).
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

export type SelfEmployee = { employeeId: number; name: string; employeeCode: string };

/** The caller's employee identity, or null if they aren't an employee. */
export async function getEmployeeForUser(userId: number): Promise<SelfEmployee | null> {
  const [row] = await db
    .select({
      employeeId: employeeProfiles.id,
      name: users.name,
      employeeCode: employeeProfiles.employeeCode,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(and(eq(employeeProfiles.userId, userId), eq(employeeProfiles.status, "active")))
    .limit(1);
  return row ?? null;
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
): Promise<{ requestId: number; employeeName: string; leaveTypeName: string; days: number; startDate: string; endDate: string }> {
  const me = await getEmployeeForUser(user.id);
  if (!me) throw new Error("You are not registered as an employee");
  if (input.endDate < input.startDate) throw new Error("End date is before start date");
  const days = countLeaveDays(input.startDate, input.endDate, input.isHalfDay);
  if (days <= 0) throw new Error("Selected range has no working days");

  const [type] = await db
    .select({ name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, input.leaveTypeId))
    .limit(1);
  if (!type) throw new Error("Unknown leave type");

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
 * Emails of everyone who can approve leave (HR + super-admin) AND has verified
 * their email — notification targets. Unverified addresses are never emailed.
 */
export async function hrRecipientEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email, role: users.role, verified: users.emailVerifiedAt })
    .from(users);
  return rows
    .filter((r) => canManageHr({ id: 0, role: r.role }) && r.verified != null)
    .map((r) => r.email);
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
