import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attendanceRecords, employeeProfiles, leaveBalances, leaveTypes, payrollRuns, payslips, users } from "@/lib/db/schema";
import { assertHrAccess, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import { getEmployeeForUser } from "./leave";
import type { AttendanceDayType } from "@/lib/db/enums";

// Day types that count toward "present/worked" (half-day counts as 0.5).
const PRESENT_TYPES: AttendanceDayType[] = ["office", "wfh", "official-visit", "comp-off"];

const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- Pure pay computation (calibrated to the Datagami monthly salary sheet) --
// Standard Indian "30-day month" convention: per-day = gross ÷ 30, and the
// employee is paid for (30 − lopDays) days. Components are fixed % of gross.
// Net = earned + additions − insurance − professional tax − TDS (floored at 0).
export const SALARY_SPLIT = { basic: 0.4, hra: 0.16, other: 0.44 } as const;
export const DAYS_IN_MONTH = 30;
export const DEFAULT_PROFESSIONAL_TAX = 200; // ₹200/mo (Maharashtra PT), 0 for non-salaried

export type PayInput = {
  gross: number;
  lopDays: number;
  insurance?: number;
  professionalTax?: number;
  tds?: number;
  additions?: number;
  daysInMonth?: number;
};
export type PayComputed = {
  gross: number;
  basic: number;
  hra: number;
  otherAllowance: number;
  perDay: number;
  lopDays: number;
  daysWorked: number;
  earnedGross: number;
  insurance: number;
  professionalTax: number;
  tds: number;
  additions: number;
  netPay: number;
};

export function computePay(i: PayInput): PayComputed {
  const days = i.daysInMonth ?? DAYS_IN_MONTH;
  const gross = Math.max(0, i.gross);
  const lopDays = Math.min(days, Math.max(0, i.lopDays));
  const daysWorked = round2(days - lopDays);
  // Compute earned from gross directly (NOT rounded perDay) so full-month pay is exact.
  const earnedGross = round2((gross * daysWorked) / days);
  const insurance = Math.max(0, i.insurance ?? 0);
  const professionalTax = Math.max(0, i.professionalTax ?? 0);
  const tds = Math.max(0, i.tds ?? 0);
  const additions = i.additions ?? 0;
  const netPay = Math.max(0, round2(earnedGross + additions - insurance - professionalTax - tds));
  return {
    gross,
    basic: round2(gross * SALARY_SPLIT.basic),
    hra: round2(gross * SALARY_SPLIT.hra),
    otherAllowance: round2(gross * SALARY_SPLIT.other),
    perDay: round2(gross / days),
    lopDays,
    daysWorked,
    earnedGross,
    insurance,
    professionalTax,
    tds,
    additions,
    netPay,
  };
}

/** Payroll period [start, end] (inclusive, ISO) for a run labelled by `month`.
 *  cycleStartDay<=1 → the calendar month (2026,6 → 2026-06-01…2026-06-30).
 *  cycleStartDay=26 → the 26→25 cycle (2026,6 → 2026-05-26…2026-06-25). */
export function cycleRange(year: number, month: number, cycleStartDay: number): { start: string; end: string; dates: string[] } {
  const calendar = cycleStartDay <= 1;
  const startMs = calendar ? Date.UTC(year, month - 1, 1) : Date.UTC(year, month - 2, cycleStartDay);
  const endMs = calendar ? Date.UTC(year, month, 0) : Date.UTC(year, month - 1, cycleStartDay - 1);
  const dates: string[] = [];
  for (let t = startMs; t <= endMs; t += 86_400_000) {
    const d = new Date(t);
    dates.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return { start: dates[0], end: dates[dates.length - 1], dates };
}

export type PayslipBreakdown = {
  gross: number;
  perDay: number;
  daysInMonth: number;
  presentDays: number;
  paidLeaveDays: number;
  lop: { fromDays: number; fromLate: number; total: number };
  lateCount: number;
  daysWorked: number;
  earnedGross: number;
  basic: number;
  hra: number;
  otherAllowance: number;
  insurance: number;
  professionalTax: number;
  tds: number;
  additions: number;
  netPay: number;
};

export type PayslipLine = {
  employeeId: number;
  employeeCode: string;
  name: string;
  baseSalary: number; // gross
  perDay: number;
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
  daysWorked: number;
  earnedGross: number;
  basic: number;
  hra: number;
  otherAllowance: number;
  insurance: number;
  professionalTax: number;
  tds: number;
  additions: number;
  lopAmount: number; // gross − earned (the loss-of-pay deduction)
  netPay: number;
  breakdown: PayslipBreakdown | null;
};

export type PayrollPreview = {
  year: number;
  month: number;
  cycleStart: string;
  cycleEnd: string;
  lines: PayslipLine[];
  totals: { base: number; lop: number; net: number };
};

// Payroll v3 runs on the CALENDAR month — the leave-balance simulation is
// month-based, so the pay window must be too (the 26→25 cycle is retired here).
const CALENDAR_CYCLE = 1;

// Absence days that draw from the leave balance (leave taken). WFH / official
// visit / comp-off / holiday / weekly-off are worked-or-paid and don't. ½ = 0.5.
const ABSENCE_TYPES: AttendanceDayType[] = ["absent", "paid-leave", "unpaid-leave"];
export function absenceUnits(dayType: AttendanceDayType): number {
  if (ABSENCE_TYPES.includes(dayType)) return 1;
  if (dayType === "half-day") return 0.5;
  return 0;
}

/** Running-balance loss-of-pay for `targetMonth`: leave accrues `monthlyAccrual`
 *  each month and accumulates; that month's absences draw it down; any overdraw is
 *  the month's LOP and floors the balance at 0 (no negative carry to next month). */
export function runningMonthLop(
  absencesByMonth: Map<number, number>,
  startMonth: number,
  targetMonth: number,
  monthlyAccrual: number,
  carryForward: number,
): number {
  if (targetMonth < startMonth) return 0; // not yet employed
  let balance = carryForward;
  for (let m = startMonth; m <= targetMonth; m++) {
    // Accrue unrounded so odd entitlements (e.g. 20/yr → 1.666…/mo) don't drift.
    balance += monthlyAccrual;
    const abs = absencesByMonth.get(m) ?? 0;
    const over = abs > balance ? round2(abs - balance) : 0;
    balance = over > 0 ? 0 : balance - abs;
    if (m === targetMonth) return over;
  }
  return 0;
}

type EmpInput = {
  id: number;
  code: string;
  name: string;
  base: number;
  insurance: number;
  professionalTax: number;
  tds: number;
  lopDays: number; // loss-of-pay days for the payroll month (running-balance result)
  presentDays: number;
  paidLeaveDays: number;
  lateCount: number;
};

/** Build one payslip line per employee from precomputed month figures. No DB access. */
export function computeLines(emps: EmpInput[]): PayslipLine[] {
  return emps
    .map((e) => {
      const pay = computePay({ gross: e.base, lopDays: e.lopDays, insurance: e.insurance, professionalTax: e.professionalTax, tds: e.tds });
      const lopAmount = round2(pay.gross - pay.earnedGross);
      const breakdown: PayslipBreakdown = {
        gross: pay.gross,
        perDay: pay.perDay,
        daysInMonth: DAYS_IN_MONTH,
        presentDays: e.presentDays,
        paidLeaveDays: e.paidLeaveDays,
        lop: { fromDays: e.lopDays, fromLate: 0, total: e.lopDays },
        lateCount: e.lateCount,
        daysWorked: pay.daysWorked,
        earnedGross: pay.earnedGross,
        basic: pay.basic,
        hra: pay.hra,
        otherAllowance: pay.otherAllowance,
        insurance: pay.insurance,
        professionalTax: pay.professionalTax,
        tds: pay.tds,
        additions: pay.additions,
        netPay: pay.netPay,
      };
      return {
        employeeId: e.id,
        employeeCode: e.code,
        name: e.name,
        baseSalary: pay.gross,
        perDay: pay.perDay,
        presentDays: e.presentDays,
        paidLeaveDays: e.paidLeaveDays,
        lopDays: e.lopDays,
        daysWorked: pay.daysWorked,
        earnedGross: pay.earnedGross,
        basic: pay.basic,
        hra: pay.hra,
        otherAllowance: pay.otherAllowance,
        insurance: pay.insurance,
        professionalTax: pay.professionalTax,
        tds: pay.tds,
        additions: pay.additions,
        lopAmount,
        netPay: pay.netPay,
        breakdown,
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

async function buildPreview(year: number, month: number): Promise<PayrollPreview> {
  const cycle = cycleRange(year, month, CALENDAR_CYCLE);
  const yearStart = `${year}-01-01`;
  const monthOf = (iso: string) => Number(iso.slice(5, 7));

  const [empRows, recRows, [elType], balRows] = await Promise.all([
    db
      .select({
        id: employeeProfiles.id,
        code: employeeProfiles.employeeCode,
        name: users.name,
        base: employeeProfiles.monthlySalary,
        insurance: employeeProfiles.insuranceMonthly,
        professionalTax: employeeProfiles.professionalTax,
        tds: employeeProfiles.tdsMonthly,
        doj: employeeProfiles.dateOfJoining,
      })
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .where(eq(employeeProfiles.status, "active")),
    // All attendance from the year start through the payroll month — needed for the
    // running leave-balance simulation, not just this month.
    db
      .select({ employeeId: attendanceRecords.employeeId, date: attendanceRecords.date, dayType: attendanceRecords.dayType, isLate: attendanceRecords.isLate, source: attendanceRecords.source })
      .from(attendanceRecords)
      .where(and(gte(attendanceRecords.date, yearStart), lte(attendanceRecords.date, cycle.end))),
    db.select().from(leaveTypes).where(and(eq(leaveTypes.active, true), eq(leaveTypes.accrualMode, "monthly"))).limit(1),
    db.select({ employeeId: leaveBalances.employeeId, entitlement: leaveBalances.entitlement, carriedForward: leaveBalances.carriedForward }).from(leaveBalances).where(eq(leaveBalances.year, year)),
  ]);

  const defaultEntitlement = elType ? Number(elType.annualEntitlement) : 18;
  const balByEmp = new Map(balRows.map((b) => [b.employeeId, b]));

  // Per employee: absence units by month (scanner excluded), plus this month's
  // present / paid-leave / late tallies for the payslip breakdown.
  const absByEmpMonth = new Map<number, Map<number, number>>();
  const monthStats = new Map<number, { present: number; paidLeave: number; late: number }>();
  for (const r of recRows) {
    const m = monthOf(r.date);
    if (r.source !== "scanner") {
      const mm = absByEmpMonth.get(r.employeeId) ?? new Map<number, number>();
      const u = absenceUnits(r.dayType);
      if (u > 0) mm.set(m, round2((mm.get(m) ?? 0) + u));
      absByEmpMonth.set(r.employeeId, mm);
    }
    if (m === month) {
      const st = monthStats.get(r.employeeId) ?? { present: 0, paidLeave: 0, late: 0 };
      if (PRESENT_TYPES.includes(r.dayType)) st.present += 1;
      else if (r.dayType === "half-day") st.present += 0.5;
      else if (r.dayType === "paid-leave") st.paidLeave += 1;
      if (r.isLate) st.late += 1;
      monthStats.set(r.employeeId, st);
    }
  }

  const emps: EmpInput[] = empRows.map((e) => {
    const bal = balByEmp.get(e.id);
    const entitlement = bal?.entitlement != null ? Number(bal.entitlement) : defaultEntitlement;
    const monthlyAccrual = entitlement / 12;
    const carryForward = bal ? Number(bal.carriedForward) : 0;
    const doj = e.doj ?? null;
    const startMonth = doj && /^\d{4}-\d{2}/.test(doj) && Number(doj.slice(0, 4)) === year ? Number(doj.slice(5, 7)) : 1;
    const lopDays = runningMonthLop(absByEmpMonth.get(e.id) ?? new Map(), startMonth, month, monthlyAccrual, carryForward);
    const st = monthStats.get(e.id) ?? { present: 0, paidLeave: 0, late: 0 };
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      base: Number(e.base),
      insurance: Number(e.insurance),
      professionalTax: Number(e.professionalTax),
      tds: Number(e.tds),
      lopDays,
      presentDays: st.present,
      paidLeaveDays: st.paidLeave,
      lateCount: st.late,
    };
  });

  const lines = computeLines(emps);
  const totals = lines.reduce(
    (t, l) => ({ base: t.base + l.baseSalary, lop: t.lop + l.lopAmount, net: t.net + l.netPay }),
    { base: 0, lop: 0, net: 0 },
  );
  return { year, month, cycleStart: cycle.start, cycleEnd: cycle.end, lines, totals: { base: round2(totals.base), lop: round2(totals.lop), net: round2(totals.net) } };
}

/** Live preview for a cycle (does not persist). */
export async function previewPayroll(user: SessionUser, year: number, month: number): Promise<PayrollPreview> {
  assertHrAccess(user);
  return buildPreview(year, month);
}

export type PayrollRunRow = { id: number; month: number; year: number; status: "draft" | "finalized"; createdAt: Date; finalizedAt: Date | null; employees: number; totalNet: number };

/** All runs, newest cycle first, with a net-pay rollup. */
export async function listPayrollRuns(user: SessionUser): Promise<PayrollRunRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select({
      id: payrollRuns.id,
      month: payrollRuns.month,
      year: payrollRuns.year,
      status: payrollRuns.status,
      createdAt: payrollRuns.createdAt,
      finalizedAt: payrollRuns.finalizedAt,
      employees: sql<number>`count(${payslips.id})::int`,
      totalNet: sql<string>`coalesce(sum(${payslips.netPay}), 0)`,
    })
    .from(payrollRuns)
    .leftJoin(payslips, eq(payslips.runId, payrollRuns.id))
    .groupBy(payrollRuns.id)
    .orderBy(desc(payrollRuns.year), desc(payrollRuns.month));
  return rows.map((r) => ({ ...r, totalNet: Number(r.totalNet) }));
}

export type PayrollRunDetail = {
  run: { id: number; month: number; year: number; status: "draft" | "finalized"; cycleStart: string; cycleEnd: string; finalizedAt: Date | null };
  lines: PayslipLine[];
  totals: { base: number; lop: number; net: number };
};

/** A saved run with its payslip lines (from the persisted breakdown). */
export async function getPayrollRun(user: SessionUser, runId: number): Promise<PayrollRunDetail | null> {
  assertHrAccess(user);
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return null;
  const rows = await db
    .select({
      employeeId: payslips.employeeId,
      code: employeeProfiles.employeeCode,
      name: users.name,
      baseSalary: payslips.baseSalary,
      perDay: payslips.perDay,
      presentDays: payslips.presentDays,
      paidLeaveDays: payslips.paidLeaveDays,
      lopDays: payslips.lopDays,
      daysWorked: payslips.daysWorked,
      earnedGross: payslips.earnedGross,
      basic: payslips.basic,
      hra: payslips.hra,
      otherAllowance: payslips.otherAllowance,
      insurance: payslips.insurance,
      professionalTax: payslips.professionalTax,
      tds: payslips.tds,
      additions: payslips.additions,
      lopAmount: payslips.lopAmount,
      netPay: payslips.netPay,
      breakdown: payslips.breakdown,
    })
    .from(payslips)
    .innerJoin(employeeProfiles, eq(payslips.employeeId, employeeProfiles.id))
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .where(eq(payslips.runId, runId))
    .orderBy(employeeProfiles.employeeCode);

  const cycle = cycleRange(run.year, run.month, CALENDAR_CYCLE);
  const lines: PayslipLine[] = rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.code,
    name: r.name,
    baseSalary: Number(r.baseSalary),
    perDay: Number(r.perDay),
    presentDays: Number(r.presentDays),
    paidLeaveDays: Number(r.paidLeaveDays),
    lopDays: Number(r.lopDays),
    daysWorked: Number(r.daysWorked),
    earnedGross: Number(r.earnedGross),
    basic: Number(r.basic),
    hra: Number(r.hra),
    otherAllowance: Number(r.otherAllowance),
    insurance: Number(r.insurance),
    professionalTax: Number(r.professionalTax),
    tds: Number(r.tds),
    additions: Number(r.additions),
    lopAmount: Number(r.lopAmount),
    netPay: Number(r.netPay),
    breakdown: (r.breakdown as PayslipBreakdown | null),
  }));
  const totals = lines.reduce(
    (t, l) => ({ base: t.base + l.baseSalary, lop: t.lop + l.lopAmount, net: t.net + l.netPay }),
    { base: 0, lop: 0, net: 0 },
  );
  return {
    run: { id: run.id, month: run.month, year: run.year, status: run.status, cycleStart: cycle.start, cycleEnd: cycle.end, finalizedAt: run.finalizedAt },
    lines,
    totals: { base: round2(totals.base), lop: round2(totals.lop), net: round2(totals.net) },
  };
}

/** The saved run detail for a cycle (year, month), or null if none generated yet. */
export async function getRunForCycle(user: SessionUser, year: number, month: number): Promise<PayrollRunDetail | null> {
  assertHrAccess(user);
  const [run] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.month, month), eq(payrollRuns.year, year))).limit(1);
  return run ? getPayrollRun(user, run.id) : null;
}

/** Generate (or regenerate) a DRAFT run + payslips for a cycle. Refuses to touch a finalized run. */
export async function generatePayrollRun(user: SessionUser, year: number, month: number): Promise<{ runId: number; employees: number }> {
  assertHrAccess(user);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new UserError("Invalid month.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("Invalid year.");

  const [existing] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.month, month), eq(payrollRuns.year, year))).limit(1);
  if (existing?.status === "finalized") throw new UserError("This cycle is finalized and can't be regenerated.");

  const preview = await buildPreview(year, month);

  // Upsert the run (draft), then replace its payslips. neon-http has no interactive
  // transactions, so this runs as discrete statements — safe because a draft run's
  // slips are fully derived and idempotent per (year, month).
  let runId = existing?.id;
  if (runId) {
    await db.update(payrollRuns).set({ status: "draft", generatedByUserId: user.id }).where(eq(payrollRuns.id, runId));
    await db.delete(payslips).where(eq(payslips.runId, runId));
  } else {
    const [ins] = await db.insert(payrollRuns).values({ month, year, status: "draft", generatedByUserId: user.id }).returning({ id: payrollRuns.id });
    runId = ins.id;
  }

  if (preview.lines.length) {
    await db.insert(payslips).values(
      preview.lines.map((l) => ({
        runId: runId!,
        employeeId: l.employeeId,
        baseSalary: String(l.baseSalary),
        workingDays: String(DAYS_IN_MONTH),
        presentDays: String(l.presentDays),
        paidLeaveDays: String(l.paidLeaveDays),
        lopDays: String(l.lopDays),
        lopAmount: String(l.lopAmount),
        perDay: String(l.perDay),
        daysWorked: String(l.daysWorked),
        earnedGross: String(l.earnedGross),
        basic: String(l.basic),
        hra: String(l.hra),
        otherAllowance: String(l.otherAllowance),
        insurance: String(l.insurance),
        professionalTax: String(l.professionalTax),
        tds: String(l.tds),
        additions: String(l.additions),
        netPay: String(l.netPay),
        breakdown: l.breakdown,
      })),
    );
  }
  return { runId: runId!, employees: preview.lines.length };
}

/** Lock a draft run. */
export async function finalizePayrollRun(user: SessionUser, runId: number): Promise<void> {
  assertHrAccess(user);
  const res = await db
    .update(payrollRuns)
    .set({ status: "finalized", finalizedAt: sql`now()` })
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "draft")))
    .returning({ id: payrollRuns.id });
  if (!res.length) throw new UserError("Run not found or already finalized.");
}

export type MyPayslip = {
  runId: number;
  month: number;
  year: number;
  cycleStart: string;
  cycleEnd: string;
  baseSalary: number; // gross
  perDay: number;
  daysWorked: number;
  earnedGross: number;
  presentDays: number;
  paidLeaveDays: number;
  lopDays: number;
  lopAmount: number;
  basic: number;
  hra: number;
  otherAllowance: number;
  insurance: number;
  professionalTax: number;
  tds: number;
  additions: number;
  netPay: number;
  breakdown: PayslipBreakdown | null;
};

/** Self-service: the signed-in employee's FINALIZED payslips, newest first. */
export async function getMyPayslips(user: SessionUser): Promise<{ isEmployee: boolean; slips: MyPayslip[] }> {
  const emp = await getEmployeeForUser(user.id);
  if (!emp) return { isEmployee: false, slips: [] };
  const rows = await db
    .select({
      runId: payrollRuns.id,
      month: payrollRuns.month,
      year: payrollRuns.year,
      baseSalary: payslips.baseSalary,
      perDay: payslips.perDay,
      daysWorked: payslips.daysWorked,
      earnedGross: payslips.earnedGross,
      presentDays: payslips.presentDays,
      paidLeaveDays: payslips.paidLeaveDays,
      lopDays: payslips.lopDays,
      lopAmount: payslips.lopAmount,
      basic: payslips.basic,
      hra: payslips.hra,
      otherAllowance: payslips.otherAllowance,
      insurance: payslips.insurance,
      professionalTax: payslips.professionalTax,
      tds: payslips.tds,
      additions: payslips.additions,
      netPay: payslips.netPay,
      breakdown: payslips.breakdown,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id))
    .where(and(eq(payslips.employeeId, emp.employeeId), eq(payrollRuns.status, "finalized")))
    .orderBy(desc(payrollRuns.year), desc(payrollRuns.month));

  const slips: MyPayslip[] = rows.map((r) => {
    const cycle = cycleRange(r.year, r.month, CALENDAR_CYCLE);
    return {
      runId: r.runId,
      month: r.month,
      year: r.year,
      cycleStart: cycle.start,
      cycleEnd: cycle.end,
      baseSalary: Number(r.baseSalary),
      perDay: Number(r.perDay),
      daysWorked: Number(r.daysWorked),
      earnedGross: Number(r.earnedGross),
      presentDays: Number(r.presentDays),
      paidLeaveDays: Number(r.paidLeaveDays),
      lopDays: Number(r.lopDays),
      lopAmount: Number(r.lopAmount),
      basic: Number(r.basic),
      hra: Number(r.hra),
      otherAllowance: Number(r.otherAllowance),
      insurance: Number(r.insurance),
      professionalTax: Number(r.professionalTax),
      tds: Number(r.tds),
      additions: Number(r.additions),
      netPay: Number(r.netPay),
      breakdown: (r.breakdown as PayslipBreakdown | null),
    };
  });
  return { isEmployee: true, slips };
}
