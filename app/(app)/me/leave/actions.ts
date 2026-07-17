"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { applyForLeave, hrRecipientEmails, type ApplyLeaveInput } from "@/lib/dal/hr/leave";
import { notifyLeaveRequested, notifyLeaveSubmitted } from "@/lib/email/hr-leave";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function applyLeaveAction(input: ApplyLeaveInput): Promise<ActionResult> {
  let created;
  try {
    created = await applyForLeave(await actor(), input);
  } catch (e) {
    // Only UserError messages (not an employee / end before start / no working
    // days) surface; anything else is generic so internal errors don't leak.
    return { ok: false, error: isUserError(e) ? e.message : "Could not submit your request." };
  }
  // Notifications are best-effort: the request is already saved, so a lookup or
  // send failure must not make the user think it failed (and resubmit).
  try {
    const recipients = await hrRecipientEmails();
    await notifyLeaveRequested(recipients, {
      employeeName: created.employeeName,
      leaveTypeName: created.leaveTypeName,
      startDate: created.startDate,
      endDate: created.endDate,
      days: created.days,
    });
    // Confirmation to the applicant (only if they've verified their email).
    if (created.employeeEmailVerified) {
      await notifyLeaveSubmitted(created.employeeEmail, {
        employeeName: created.employeeName,
        leaveTypeName: created.leaveTypeName,
        startDate: created.startDate,
        endDate: created.endDate,
        days: created.days,
      });
    }
  } catch (e) {
    console.error("[leave:notify] failed to notify on new request:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/me/leave");
  revalidatePath("/hr/leave");
  return { ok: true };
}
