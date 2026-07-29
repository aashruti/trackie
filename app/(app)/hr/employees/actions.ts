"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  createEmployee,
  enableEmployee,
  updateEmployee,
  setEmployeeStatus,
  type EmployeeInput,
  type NewEmployeeIdentity,
} from "@/lib/dal/hr/employees";
import { isUserError } from "@/lib/dal/errors";
import type { EmployeeStatus } from "@/lib/db/enums";
import { makeVerifyToken } from "@/lib/auth/email-verify";
import { sendVerificationEmail } from "@/lib/email/verify";
import { appBaseUrl } from "@/lib/http/base-url";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  console.error("[hr:employees]", e);
  return { ok: false, error: isUserError(e) ? e.message : "Could not save. Please try again." };
}

export async function enableEmployeeAction(userId: number, input: EmployeeInput): Promise<ActionResult> {
  try {
    await enableEmployee(await actor(), userId, input);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/hr/employees");
  return { ok: true };
}

export async function createEmployeeAction(
  identity: NewEmployeeIdentity,
  input: EmployeeInput,
): Promise<ActionResult> {
  let created;
  try {
    created = await createEmployee(await actor(), identity, input);
  } catch (e) {
    return fail(e);
  }
  // Best-effort verification email, matching Admin → Add user. Account/profile
  // creation remains successful even when email delivery is temporarily down.
  try {
    const email = identity.email.trim().toLowerCase();
    const token = makeVerifyToken(created.userId, email);
    const link = `${await appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail(email, identity.name.trim(), link);
  } catch (e) {
    console.error("[hr:employees] verification email failed", e);
  }
  revalidatePath("/hr/employees");
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateEmployeeAction(employeeId: number, input: EmployeeInput): Promise<ActionResult> {
  try {
    await updateEmployee(await actor(), employeeId, input);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/hr/employees");
  return { ok: true };
}

export async function setEmployeeStatusAction(employeeId: number, status: EmployeeStatus): Promise<ActionResult> {
  try {
    await setEmployeeStatus(await actor(), employeeId, status);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/hr/employees");
  return { ok: true };
}
