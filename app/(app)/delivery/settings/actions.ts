"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { createMethod, setMethodActive, updateMethod, type MethodInput } from "@/lib/dal/delivery/methods";
import { createPoVendor, renamePoVendor, setPoVendorActive } from "@/lib/dal/delivery/po-vendors";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
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

// Vendor names show on the POs list (column + filter) and each PO's details.
function revalidateVendorViews() {
  revalidateDeliveryViews();
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
