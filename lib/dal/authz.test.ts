import { describe, it, expect } from "vitest";
import {
  canEdit, canViewFinance, assertFinanceAccess, canAccessLeads, assertLeadsAccess, scopeAccountIds,
  canAccessDelivery, canManageDelivery,
  canManageGroups, assertGroupsManage, canManageHr, assertHrAccess,
  type SessionUser,
} from "./authz";

const u = (...roles: SessionUser["roles"]): SessionUser => ({ id: 1, roles });

const superAdmin = u("super-admin");
const sales = u("sales");        // ← was "admin"
const viewer = u("viewer");
const hr = u("hr");
const delivery = u("delivery");
const salesDelivery = u("sales", "delivery"); // cross-functional stack

describe("scopeAccountIds", () => {
  it("super-admin unrestricted; everyone else assigned", () => {
    expect(scopeAccountIds(superAdmin, [10, 20])).toBeNull();
    expect(scopeAccountIds(sales, [10, 20])).toEqual([10, 20]);
    expect(scopeAccountIds(delivery, [10])).toEqual([10]);
    expect(scopeAccountIds(viewer, [])).toEqual([]);
  });
});

describe("canViewFinance — delivery/hr can't see finance even with account assignments", () => {
  it("super & sales yes; delivery, hr, viewer no", () => {
    expect(canViewFinance(superAdmin)).toBe(true);
    expect(canViewFinance(sales)).toBe(true);
    expect(canViewFinance(delivery)).toBe(false); // ← the bypass this guards
    expect(canViewFinance(hr)).toBe(false);
    expect(canViewFinance(viewer)).toBe(false);
    expect(() => assertFinanceAccess(delivery)).toThrow();
    expect(() => assertFinanceAccess(sales)).not.toThrow();
  });
  it("a {sales, delivery} stack sees finance (via sales)", () => {
    expect(canViewFinance(salesDelivery)).toBe(true);
  });
});

describe("finance edit / leads / groups — sales inherits admin's finance access", () => {
  it("canEdit: super anything, sales only assigned, others never", () => {
    expect(canEdit(superAdmin, 99, [])).toBe(true);
    expect(canEdit(sales, 10, [10])).toBe(true);
    expect(canEdit(sales, 30, [10])).toBe(false);
    expect(canEdit(delivery, 10, [10])).toBe(false);
    expect(canEdit(viewer, 10, [10])).toBe(false);
  });
  it("leads + groups: super & sales yes; delivery/hr/viewer no", () => {
    for (const f of [canAccessLeads, canManageGroups]) {
      expect(f(superAdmin)).toBe(true);
      expect(f(sales)).toBe(true);
      expect(f(delivery)).toBe(false);
      expect(f(hr)).toBe(false);
      expect(f(viewer)).toBe(false);
    }
    expect(() => assertLeadsAccess(delivery)).toThrow();
    expect(() => assertGroupsManage(sales)).not.toThrow();
  });
});

describe("delivery — the ONE intended reduction: sales loses delivery access", () => {
  it("access: super & delivery yes; sales NO (was yes as admin); hr/viewer no", () => {
    expect(canAccessDelivery(superAdmin)).toBe(true);
    expect(canAccessDelivery(delivery)).toBe(true);
    expect(canAccessDelivery(sales)).toBe(false); // ← the deliberate change
    expect(canAccessDelivery(hr)).toBe(false);
  });
  it("manage: super & delivery yes; sales no", () => {
    expect(canManageDelivery(superAdmin)).toBe(true);
    expect(canManageDelivery(delivery)).toBe(true);
    expect(canManageDelivery(sales)).toBe(false);
  });
});

describe("hr", () => {
  it("super & hr manage; others cannot", () => {
    expect(canManageHr(superAdmin)).toBe(true);
    expect(canManageHr(hr)).toBe(true);
    expect(canManageHr(sales)).toBe(false);
    expect(() => assertHrAccess(delivery)).toThrow();
  });
});

describe("stacking — union of permissions", () => {
  it("{sales, delivery} gets BOTH finance edit and delivery manage", () => {
    expect(canEdit(salesDelivery, 10, [10])).toBe(true);
    expect(canAccessDelivery(salesDelivery)).toBe(true);
    expect(canManageDelivery(salesDelivery)).toBe(true);
    expect(canAccessLeads(salesDelivery)).toBe(true);
  });
  it("super-admin anywhere in the stack wins", () => {
    expect(scopeAccountIds(u("super-admin", "delivery"), [1])).toBeNull();
  });
});
