import type { Role } from "@/lib/db/enums";
import { UserError } from "@/lib/dal/errors";

export type SessionUser = { id: number; roles: Role[] };

function isSuper(user: SessionUser): boolean {
  return user.roles.includes("super-admin");
}
function has(user: SessionUser, role: Role): boolean {
  return user.roles.includes(role);
}

/** null = unrestricted (super-admin); else the assigned account ids. */
export function scopeAccountIds(user: SessionUser, assigned: number[]): number[] | null {
  return isSuper(user) ? null : assigned;
}

/** Edit finance on an account: super anywhere; sales only on assigned accounts. */
export function canEdit(user: SessionUser, accountId: number, assigned: number[]): boolean {
  if (isSuper(user)) return true;
  if (has(user, "sales")) return assigned.includes(accountId);
  return false;
}

export function canAccessLeads(user: SessionUser): boolean {
  return isSuper(user) || has(user, "sales");
}
export function assertLeadsAccess(user: SessionUser): void {
  if (!canAccessLeads(user)) throw new UserError("Leads is available to Sales / Super Admin only");
}

export function canManageHr(user: SessionUser): boolean {
  return isSuper(user) || has(user, "hr");
}
export function assertHrAccess(user: SessionUser): void {
  if (!canManageHr(user)) throw new UserError("HR administration is available to HR / Super Admin only");
}

/** SEE delivery — delivery team only now; sales no longer gets read access. */
export function canAccessDelivery(user: SessionUser): boolean {
  return isSuper(user) || has(user, "delivery");
}
export function assertDeliveryAccess(user: SessionUser): void {
  if (!canAccessDelivery(user)) throw new UserError("Delivery is available to the Delivery team / Super Admin only");
}

export function canManageDelivery(user: SessionUser): boolean {
  return isSuper(user) || has(user, "delivery");
}
export function assertDeliveryManage(user: SessionUser): void {
  if (!canManageDelivery(user)) throw new UserError("Only the Delivery team / Super Admin can modify delivery data");
}

export function canManageGroups(user: SessionUser): boolean {
  return isSuper(user) || has(user, "sales");
}
export function assertGroupsManage(user: SessionUser): void {
  if (!canManageGroups(user)) throw new UserError("Account groups are available to Sales / Super Admin only");
}
