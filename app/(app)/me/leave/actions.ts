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
  // Notification is best-effort: the request is already saved, so a recipient
  // lookup or send failure must not make the user think it failed (and resubmit).
  try {
    const recipients = await hrRecipientEmails();
    await notifyLeaveRequested(recipients, {
      employeeName: created.employeeName,
      leaveTypeName: created.leaveTypeName,
      startDate: created.startDate,
      endDate: created.endDate,
      days: created.days,
    });
  } catch (e) {
    console.error("[leave:notify] failed to notify HR of new request:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/me/leave");
  revalidatePath("/hr/leave");
  return { ok: true };
}
