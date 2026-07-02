"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  enableEmployee,
  updateEmployee,
  setEmployeeStatus,
  type EmployeeInput,
} from "@/lib/dal/hr/employees";
import type { EmployeeStatus } from "@/lib/db/enums";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  console.error("[hr:employees]", e);
  return { ok: false, error: e instanceof Error ? e.message : "Could not save. Please try again." };
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
