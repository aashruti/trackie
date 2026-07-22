"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { rolloverYear, type RolloverEdits } from "@/lib/dal/rollover";

export async function rolloverAction(
  fromYearLabel: string,
  toYearLabel: string,
  edits: RolloverEdits = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  // Allow-list, not a deny-list: rollover creates GLOBAL academic-year rows, so
  // it is finance-only (hr/delivery roles must not reach it either).
  if (!session.user.roles.includes("super-admin") && !session.user.roles.includes("sales")) {
    throw new Error("Only Sales / Super Admin can roll over years");
  }

  const result = await rolloverYear(
    { id: Number(session.user.id), roles: session.user.roles },
    fromYearLabel,
    toYearLabel,
    edits,
  );
  revalidatePath("/", "layout");
  return result;
}
