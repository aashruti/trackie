"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { generatePayrollRun, finalizePayrollRun } from "@/lib/dal/hr/payroll";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export async function generatePayrollAction(
  year: number,
  month: number,
): Promise<{ ok: true; runId: number; employees: number } | { ok: false; error: string }> {
  try {
    const res = await generatePayrollRun(await actor(), year, month);
    revalidatePath("/hr/payroll");
    return { ok: true, ...res };
  } catch (e) {
    console.error("[payroll:generate]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not generate payroll." };
  }
}

export async function finalizePayrollAction(runId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await finalizePayrollRun(await actor(), runId);
    revalidatePath("/hr/payroll");
    revalidatePath("/me/payslips");
    return { ok: true };
  } catch (e) {
    console.error("[payroll:finalize]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not finalize this run." };
  }
}
