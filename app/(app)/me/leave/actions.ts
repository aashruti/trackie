"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { applyForLeave, hrRecipientEmails, type ApplyLeaveInput } from "@/lib/dal/hr/leave";
import { notifyLeaveRequested, notifyLeaveSubmitted } from "@/lib/email/hr-leave";
import { isUserError } from "@/lib/dal/errors";
import { appBaseUrl } from "@/lib/http/base-url";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult =
  | { ok: true; emailSent: boolean }
  | { ok: false; error: string };

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
  let emailSent = false;
  try {
    const recipients = await hrRecipientEmails();
    const reviewUrl = `${await appBaseUrl()}/hr/leave?request=${created.requestId}`;
    const [hrResult, employeeResult] = await Promise.all([
      notifyLeaveRequested(recipients, {
        employeeName: created.employeeName,
        leaveTypeName: created.leaveTypeName,
        startDate: created.startDate,
        endDate: created.endDate,
        days: created.days,
        reviewUrl,
      }),
      // Internal employee accounts are provisioned by HR/Admin, so delivery
      // must not be suppressed merely because the verification link has not
      // been clicked yet.
      notifyLeaveSubmitted(created.employeeEmail, {
        employeeName: created.employeeName,
        leaveTypeName: created.leaveTypeName,
        startDate: created.startDate,
        endDate: created.endDate,
        days: created.days,
      }),
    ]);
    emailSent = hrResult.sent && employeeResult.sent;
  } catch (e) {
    console.error("[leave:notify] failed to notify on new request:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/me/leave");
  revalidatePath("/hr/leave");
  return { ok: true, emailSent };
}
