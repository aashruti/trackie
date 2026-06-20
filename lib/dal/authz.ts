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

/**
 * Leads CRM is sales-pipeline data, gated to Admin / Finance.
 * Maps the prototype's role switch (Admin/Finance ↔ Designer/Employee):
 *  - super-admin & admin → full access
 *  - viewer (Designer / Employee) → locked out
 */
export function canAccessLeads(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "admin";
}

export function assertLeadsAccess(user: SessionUser): void {
  if (!canAccessLeads(user)) {
    throw new Error("Leads is available to Admin / Finance only");
  }
}
