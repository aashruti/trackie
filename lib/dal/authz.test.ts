import { describe, it, expect } from "vitest";
import {
  canEdit,
  canAccessLeads,
  assertLeadsAccess,
  scopeAccountIds,
  canAccessDelivery,
  assertDeliveryAccess,
  canManageDelivery,
  assertDeliveryManage,
  canManageGroups,
  assertGroupsManage,
  type SessionUser,
} from "./authz";

const superAdmin: SessionUser = { id: 1, role: "super-admin" };
const admin: SessionUser = { id: 2, role: "admin" };
const viewer: SessionUser = { id: 3, role: "viewer" };
const hr: SessionUser = { id: 4, role: "hr" };
const delivery: SessionUser = { id: 5, role: "delivery" };

describe("scopeAccountIds", () => {
  it("super-admin sees all (null = no filter)", () => {
    expect(scopeAccountIds(superAdmin, [10, 20])).toBeNull();
  });
  it("admin/viewer are limited to assigned ids", () => {
    expect(scopeAccountIds(admin, [10, 20])).toEqual([10, 20]);
    expect(scopeAccountIds(viewer, [])).toEqual([]);
  });
});

describe("canEdit", () => {
  it("super-admin edits anything", () => {
    expect(canEdit(superAdmin, 99, [])).toBe(true);
  });
  it("admin edits only assigned accounts", () => {
    expect(canEdit(admin, 10, [10])).toBe(true);
    expect(canEdit(admin, 30, [10])).toBe(false);
  });
  it("viewer never edits", () => {
    expect(canEdit(viewer, 10, [10])).toBe(false);
  });
});

describe("canAccessLeads (Admin / Finance only)", () => {
  it("super-admin and admin can access leads", () => {
    expect(canAccessLeads(superAdmin)).toBe(true);
    expect(canAccessLeads(admin)).toBe(true);
  });
  it("viewer (Designer / Employee) is locked out", () => {
    expect(canAccessLeads(viewer)).toBe(false);
  });
  it("assertLeadsAccess throws for viewer, passes for admin", () => {
    expect(() => assertLeadsAccess(viewer)).toThrow();
    expect(() => assertLeadsAccess(admin)).not.toThrow();
  });
});

describe("canAccessDelivery (delivery team + admin read for the renewal report)", () => {
  it("super-admin, delivery and admin can access", () => {
    expect(canAccessDelivery(superAdmin)).toBe(true);
    expect(canAccessDelivery(delivery)).toBe(true);
    expect(canAccessDelivery(admin)).toBe(true);
  });
  it("viewer and hr are locked out", () => {
    expect(canAccessDelivery(viewer)).toBe(false);
    expect(canAccessDelivery(hr)).toBe(false);
  });
  it("assertDeliveryAccess throws only for locked-out roles", () => {
    expect(() => assertDeliveryAccess(viewer)).toThrow();
    expect(() => assertDeliveryAccess(hr)).toThrow();
    expect(() => assertDeliveryAccess(admin)).not.toThrow();
    expect(() => assertDeliveryAccess(delivery)).not.toThrow();
  });
});

describe("canManageGroups (account groups are Finance-only)", () => {
  it("super-admin and admin can manage groups", () => {
    expect(canManageGroups(superAdmin)).toBe(true);
    expect(canManageGroups(admin)).toBe(true);
  });
  it("viewer, hr and delivery are locked out", () => {
    expect(canManageGroups(viewer)).toBe(false);
    expect(canManageGroups(hr)).toBe(false);
    expect(canManageGroups(delivery)).toBe(false);
    expect(() => assertGroupsManage(viewer)).toThrow();
    expect(() => assertGroupsManage(delivery)).toThrow();
    expect(() => assertGroupsManage(admin)).not.toThrow();
  });
});

describe("canManageDelivery (writes are delivery-team only)", () => {
  it("super-admin and delivery can manage", () => {
    expect(canManageDelivery(superAdmin)).toBe(true);
    expect(canManageDelivery(delivery)).toBe(true);
  });
  it("admin has read-only access — no writes", () => {
    expect(canManageDelivery(admin)).toBe(false);
    expect(() => assertDeliveryManage(admin)).toThrow();
  });
  it("viewer and hr cannot manage", () => {
    expect(canManageDelivery(viewer)).toBe(false);
    expect(canManageDelivery(hr)).toBe(false);
    expect(() => assertDeliveryManage(viewer)).toThrow();
  });
});
