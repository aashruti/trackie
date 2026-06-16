import type { Role } from "@/lib/db/enums";

export type SessionUser = { id: number; role: Role };

/**
 * Account scoping for a user.
 * Returns `null` = unrestricted (super-admin sees everything), else the explicit
 * list of account ids the user is assigned to (admin/viewer).
 */
export function scopeAccountIds(user: SessionUser, assigned: number[]): number[] | null {
  return user.role === "super-admin" ? null : assigned;
}

/**
 * Can this user edit financial data on the given account?
 *  - super-admin: anything
 *  - admin: only accounts assigned to them
 *  - viewer: never
 */
export function canEdit(user: SessionUser, accountId: number, assigned: number[]): boolean {
  if (user.role === "super-admin") return true;
  if (user.role === "admin") return assigned.includes(accountId);
  return false;
}
