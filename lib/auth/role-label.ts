import type { Role } from "@/lib/db/enums";

/** Human label for a single role. */
export function roleLabel(role?: Role | string): string {
  switch (role) {
    case "super-admin":
      return "Super Admin";
    case "sales":
      return "Sales / Finance";
    case "viewer":
      return "Designer / Employee";
    case "hr":
      return "HR admin";
    case "delivery":
      return "Delivery team";
    default:
      return role ?? "";
  }
}

/** Short label for a single role, used in the topbar badge. */
export function roleShort(role?: Role | string): string {
  switch (role) {
    case "super-admin":
      return "Super Admin";
    case "sales":
      return "Sales";
    case "viewer":
      return "Designer";
    case "hr":
      return "HR";
    case "delivery":
      return "Delivery";
    default:
      return role ?? "";
  }
}

/** Human labels for a role SET, joined — the user card / badge shows the union. */
export function rolesLabel(roles?: Role[]): string {
  return (roles ?? []).map((r) => roleLabel(r)).join(" · ");
}

/** Short labels for a role SET, joined — the topbar badge shows the union. */
export function rolesShort(roles?: Role[]): string {
  return (roles ?? []).map((r) => roleShort(r)).join(" · ");
}
