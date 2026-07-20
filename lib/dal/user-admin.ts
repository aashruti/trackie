import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  users,
  userAccounts,
  userRoles,
  employeeProfiles,
  leaveBalances,
  leaveRequests,
  payslips,
  attendanceRecords,
  tasks,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/db/enums";
import { type SessionUser } from "./authz";
import { deleteUserSessions } from "./sessions";
import { stampedDelete, stampedDeleteWhere } from "./audit";

function assertSuperAdmin(user: SessionUser) {
  if (!user.roles.includes("super-admin")) throw new Error("Only a Super Admin can manage users");
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
  /** The role SET (source of truth: user_roles), not the legacy scalar. */
  roles: Role[];
  assignedAccountIds: number[];
}

export async function listUsers(actor: SessionUser): Promise<UserRow[]> {
  assertSuperAdmin(actor);
  // Independent reads — batch (house rule).
  const [rows, assignments, roleRows] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(userAccounts),
    db.select().from(userRoles),
  ]);
  const byUser = new Map<number, number[]>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a.accountId);
    byUser.set(a.userId, list);
  }
  const rolesByUser = new Map<number, Role[]>();
  for (const r of roleRows) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.role);
    rolesByUser.set(r.userId, list);
  }
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    // Fall back to the legacy scalar only for a user whose user_roles row is
    // somehow missing (shouldn't happen post-backfill, but never show "no role").
    roles: rolesByUser.get(u.id) ?? [u.role],
    assignedAccountIds: byUser.get(u.id) ?? [],
  }));
}

/**
 * Create a user and seed BOTH `users.role` (the scalar rollback seed) and
 * `user_roles` (the set — source of truth for authz). Roles default to
 * `["viewer"]` — the "no area" role — when the caller passes none; an empty
 * `user_roles` set would sign the new user in with `roles: []` and lock them
 * out of every gated surface.
 */
export async function createUser(
  actor: SessionUser,
  input: { name: string; email: string; password: string; roles?: Role[] },
): Promise<{ id: number }> {
  assertSuperAdmin(actor);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) throw new Error("Name and email are required");
  if (input.password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);

  const roles: Role[] = input.roles?.length ? [...new Set(input.roles)] : ["viewer"];

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new Error("A user with that email already exists");

  const [row] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash: await hashPassword(input.password),
      role: roles[0],
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();
  await db
    .insert(userRoles)
    .values(roles.map((role) => ({ userId: row.id, role, createdBy: actor.id, updatedBy: actor.id })));
  return { id: row.id };
}

/**
 * Pure decision for the last-super-admin guard — no DB, so it is exhaustively
 * unit-testable without ever touching the real super-admins in the local DB
 * (a target's role change can only orphan the system if they currently hold
 * super-admin, the new set drops it, AND they were the only holder left).
 */
export function wouldOrphanSuperAdmins(
  currentlyHoldsSuper: boolean,
  totalSuperAdmins: number,
  newRoles: Role[],
): boolean {
  return currentlyHoldsSuper && !newRoles.includes("super-admin") && totalSuperAdmins <= 1;
}

/**
 * Replace a user's role SET. Mirrors setUserAccounts (delete-all then
 * re-insert). Also writes the scalar `users.role` to `roles[0]` for the
 * rollback-seed's display/consistency during the expand phase.
 *
 * Three invariants: a user must hold at least one role (else they're locked
 * out — `viewer` is the floor); the system must never end up with zero users
 * holding `super-admin`; and a super-admin can't strip their OWN super-admin.
 */
export async function setUserRoles(actor: SessionUser, userId: number, roles: Role[]): Promise<void> {
  assertSuperAdmin(actor);
  const unique = [...new Set(roles)];
  if (unique.length === 0) throw new Error("A user must have at least one role");

  // Self-demotion guard (defense-in-depth; the UI also disables self-edit). A
  // super-admin removing their own super-admin is a self-lockout footgun — and
  // it slips past the orphan check below whenever another super-admin exists.
  // Distinct concern: the orphan guard protects the SYSTEM; this protects the
  // ACTOR from demoting themselves. Ask another super-admin to do it.
  if (actor.id === userId && !unique.includes("super-admin")) {
    throw new Error("You can't remove your own Super Admin — ask another Super Admin");
  }

  if (!unique.includes("super-admin")) {
    const [holdsSuper] = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "super-admin")))
      .limit(1);
    const total = holdsSuper ? await superAdminCount() : 0;
    if (wouldOrphanSuperAdmins(!!holdsSuper, total, unique)) {
      throw new Error("Can't remove the last Super Admin");
    }
  }

  // Stamp-then-delete, deliberately. An earlier comment here claimed this
  // bulk-revoke's DELETE audit rows would be actor-NULL and that one fewer
  // round-trip was the better trade — both halves were wrong. These rows always
  // carry an updated_by from whoever last GRANTED the role, so an unstamped
  // delete doesn't produce a NULL actor: it names a real, uninvolved admin as
  // the revoker. Naming the wrong person is strictly worse than naming nobody.
  // stampedDeleteWhere is predicate-based, so the composite PK (userId, role) is
  // no obstacle. The extra round-trip buys the answer to "who revoked this
  // user's super-admin" — the highest-value forensic event in the system.
  await stampedDeleteWhere(userRoles, eq(userRoles.userId, userId), actor.id);
  await db
    .insert(userRoles)
    .values(unique.map((role) => ({ userId, role, createdBy: actor.id, updatedBy: actor.id })));
  await db.update(users).set({ role: unique[0], updatedBy: actor.id }).where(eq(users.id, userId));
}

/**
 * Set another user's password. The super admin types it and relays it — this is
 * an internal tool and that trade-off was chosen deliberately (see the spec).
 *
 * Signs the target out everywhere: every session row for them is deleted, so
 * each of their devices is rejected on its next request. This is what makes the
 * feature usable for a compromised account, not just a forgotten password.
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

  // Order matters, and it cannot be a transaction: the neon-http driver used in
  // production throws "No transactions support" (neon-http/session.js:152), so
  // db.transaction() would pass locally on postgres.js and break on deploy.
  //
  // Revoke FIRST, change SECOND. If the second step fails, sessions are gone but
  // the old password still works — the user signs back in, mildly annoyed, and
  // the caller's "failed" is honest. The other order fails catastrophically: the
  // password would already have changed while the caller reported failure, so
  // nobody would relay the new password — locking the user out of an account
  // whose intruder is still signed in, which is exactly what this prevents.
  const ended = await deleteUserSessions(userId);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedBy: actor.id })
    .where(eq(users.id, userId));

  console.info(`[security] password reset by user ${actor.id} for user ${userId} (${ended} sessions ended)`);
}

/**
 * End every session for a user WITHOUT changing their password — the case a
 * reset cannot serve when you only want someone out, not locked out.
 *
 * Self is allowed, unlike resetUserPassword: signing yourself out everywhere is
 * recoverable (sign in again), not a lockout risk.
 */
export async function signOutUserEverywhere(
  actor: SessionUser,
  userId: number,
): Promise<number> {
  assertSuperAdmin(actor);
  const ended = await deleteUserSessions(userId);
  console.info(`[security] sessions ended by user ${actor.id} for user ${userId} (${ended})`);
  return ended;
}

/** Replace a user's account assignments. */
export async function setUserAccounts(
  actor: SessionUser,
  userId: number,
  accountIds: number[],
): Promise<void> {
  assertSuperAdmin(actor);
  // Stamp-then-delete, deliberately — same reasoning as setUserRoles. The rows
  // being revoked carry updated_by from whoever last GRANTED the assignment, so
  // an unstamped delete attributes the revocation to that granter, not to the
  // actor doing the revoking. "Who took this user off this account" has to name
  // the revoker; one extra round-trip is the price.
  await stampedDeleteWhere(userAccounts, eq(userAccounts.userId, userId), actor.id);
  const unique = [...new Set(accountIds)];
  if (unique.length > 0) {
    await db
      .insert(userAccounts)
      .values(unique.map((accountId) => ({ userId, accountId, createdBy: actor.id, updatedBy: actor.id })));
  }
}

export async function deleteUser(actor: SessionUser, userId: number): Promise<void> {
  assertSuperAdmin(actor);
  if (actor.id === userId) throw new Error("You can't delete yourself");
  // Stamp before deleting so the trail names the ADMIN who deleted this user,
  // not whoever last touched each row. The DELETE trigger reads the row's own
  // OLD.updated_by as the actor, and a user who ever edited themselves (via
  // setUserRoles/setUserAccounts on their own account, or leave self-service)
  // carries their OWN id there — so an unstamped delete would record the
  // deleted user as the actor of their own deletion.
  //
  // The cascade needs the same treatment: deleting the users row cascade-deletes
  // its user_roles/user_accounts rows, and each fires its own DELETE trigger
  // reading ITS OWN updated_by. Stamping the children first gives them the
  // deleting admin too.
  //
  // (audit_log.actor_id deliberately has no FK to users.id — see migration 0016.
  // That is what lets these rows be written while the user is being deleted, and
  // what lets them survive the deletion afterwards.)
  //
  // The HR subtree is the deepest leg and the one most worth getting right:
  // employee_profiles.user_id is ON DELETE CASCADE, and leave_balances /
  // leave_requests / payslips / attendance_records all CASCADE from
  // employee_profiles.id — so deleting one user silently deletes their entire
  // payroll and attendance history. Each of those rows is audited and each
  // DELETE trigger reads ITS OWN updated_by, which for HR data is typically the
  // HR admin who last edited it. Unstamped, the whole trail would name that HR
  // admin as the author of a deletion they had no part in. Stamp deepest-first
  // (the grandchildren, then the profile) so every level attributes correctly.
  const profileIds = (
    await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.userId, userId))
  ).map((r) => r.id);
  if (profileIds.length) {
    await db.update(leaveBalances).set({ updatedBy: actor.id }).where(inArray(leaveBalances.employeeId, profileIds));
    await db.update(leaveRequests).set({ updatedBy: actor.id }).where(inArray(leaveRequests.employeeId, profileIds));
    await db.update(payslips).set({ updatedBy: actor.id }).where(inArray(payslips.employeeId, profileIds));
    await db
      .update(attendanceRecords)
      .set({ updatedBy: actor.id })
      .where(inArray(attendanceRecords.employeeId, profileIds));
    await db.update(employeeProfiles).set({ updatedBy: actor.id }).where(eq(employeeProfiles.userId, userId));
  }
  // tasks.assignee_id is ON DELETE SET NULL, not CASCADE — the task survives,
  // unassigned. That un-assignment is still an audited UPDATE, and it too reads
  // updated_by, so without this stamp it would be attributed to whoever last
  // edited the task rather than to the admin whose deletion orphaned it.
  await db.update(tasks).set({ updatedBy: actor.id }).where(eq(tasks.assigneeId, userId));
  await stampedDeleteWhere(userRoles, eq(userRoles.userId, userId), actor.id);
  await stampedDeleteWhere(userAccounts, eq(userAccounts.userId, userId), actor.id);
  await stampedDelete(users, userId, actor.id);
}

/**
 * Count of super-admins — used by setUserRoles to prevent removing the last one.
 * Reads user_roles (the set, source of truth for authz), NOT users.role — the
 * scalar is a stale rollback seed that won't reflect roles granted/revoked
 * after the initial backfill.
 */
export async function superAdminCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${userRoles.userId})::int` })
    .from(userRoles)
    .where(eq(userRoles.role, "super-admin"));
  return row?.n ?? 0;
}
