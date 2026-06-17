"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  createUser,
  setUserAccounts,
  updateUserRole,
  deleteUser,
} from "@/lib/dal/user-admin";
import type { Role } from "@/lib/db/enums";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

export async function createUserAction(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}) {
  await createUser(await actor(), input);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserAccountsAction(userId: number, accountIds: number[]) {
  await setUserAccounts(await actor(), userId, accountIds);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateUserRoleAction(userId: number, role: Role) {
  await updateUserRole(await actor(), userId, role);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function deleteUserAction(userId: number) {
  await deleteUser(await actor(), userId);
  revalidatePath("/admin/users");
  return { ok: true };
}
