import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export async function getUserEmailInfo(
  userId: number,
): Promise<{ id: number; name: string; email: string; emailVerifiedAt: Date | null } | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Mark a user's email verified — only if the token's email still matches the
 * user's current address (a token is void once the address changes). Returns
 * false if the user/email no longer matches.
 */
export async function markEmailVerified(userId: number, email: string): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedBy: userId })
    .where(and(eq(users.id, userId), eq(users.email, email)))
    .returning({ id: users.id });
  return updated.length > 0;
}
