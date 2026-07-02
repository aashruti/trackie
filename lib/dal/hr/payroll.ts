import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attendanceRecords, employeeProfiles, hrSettings, payrollRuns, payslips, users } from "@/lib/db/schema";
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

/** Cycle [start, end] (inclusive, ISO) for a run labelled by its END month.
 *  cycleStartDay=26 → run (2026, 6) = 2026-05-26 … 2026-06-25. */
export function cycleRange(year: number, month: number, cycleStartDay: number): { start: string; end: string; dates: string[] } {
  const startMs = Date.UTC(year, month - 2, cycleStartDay); // day cycleStartDay of the previous month
  const endMs = Date.UTC(year, month - 1, cycleStartDay - 1); // day (cycleStartDay-1) of the label month
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

type Settings = { cycleStartDay: number; lateLopMode: string; latesPerLopDay: number; absentIsLop: boolean };

async function loadSettings(): Promise<Settings> {
  const [s] = await db
    .select({
      cycleStartDay: hrSettings.cycleStartDay,
      lateLopMode: hrSettings.lateLopMode,
      latesPerLopDay: hrSettings.latesPerLopDay,
      absentIsLop: hrSettings.absentIsLop,
    })
    .from(hrSettings)
    .limit(1);
  return s ?? { cycleStartDay: 26, lateLopMode: "late-count", latesPerLopDay: 3, absentIsLop: true };
}

type EmpInput = {
  id: number;
  code: string;
  name: string;
  base: number;
  insurance: number;
  professionalTax: number;
  tds: number;
};
type RecInput = { dayType: AttendanceDayType; isLate: boolean; lopDays: string; source: string };

/** Pure engine: build one payslip line per active employee. No DB access.
 *  LOP is real unpaid time — raw scanner "absent" (no punch) is NOT auto-docked;
 *  only unpaid leave, HR-marked days, and the late-count policy reduce pay. */
export function computeLines(emps: EmpInput[], recsByEmp: Map<number, RecInput[]>, settings: Settings): PayslipLine[] {
  return emps
    .map((e) => {
      let presentDays = 0;
      let paidLeaveDays = 0;
      let lopFromDays = 0;
      let lateCount = 0;
      for (const r of recsByEmp.get(e.id) ?? []) {
        if (PRESENT_TYPES.includes(r.dayType)) presentDays += 1;
        else if (r.dayType === "half-day") presentDays += 0.5;
        else if (r.dayType === "paid-leave") paidLeaveDays += 1;
        // Scanner punches establish presence/times but are NOT authoritative for
        // loss-of-pay — unpaid time is an HR/leave decision (the manual grid import,
        // HR cell-overrides, or approved unpaid leave). So scanner-sourced days never
        // auto-dock pay; only import/manual/leave rows contribute LOP.
        if (r.source !== "scanner") lopFromDays += Number(r.lopDays);
        if (r.isLate) lateCount += 1;
      }
      const lopFromLate = settings.lateLopMode === "late-count" ? Math.floor(lateCount / Math.max(1, settings.latesPerLopDay)) : 0;
      const lopDays = round2(lopFromDays + lopFromLate);
      const pay = computePay({ gross: e.base, lopDays, insurance: e.insurance, professionalTax: e.professionalTax, tds: e.tds });
      const lopAmount = round2(pay.gross - pay.earnedGross);
      const breakdown: PayslipBreakdown = {
        gross: pay.gross,
        perDay: pay.perDay,
        daysInMonth: DAYS_IN_MONTH,
        presentDays,
        paidLeaveDays,
        lop: { fromDays: round2(lopFromDays), fromLate: lopFromLate, total: lopDays },
        lateCount,
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
        presentDays,
        paidLeaveDays,
        lopDays,
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
  const settings = await loadSettings();
  const cycle = cycleRange(year, month, settings.cycleStartDay);

  const [empRows, recRows] = await Promise.all([
    db
      .select({
        id: employeeProfiles.id,
        code: employeeProfiles.employeeCode,
        name: users.name,
        base: employeeProfiles.monthlySalary,
        insurance: employeeProfiles.insuranceMonthly,
        professionalTax: employeeProfiles.professionalTax,
        tds: employeeProfiles.tdsMonthly,
      })
      .from(employeeProfiles)
      .innerJoin(users, eq(employeeProfiles.userId, users.id))
      .where(eq(employeeProfiles.status, "active")),
    db
      .select({
        employeeId: attendanceRecords.employeeId,
        dayType: attendanceRecords.dayType,
        isLate: attendanceRecords.isLate,
        lopDays: attendanceRecords.lopDays,
        source: attendanceRecords.source,
      })
      .from(attendanceRecords)
      .where(and(gte(attendanceRecords.date, cycle.start), lte(attendanceRecords.date, cycle.end))),
  ]);

  const recsByEmp = new Map<number, RecInput[]>();
  for (const r of recRows) {
    const arr = recsByEmp.get(r.employeeId) ?? [];
    arr.push({ dayType: r.dayType, isLate: r.isLate, lopDays: r.lopDays, source: r.source });
    recsByEmp.set(r.employeeId, arr);
  }
  const emps: EmpInput[] = empRows.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    base: Number(e.base),
    insurance: Number(e.insurance),
    professionalTax: Number(e.professionalTax),
    tds: Number(e.tds),
  }));

  const lines = computeLines(emps, recsByEmp, settings);
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

  const cycleStartDay = (await loadSettings()).cycleStartDay;
  const cycle = cycleRange(run.year, run.month, cycleStartDay);
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

  const cycleStartDay = rows.length ? (await loadSettings()).cycleStartDay : 26;
  const slips: MyPayslip[] = rows.map((r) => {
    const cycle = cycleRange(r.year, r.month, cycleStartDay);
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
