"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { auth } from "@/lib/auth/config";
import { makeVerifyToken } from "@/lib/auth/email-verify";
import { getUserEmailInfo } from "@/lib/dal/email-verify";
import { sendVerificationEmail } from "@/lib/email/verify";
import { appBaseUrl } from "@/lib/http/base-url";
import { deleteUserSessions } from "@/lib/dal/sessions";

export async function sendVerificationAction(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (!userId) return { ok: false, error: "Not signed in." };

  const info = await getUserEmailInfo(userId);
  if (!info) return { ok: false, error: "User not found." };
  if (info.emailVerifiedAt) return { ok: true, message: "Your email is already verified." };

  const token = makeVerifyToken(info.id, info.email);
  const link = `${await appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  const res = await sendVerificationEmail(info.email, info.name, link);
  if (!res.sent) {
    return {
      ok: false,
      error:
        res.skippedReason === "acs-not-configured"
          ? "Email isn't configured on the server yet."
          : "Could not send the email. Please try again.",
    };
  }
  return { ok: true, message: `Verification email sent to ${info.email}.` };
}

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

  // Revoke FIRST, change SECOND — see resetUserPassword for why this order, and
  // why it isn't a transaction (neon-http has no transaction support). If the
  // update fails here, sessions are gone but the old password still works, so
  // "failed" is honest and the user simply signs in again. The other order would
  // report failure after the password had already changed, and the retry would
  // then reject their now-stale "current password" — locking them out.
  //
  // This ends every session including the current one, so the user lands on
  // /login. Deliberate: someone who suspects compromise can evict an intruder
  // without waiting for an admin.
  await deleteUserSessions(userId);
  await db.update(users).set({ passwordHash: hash, updatedBy: userId }).where(eq(users.id, userId));

  return { ok: true };
}
