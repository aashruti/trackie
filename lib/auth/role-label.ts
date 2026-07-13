import type { Role } from "@/lib/db/enums";

/** Human label for the sidebar user card — mirrors the prototype's role names. */
export function roleLabel(role?: Role | string): string {
  switch (role) {
    case "super-admin":
      return "Super Admin";
    case "admin":
      return "Admin / Finance";
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

/** Short label for the topbar role badge. */
export function roleShort(role?: Role | string): string {
  switch (role) {
    case "super-admin":
      return "Super Admin";
    case "admin":
      return "Admin";
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
