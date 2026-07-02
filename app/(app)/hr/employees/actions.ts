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

export async function enableEmployeeAction(userId: number, input: EmployeeInput) {
  await enableEmployee(await actor(), userId, input);
  revalidatePath("/hr/employees");
  return { ok: true };
}

export async function updateEmployeeAction(employeeId: number, input: EmployeeInput) {
  await updateEmployee(await actor(), employeeId, input);
  revalidatePath("/hr/employees");
  return { ok: true };
}

export async function setEmployeeStatusAction(employeeId: number, status: EmployeeStatus) {
  await setEmployeeStatus(await actor(), employeeId, status);
  revalidatePath("/hr/employees");
  return { ok: true };
}
