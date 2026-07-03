/**
 * Seed the HR module's configuration — idempotent.
 *  - Shifts (General / Early / Late)
 *  - hr_settings singleton (row id=1)
 *  - Leave types (Casual / Sick / Earned / Comp-off / Unpaid)
 *
 * Pass `--demo` to also flag every not-yet-employee app user as an employee
 * with a sequential DG#### code (DEV ONLY — for local preview).
 *
 * Run: npm run db:seed-hr        (config only)
 *      npm run db:seed-hr -- --demo
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { asc, eq, notInArray, sql } from "drizzle-orm";
// NOTE: db/client + schema are imported DYNAMICALLY inside main() — a static
// import is hoisted above config() and would read DATABASE_URL before dotenv
// loads it (mirrors scripts/db-migrate.ts).
type Db = typeof import("../lib/db/client").db;
type Schema = typeof import("../lib/db/schema");
let db: Db;
let employeeProfiles: Schema["employeeProfiles"];
let hrSettings: Schema["hrSettings"];
let leaveTypes: Schema["leaveTypes"];
let leaveBalances: Schema["leaveBalances"];
let leaveRequests: Schema["leaveRequests"];
let shifts: Schema["shifts"];
let users: Schema["users"];

const SHIFTS = [
  { name: "General", startTime: "10:00", endTime: "19:00", graceMinutes: 15, halfDayAfterMinutes: 180, earlyLeaveBeforeMinutes: 60, fullDayMinutes: 480 },
  { name: "Early", startTime: "08:00", endTime: "17:00", graceMinutes: 15, halfDayAfterMinutes: 180, earlyLeaveBeforeMinutes: 60, fullDayMinutes: 480 },
  { name: "Late", startTime: "11:00", endTime: "20:00", graceMinutes: 15, halfDayAfterMinutes: 180, earlyLeaveBeforeMinutes: 60, fullDayMinutes: 480 },
];

// Datagami runs a single Earned-leave bucket: 18/yr, 1.5/mo accrual, carry-forward.
// When it's exhausted the overflow becomes UNPAID leave = loss of pay (tracked as
// unpaidTaken on the same balance row; the Unpaid type is kept inactive, not applied for).
const LEAVE_TYPES = [
  { name: "Earned", code: "EL", isPaid: true, accrualMode: "monthly" as const, annualEntitlement: "18", monthlyAccrual: "1.5", active: true },
  { name: "Unpaid", code: "LWP", isPaid: false, accrualMode: "annual" as const, annualEntitlement: "0", monthlyAccrual: "0", active: false },
];

async function seedShifts() {
  const existing = await db.select({ name: shifts.name }).from(shifts);
  const have = new Set(existing.map((s) => s.name));
  const missing = SHIFTS.filter((s) => !have.has(s.name));
  if (missing.length) {
    await db.insert(shifts).values(missing);
    console.log(`  shifts: +${missing.length} (${missing.map((s) => s.name).join(", ")})`);
  } else {
    console.log("  shifts: already present");
  }
}

async function seedSettings() {
  const [row] = await db.select({ id: hrSettings.id }).from(hrSettings).limit(1);
  if (!row) {
    await db.insert(hrSettings).values({});
    console.log("  hr_settings: created singleton");
  } else {
    console.log("  hr_settings: already present");
  }
}

async function seedLeaveTypes() {
  const res = await db.insert(leaveTypes).values(LEAVE_TYPES).onConflictDoNothing({ target: leaveTypes.code });
  console.log(`  leave_types: ensured ${LEAVE_TYPES.length} (${res.rowCount ?? 0} new)`);
}

async function seedDemoEmployees() {
  const [general] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.name, "General")).limit(1);
  const taken = await db.select({ userId: employeeProfiles.userId }).from(employeeProfiles);
  const takenIds = taken.map((t) => t.userId);
  const candidates = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(takenIds.length ? notInArray(users.id, takenIds) : undefined)
    .orderBy(asc(users.id));
  if (!candidates.length) {
    console.log("  demo employees: none to add");
    return;
  }
  // Continue numbering after the highest existing DG#### code (not count(*),
  // which collides when codes are non-contiguous after a deletion).
  const existingCodes = await db
    .select({ code: employeeProfiles.employeeCode })
    .from(employeeProfiles);
  let seq = existingCodes.reduce((max, r) => {
    const m = /^DG(\d+)$/.exec(r.code);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  const salaries = [65000, 58000, 72000, 49000, 55000, 61000, 47000, 68000, 52000, 60000];
  const values = candidates.map((c, i) => {
    seq += 1;
    return {
      userId: c.id,
      employeeCode: `DG${String(seq).padStart(3, "0")}`,
      altCodes: [`TH${String(20 + seq).padStart(3, "0")}`],
      biometricId: String(seq),
      dateOfJoining: "2024-04-01",
      monthlySalary: String(salaries[i % salaries.length]),
      shiftId: general?.id ?? null,
      weeklyOffDay: 0,
      wfhDay: 6,
    };
  });
  await db.insert(employeeProfiles).values(values);
  console.log(`  demo employees: +${values.length} (${values.map((v) => v.employeeCode).join(", ")})`);
}

async function seedDemoLeave() {
  const year = new Date().getFullYear();
  const emps = await db
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.status, "active"))
    .orderBy(asc(employeeProfiles.id));
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.active, true));
  if (!emps.length || !types.length) {
    console.log("  demo leave: nothing to seed");
    return;
  }

  // Balances: give each active employee a plausible accrued + carry-forward ledger.
  const balRows = emps.flatMap((e) =>
    types.map((t) => ({
      employeeId: e.id,
      leaveTypeId: t.id,
      year,
      carriedForward: t.code === "EL" ? "5" : "0",
      accrued: String(Number(t.monthlyAccrual) * 6),
      used: "0",
      unpaidTaken: "0",
    })),
  );
  const balRes = await db
    .insert(leaveBalances)
    .values(balRows)
    .onConflictDoNothing({
      target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
    });
  console.log(`  leave balances: ensured ${balRows.length} (${balRes.rowCount ?? 0} new)`);

  // A few pending requests for the approvals queue (only if none pending yet).
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leaveRequests)
    .where(eq(leaveRequests.status, "pending"));
  if (Number(c) > 0) {
    console.log("  demo requests: pending requests already exist");
    return;
  }
  const byCode = new Map(types.map((t) => [t.code, t.id]));
  const samples = [
    { i: 0, code: "EL", startDate: `${year}-07-02`, endDate: `${year}-07-03`, isHalfDay: false, days: "2", reason: "Family function out of town." },
    { i: 1, code: "EL", startDate: `${year}-07-01`, endDate: `${year}-07-01`, isHalfDay: false, days: "1", reason: "Personal work." },
    { i: 2, code: "EL", startDate: `${year}-07-07`, endDate: `${year}-07-11`, isHalfDay: false, days: "5", reason: "Annual vacation with family." },
    { i: 3, code: "EL", startDate: `${year}-07-04`, endDate: `${year}-07-04`, isHalfDay: true, days: "0.5", reason: "Personal errand, half day." },
  ];
  const reqRows = samples
    .filter((s) => emps[s.i] && byCode.get(s.code))
    .map((s) => ({
      employeeId: emps[s.i].id,
      leaveTypeId: byCode.get(s.code)!,
      startDate: s.startDate,
      endDate: s.endDate,
      isHalfDay: s.isHalfDay,
      days: s.days,
      reason: s.reason,
    }));
  if (reqRows.length) {
    await db.insert(leaveRequests).values(reqRows);
    console.log(`  demo requests: +${reqRows.length} pending`);
  }
}

async function main() {
  ({ db } = await import("../lib/db/client"));
  const schema = await import("../lib/db/schema");
  ({ employeeProfiles, hrSettings, leaveTypes, leaveBalances, leaveRequests, shifts, users } = schema);

  console.log("Seeding HR config…");
  await seedShifts();
  await seedSettings();
  await seedLeaveTypes();
  if (process.argv.includes("--demo")) {
    await seedDemoEmployees();
    await seedDemoLeave();
  }
  console.log("HR seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error("HR seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
