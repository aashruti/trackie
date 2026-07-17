"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  createUser,
  setUserAccounts,
  updateUserRole,
  deleteUser,
  resetUserPassword,
} from "@/lib/dal/user-admin";
import type { Role } from "@/lib/db/enums";
import { makeVerifyToken } from "@/lib/auth/email-verify";
import { sendVerificationEmail } from "@/lib/email/verify";
import { appBaseUrl } from "@/lib/http/base-url";

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
  const { id } = await createUser(await actor(), input);
  // Best-effort: send the new user a verification link (never blocks creation).
  try {
    const email = input.email.trim().toLowerCase();
    const token = makeVerifyToken(id, email);
    const link = `${await appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail(email, input.name.trim(), link);
  } catch (e) {
    console.error("[user:verify-email] send failed:", e instanceof Error ? e.message : e);
  }
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

export async function resetUserPasswordAction(userId: number, password: string) {
  try {
    await resetUserPassword(await actor(), userId, password);
  } catch (e) {
    // A too-short password is an expected error, not an exception — same shape
    // as profile/actions.ts.
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to reset password" };
  }
  revalidatePath("/admin/users");
  return { ok: true as const };
}
