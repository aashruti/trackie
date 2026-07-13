"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { createMethod, setMethodActive, updateMethod, type MethodInput } from "@/lib/dal/delivery/methods";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// Methods show up in the programs list (chips) and pickers — refresh both.
function revalidateDeliveryViews() {
  revalidatePath("/delivery/settings");
  revalidatePath("/delivery/programs");
}

export async function createMethodAction(input: MethodInput): Promise<ActionResult> {
  try {
    await createMethod(await actor(), input);
    revalidateDeliveryViews();
    return { ok: true };
  } catch (e) {
    console.error("[delivery-methods:create]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not create the teaching style." };
  }
}

export async function updateMethodAction(id: number, input: MethodInput): Promise<ActionResult> {
  try {
    await updateMethod(await actor(), id, input);
    revalidateDeliveryViews();
    return { ok: true };
  } catch (e) {
    console.error("[delivery-methods:update]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the teaching style." };
  }
}

export async function setMethodActiveAction(id: number, active: boolean): Promise<ActionResult> {
  try {
    await setMethodActive(await actor(), id, active);
    revalidateDeliveryViews();
    return { ok: true };
  } catch (e) {
    console.error("[delivery-methods:set-active]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not change the teaching style." };
  }
}
