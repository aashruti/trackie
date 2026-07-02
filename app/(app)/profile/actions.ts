"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { auth } from "@/lib/auth/config";
import { makeVerifyToken } from "@/lib/auth/email-verify";
import { getUserEmailInfo } from "@/lib/dal/email-verify";
import { sendVerificationEmail } from "@/lib/email/verify";

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
  const h = await headers();
  const host = h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const link = `${proto}://${host}/verify-email?token=${encodeURIComponent(token)}`;

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
  await db.update(users).set({ passwordHash: hash }).where(eq(users.id, userId));

  return { ok: true };
}
