"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { rolloverYear } from "@/lib/dal/rollover";

export async function rolloverAction(
  fromYearLabel: string,
  toYearLabel: string,
  countOverrides: Record<number, number>,
  cohortOverrides: Record<number, Record<string, number>> = {},
) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  if (session.user.role === "viewer") throw new Error("Viewers cannot roll over years");

  const result = await rolloverYear(
    { id: Number(session.user.id), role: session.user.role },
    fromYearLabel,
    toYearLabel,
    countOverrides,
    cohortOverrides,
  );
  revalidatePath("/", "layout");
  return result;
}
