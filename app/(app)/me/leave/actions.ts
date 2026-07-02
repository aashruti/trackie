"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { applyForLeave, hrRecipientEmails, type ApplyLeaveInput } from "@/lib/dal/hr/leave";
import { notifyLeaveRequested } from "@/lib/email/hr-leave";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export async function applyLeaveAction(input: ApplyLeaveInput) {
  const created = await applyForLeave(await actor(), input);
  const recipients = await hrRecipientEmails();
  await notifyLeaveRequested(recipients, {
    employeeName: created.employeeName,
    leaveTypeName: created.leaveTypeName,
    startDate: created.startDate,
    endDate: created.endDate,
    days: created.days,
  });
  revalidatePath("/me/leave");
  revalidatePath("/hr/leave");
  return { ok: true };
}
