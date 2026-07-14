import type { Role } from "@/lib/db/enums";
import { UserError } from "@/lib/dal/errors";

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
    throw new UserError("Leads is available to Admin / Finance only");
  }
}

/**
 * Can this user manage the HR module (employees, leave approvals, attendance
 * overrides, payroll, HR settings)?
 *  - super-admin & hr → full access
 *  - everyone else → no (they may still be employees with self-service access,
 *    which is gated separately on having an employee_profiles row).
 */
export function canManageHr(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "hr";
}

export function assertHrAccess(user: SessionUser): void {
  if (!canManageHr(user)) {
    throw new UserError("HR administration is available to HR / Super Admin only");
  }
}

/**
 * Can this user SEE the delivery module (programs, events, activities, the
 * account delivery report)?
 *  - super-admin & delivery → full access
 *  - admin (sales/finance) → read access — they take the delivery report to
 *    renewals, so they must be able to open it
 *  - viewer / hr → no
 */
export function canAccessDelivery(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "delivery" || user.role === "admin";
}

export function assertDeliveryAccess(user: SessionUser): void {
  if (!canAccessDelivery(user)) {
    throw new UserError("Delivery is available to Delivery team / Admin / Super Admin only");
  }
}

/**
 * Can this user MODIFY delivery data (methods, programs, events, activities)?
 * Writes are delivery-team-only; admin keeps read-only report access.
 */
export function canManageDelivery(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "delivery";
}

export function assertDeliveryManage(user: SessionUser): void {
  if (!canManageDelivery(user)) {
    throw new UserError("Only the Delivery team / Super Admin can modify delivery data");
  }
}

/**
 * Account groups (the grouped profitability view) live in the Finance section:
 * super-admin and admin manage groups AND are the only viewers. Rollups are
 * still scoped to the caller's visible accounts (scopeAccountIds).
 */
export function canManageGroups(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "admin";
}

export function assertGroupsManage(user: SessionUser): void {
  if (!canManageGroups(user)) {
    throw new UserError("Account groups are available to Admin / Super Admin only");
  }
}
