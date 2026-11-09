"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { createPoVendor, renamePoVendor, setPoVendorActive } from "@/lib/dal/delivery/po-vendors";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// Vendor names show on this page, the POs list (column + filter) and each PO's details.
function revalidateVendorViews() {
  revalidatePath("/delivery/vendors");
  revalidatePath("/delivery/programs");
  revalidatePath("/delivery/programs/[id]", "page");
}

export async function createPoVendorAction(name: string): Promise<ActionResult> {
  try {
    await createPoVendor(await actor(), name);
    revalidateVendorViews();
    return { ok: true };
  } catch (e) {
    console.error("[po-vendors:create]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not add the vendor." };
  }
}

export async function renamePoVendorAction(id: number, name: string): Promise<ActionResult> {
  try {
    await renamePoVendor(await actor(), id, name);
    revalidateVendorViews();
    return { ok: true };
  } catch (e) {
    console.error("[po-vendors:rename]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not rename the vendor." };
  }
}

export async function setPoVendorActiveAction(id: number, active: boolean): Promise<ActionResult> {
  try {
    await setPoVendorActive(await actor(), id, active);
    revalidateVendorViews();
    return { ok: true };
  } catch (e) {
    console.error("[po-vendors:set-active]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not change the vendor." };
  }
}
