import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, userAccounts } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/db/enums";
import { type SessionUser } from "./authz";

function assertSuperAdmin(user: SessionUser) {
  if (user.role !== "super-admin") throw new Error("Only a Super Admin can manage users");
}

/**
 * Matches the self-service rule in app/(app)/profile/actions.ts. These used to
 * disagree (6 here, 8 there), which let an admin-set password be weaker than a
 * user-set one.
 */
const MIN_PASSWORD = 8;

export interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  assignedAccountIds: number[];
}

export async function listUsers(actor: SessionUser): Promise<UserRow[]> {
  assertSuperAdmin(actor);
  const rows = await db.select().from(users).orderBy(asc(users.name));
  const assignments = await db.select().from(userAccounts);
  const byUser = new Map<number, number[]>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a.accountId);
    byUser.set(a.userId, list);
  }
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    assignedAccountIds: byUser.get(u.id) ?? [],
  }));
}

export async function createUser(
  actor: SessionUser,
  input: { name: string; email: string; password: string; role: Role },
): Promise<{ id: number }> {
  assertSuperAdmin(actor);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) throw new Error("Name and email are required");
  if (input.password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new Error("A user with that email already exists");

  const [row] = await db
    .insert(users)
    .values({ name, email, passwordHash: await hashPassword(input.password), role: input.role })
    .returning();
  return { id: row.id };
}

export async function updateUserRole(actor: SessionUser, userId: number, role: Role): Promise<void> {
  assertSuperAdmin(actor);
  if (actor.id === userId && role !== "super-admin") {
    throw new Error("You can't demote yourself");
  }
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

/**
 * Set another user's password. The super admin types it and relays it — this is
 * an internal tool and that trade-off was chosen deliberately (see the spec).
 *
 * NOTE: this does NOT sign the target out. Sessions are JWTs
 * (lib/auth/config.ts) and cannot be revoked without a denylist, so an existing
 * session survives the reset. Fixes "forgot my password"; does NOT fix "lock out
 * an intruder".
 */
export async function resetUserPassword(
  actor: SessionUser,
  userId: number,
  newPassword: string,
): Promise<void> {
  assertSuperAdmin(actor);
  // Your own password goes through /profile, which demands the current one.
  // Without this, an unlocked super-admin laptop is a permanent takeover: change
  // the password without knowing the old one.
  if (userId === actor.id) throw new Error("Change your own password from your profile");
  if (newPassword.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new Error("User not found");

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));

  // There is no audit table; this is the honest minimum for a security action.
  console.info(`[security] password reset by user ${actor.id} for user ${userId}`);
}

/** Replace a user's account assignments. */
export async function setUserAccounts(
  actor: SessionUser,
  userId: number,
  accountIds: number[],
): Promise<void> {
  assertSuperAdmin(actor);
  await db.delete(userAccounts).where(eq(userAccounts.userId, userId));
  const unique = [...new Set(accountIds)];
  if (unique.length > 0) {
    await db.insert(userAccounts).values(unique.map((accountId) => ({ userId, accountId })));
  }
}

export async function deleteUser(actor: SessionUser, userId: number): Promise<void> {
  assertSuperAdmin(actor);
  if (actor.id === userId) throw new Error("You can't delete yourself");
  await db.delete(users).where(eq(users.id, userId));
}

/** Count of super-admins — used to prevent removing the last one (future guard). */
export async function superAdminCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, "super-admin"));
  return row?.n ?? 0;
}
