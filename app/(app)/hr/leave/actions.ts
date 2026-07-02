"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { reviewLeaveRequest } from "@/lib/dal/hr/leave";
import { notifyLeaveDecision } from "@/lib/email/hr-leave";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export async function reviewLeaveAction(
  requestId: number,
  decision: "approved" | "rejected",
  note: string | null,
) {
  const info = await reviewLeaveRequest(await actor(), requestId, decision, note);
  // Fire-and-forget email; failures never block the decision.
  try {
    await notifyLeaveDecision(info.employeeEmail, {
      employeeName: info.employeeName,
      leaveTypeName: info.leaveTypeName,
      startDate: info.startDate,
      endDate: info.endDate,
      days: info.days,
      decision: info.decision,
      note,
    });
  } catch (e) {
    console.error("[leave:notify] failed to notify employee of decision:", e instanceof Error ? e.message : e);
  }
  revalidatePath("/hr/leave");
  return { ok: true };
}
