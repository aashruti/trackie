"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { reviewLeaveRequest } from "@/lib/dal/hr/leave";
import { notifyLeaveDecision } from "@/lib/email/hr-leave";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function reviewLeaveAction(
  requestId: number,
  decision: "approved" | "rejected",
  note: string | null,
): Promise<ActionResult> {
  let info;
  try {
    info = await reviewLeaveRequest(await actor(), requestId, decision, note);
  } catch (e) {
    // Return (don't throw) so the message survives to the client in production
    // (Next redacts thrown server-action errors). These are HR-facing validation
    // messages (insufficient balance, already reviewed, not authorized).
    console.error("[leave:review]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not process this request." };
  }
  // Only email verified addresses; failures never block the decision.
  try {
    if (info.employeeEmailVerified) {
      await notifyLeaveDecision(info.employeeEmail, {
        employeeName: info.employeeName,
        leaveTypeName: info.leaveTypeName,
        startDate: info.startDate,
        endDate: info.endDate,
        days: info.days,
        decision: info.decision,
        note,
      });
    }
  } catch (e) {
    console.error("[leave:notify] failed to notify employee of decision:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/hr/leave");
  return { ok: true };
}
