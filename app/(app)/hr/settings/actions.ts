"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { addHoliday, deleteHoliday, reapplyHoliday } from "@/lib/dal/hr/holidays";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// A company holiday materializes into attendance, so refresh the views that read it.
function revalidateHrViews() {
  revalidatePath("/hr/settings");
  revalidatePath("/hr/attendance");
  revalidatePath("/dashboard");
}

export async function addHolidayAction(date: string, name: string): Promise<ActionResult> {
  try {
    await addHoliday(await actor(), date, name);
    revalidateHrViews();
    return { ok: true };
  } catch (e) {
    console.error("[holidays:add]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not add the holiday." };
  }
}

export async function reapplyHolidayAction(id: number): Promise<ActionResult> {
  try {
    await reapplyHoliday(await actor(), id);
    revalidateHrViews();
    return { ok: true };
  } catch (e) {
    console.error("[holidays:reapply]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not re-apply the holiday." };
  }
}

export async function deleteHolidayAction(id: number): Promise<ActionResult> {
  try {
    await deleteHoliday(await actor(), id);
    revalidateHrViews();
    return { ok: true };
  } catch (e) {
    console.error("[holidays:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the holiday." };
  }
}
