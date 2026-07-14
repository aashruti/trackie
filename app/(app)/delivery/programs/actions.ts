"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { createProgram, deleteProgram, type NewProgram } from "@/lib/dal/delivery/programs";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

export async function createProgramAction(input: NewProgram): Promise<CreateResult> {
  try {
    const { id } = await createProgram(await actor(), input);
    revalidatePath("/delivery/programs");
    return { ok: true, id };
  } catch (e) {
    console.error("[programs:create]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not create the program." };
  }
}

export async function deleteProgramAction(id: number): Promise<ActionResult> {
  try {
    await deleteProgram(await actor(), id);
    revalidatePath("/delivery/programs");
    revalidatePath("/delivery/board");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    console.error("[programs:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the program." };
  }
}
