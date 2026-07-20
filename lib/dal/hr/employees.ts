import "server-only";

import { asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { employeeProfiles, shifts, users } from "@/lib/db/schema";
import { assertHrAccess, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import type { EmployeeStatus } from "@/lib/db/enums";

export type EmergencyContact = { name: string; relation: string; number: string };

export type RosterRow = {
  employeeId: number;
  userId: number;
  name: string;
  email: string;
  employeeCode: string;
  altCodes: string[];
  biometricId: string | null;
  shiftId: number | null;
  shiftName: string | null;
  monthlySalary: number;
  insuranceMonthly: number;
  tdsMonthly: number;
  professionalTax: number;
  dateOfJoining: string | null;
  status: EmployeeStatus;
};

export type ShiftRow = {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
};

export type CandidateUser = { id: number; name: string; email: string };

/** Full roster (active + inactive), newest code first. HR / super-admin only. */
export async function listEmployees(user: SessionUser): Promise<RosterRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select({
      employeeId: employeeProfiles.id,
      userId: employeeProfiles.userId,
      name: users.name,
      email: users.email,
      employeeCode: employeeProfiles.employeeCode,
      altCodes: employeeProfiles.altCodes,
      biometricId: employeeProfiles.biometricId,
      shiftId: employeeProfiles.shiftId,
      shiftName: shifts.name,
      monthlySalary: employeeProfiles.monthlySalary,
      insuranceMonthly: employeeProfiles.insuranceMonthly,
      tdsMonthly: employeeProfiles.tdsMonthly,
      professionalTax: employeeProfiles.professionalTax,
      dateOfJoining: employeeProfiles.dateOfJoining,
      status: employeeProfiles.status,
    })
    .from(employeeProfiles)
    .innerJoin(users, eq(employeeProfiles.userId, users.id))
    .leftJoin(shifts, eq(employeeProfiles.shiftId, shifts.id))
    .orderBy(asc(employeeProfiles.employeeCode));

  return rows.map((r) => ({
    ...r,
    monthlySalary: Number(r.monthlySalary),
    insuranceMonthly: Number(r.insuranceMonthly),
    tdsMonthly: Number(r.tdsMonthly),
    professionalTax: Number(r.professionalTax),
  }));
}

/** All shifts, for the profile shift picker. */
export async function listShifts(user: SessionUser): Promise<ShiftRow[]> {
  assertHrAccess(user);
  const rows = await db
    .select({
      id: shifts.id,
      name: shifts.name,
      startTime: shifts.startTime,
      endTime: shifts.endTime,
      graceMinutes: shifts.graceMinutes,
    })
    .from(shifts)
    .orderBy(asc(shifts.name));
  return rows;
}

/** App users who are not yet employees — candidates for "Enable as employee". */
export async function listCandidateUsers(user: SessionUser): Promise<CandidateUser[]> {
  assertHrAccess(user);
  const existing = await db
    .select({ userId: employeeProfiles.userId })
    .from(employeeProfiles);
  const takenIds = existing.map((e) => e.userId);
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(takenIds.length ? notInArray(users.id, takenIds) : undefined)
    .orderBy(asc(users.name));
  return rows;
}

export type EmployeeInput = {
  employeeCode: string;
  altCodes?: string[];
  biometricId?: string | null;
  dateOfJoining?: string | null;
  monthlySalary?: number;
  insuranceMonthly?: number;
  tdsMonthly?: number;
  professionalTax?: number;
  shiftId?: number | null;
  weeklyOffDay?: number | null;
  wfhDay?: number | null;
  dob?: string | null;
  pan?: string | null;
  aadhar?: string | null;
  phone?: string | null;
  emergencyContacts?: EmergencyContact[];
};

/** Flag an existing user as an employee by creating their profile. */
export async function enableEmployee(
  user: SessionUser,
  userId: number,
  input: EmployeeInput,
): Promise<{ employeeId: number }> {
  assertHrAccess(user);
  let row: { employeeId: number };
  try {
    [row] = await db
      .insert(employeeProfiles)
      .values({
        userId,
        employeeCode: input.employeeCode.trim(),
        altCodes: input.altCodes ?? [],
        biometricId: input.biometricId ?? null,
        dateOfJoining: input.dateOfJoining ?? null,
        monthlySalary: String(input.monthlySalary ?? 0),
        shiftId: input.shiftId ?? null,
        weeklyOffDay: input.weeklyOffDay ?? 0,
        wfhDay: input.wfhDay ?? 6,
        dob: input.dob ?? null,
        pan: input.pan ?? null,
        aadhar: input.aadhar ?? null,
        phone: input.phone ?? null,
        emergencyContacts: input.emergencyContacts ?? null,
      })
      .returning({ employeeId: employeeProfiles.id });
  } catch (e) {
    // Surface the two UNIQUE constraints (user_id, employee_code) as a clear message.
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      if (/employee_code/.test(msg)) throw new UserError(`Employee code "${input.employeeCode}" is already in use.`);
      throw new UserError("This user is already registered as an employee.");
    }
    throw e;
  }
  return { employeeId: row.employeeId };
}

/** Update an employee's HR profile. */
export async function updateEmployee(
  user: SessionUser,
  employeeId: number,
  input: EmployeeInput,
): Promise<void> {
  assertHrAccess(user);
  await db
    .update(employeeProfiles)
    .set({
      employeeCode: input.employeeCode.trim(),
      altCodes: input.altCodes ?? [],
      biometricId: input.biometricId ?? null,
      dateOfJoining: input.dateOfJoining ?? null,
      monthlySalary: String(input.monthlySalary ?? 0),
      insuranceMonthly: String(input.insuranceMonthly ?? 0),
      tdsMonthly: String(input.tdsMonthly ?? 0),
      professionalTax: String(input.professionalTax ?? 200),
      shiftId: input.shiftId ?? null,
      weeklyOffDay: input.weeklyOffDay ?? 0,
      wfhDay: input.wfhDay ?? 6,
      dob: input.dob ?? null,
      pan: input.pan ?? null,
      aadhar: input.aadhar ?? null,
      phone: input.phone ?? null,
      emergencyContacts: input.emergencyContacts ?? null,
    })
    .where(eq(employeeProfiles.id, employeeId));
}

/** Activate / deactivate an employee (never hard-deleted — preserves history). */
export async function setEmployeeStatus(
  user: SessionUser,
  employeeId: number,
  status: EmployeeStatus,
): Promise<void> {
  assertHrAccess(user);
  await db
    .update(employeeProfiles)
    .set({ status })
    .where(eq(employeeProfiles.id, employeeId));
}
