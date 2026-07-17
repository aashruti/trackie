import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authSessions } from "@/lib/db/schema";

/**
 * The backend session store. Auth.js issues a JWT carrying this row's id as
 * `sid`; the jwt callback checks the row on every request, so deleting a row
 * revokes that session.
 *
 * This is the ONLY module that touches auth_sessions.
 */

/** Mint a session row and return its id, to be carried in the JWT as `sid`. */
export async function createSession(userId: number): Promise<string> {
  // Unguessable: the sid is inside a signed JWT, but a predictable id would let
  // a leaked token be swapped for someone else's live session.
  const id = crypto.randomUUID();
  await db.insert(authSessions).values({ id, userId });
  return id;
}

/** Is this session still live? Called on every auth() — hence the PK lookup. */
export async function sessionExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.id, id))
    .limit(1);
  return !!row;
}

/** Clean sign-out. */
export async function deleteSession(id: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.id, id));
}

/** Revoke every session for one user. Returns how many ended. */
export async function deleteUserSessions(userId: number): Promise<number> {
  const gone = await db
    .delete(authSessions)
    .where(eq(authSessions.userId, userId))
    .returning({ id: authSessions.id });
  return gone.length;
}
