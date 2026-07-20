"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  addAccountsToGroup,
  createGroup,
  deleteGroup,
  removeAccountFromGroup,
  renameGroup,
} from "@/lib/dal/groups";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), roles: session.user.roles };
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

// Membership changes show up in the grouped view AND on the member accounts.
function revalidateGroupViews(groupId?: number) {
  revalidatePath("/accounts/groups");
  if (groupId) revalidatePath(`/accounts/groups/${groupId}`);
  revalidatePath("/accounts");
}

export async function createGroupAction(name: string, accountIds: number[]): Promise<CreateResult> {
  try {
    const { id } = await createGroup(await actor(), name, accountIds);
    revalidateGroupViews(id);
    return { ok: true, id };
  } catch (e) {
    console.error("[groups:create]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not create the group." };
  }
}

export async function renameGroupAction(id: number, name: string): Promise<ActionResult> {
  try {
    await renameGroup(await actor(), id, name);
    revalidateGroupViews(id);
    return { ok: true };
  } catch (e) {
    console.error("[groups:rename]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not rename the group." };
  }
}

export async function addAccountsAction(id: number, accountIds: number[]): Promise<ActionResult> {
  try {
    await addAccountsToGroup(await actor(), id, accountIds);
    revalidateGroupViews(id);
    return { ok: true };
  } catch (e) {
    console.error("[groups:add-accounts]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not add the account to the group." };
  }
}

export async function removeAccountAction(groupId: number, accountId: number): Promise<ActionResult> {
  try {
    await removeAccountFromGroup(await actor(), accountId);
    revalidateGroupViews(groupId);
    return { ok: true };
  } catch (e) {
    console.error("[groups:remove-account]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not remove the account from the group." };
  }
}

export async function deleteGroupAction(id: number): Promise<ActionResult> {
  try {
    await deleteGroup(await actor(), id);
    revalidateGroupViews(id);
    return { ok: true };
  } catch (e) {
    console.error("[groups:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the group." };
  }
}
