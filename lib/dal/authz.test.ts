import { describe, it, expect } from "vitest";
import {
  canEdit,
  canAccessLeads,
  assertLeadsAccess,
  scopeAccountIds,
  type SessionUser,
} from "./authz";

const superAdmin: SessionUser = { id: 1, role: "super-admin" };
const admin: SessionUser = { id: 2, role: "admin" };
const viewer: SessionUser = { id: 3, role: "viewer" };

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
