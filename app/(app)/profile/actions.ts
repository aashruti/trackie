"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { auth } from "@/lib/auth/config";

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (!userId) return { ok: false, error: "Not signed in." };

  if (!newPassword || newPassword.length < 8)
    return { ok: false, error: "New password must be at least 8 characters." };

  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return { ok: false, error: "User not found." };

  const valid = await verifyPassword(currentPassword, row.passwordHash);
  if (!valid) return { ok: false, error: "Current password is incorrect." };

  const hash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));

  return { ok: true };
}
