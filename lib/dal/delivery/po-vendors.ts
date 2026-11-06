import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { poVendors, programs } from "@/lib/db/schema";
import { assertDeliveryAccess, assertDeliveryManage, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import { isUniqueViolation } from "./util";

/**
 * PO vendors = who issued a PO and is billed (e.g. a reseller), independent of
 * the provider. A managed list in Delivery settings, like teaching styles:
 * vendors are deactivated, never deleted, so existing POs keep pointing at
 * them. Only active vendors can be picked for a new PO. (The phase-2 SME/PI
 * vendor list is separate.)
 */

export type PoVendorRow = {
  id: number;
  name: string;
  active: boolean;
  /** How many POs use this vendor (drives the confirm-before-deactivate UX). */
  poCount: number;
};

function cleanName(input: string): string {
  const name = input?.trim() ?? "";
  if (!name) throw new UserError("Give the vendor a name.");
  if (name.length > 160) throw new UserError("Vendor name is too long.");
  return name;
}

const duplicate = (name: string) => new UserError(`A vendor named ${name} already exists.`);

/** All vendors sorted by name, with how many POs use each. */
export async function listPoVendors(
  user: SessionUser,
  opts: { includeInactive?: boolean } = {},
): Promise<PoVendorRow[]> {
  assertDeliveryAccess(user);
  const { includeInactive = true } = opts;
  return db
    .select({
      id: poVendors.id,
      name: poVendors.name,
      active: poVendors.active,
      // Qualify explicitly: drizzle renders single-table columns unqualified,
      // so a bare "id" here would bind to programs.id.
      poCount: sql<number>`(SELECT count(*)::int FROM ${programs} p WHERE p.vendor_id = "po_vendors"."id")`,
    })
    .from(poVendors)
    .where(includeInactive ? undefined : eq(poVendors.active, true))
    .orderBy(sql`lower(${poVendors.name})`, poVendors.id);
}

export async function createPoVendor(user: SessionUser, name: string): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const clean = cleanName(name);
  try {
    const [row] = await db
      .insert(poVendors)
      .values({ name: clean, createdBy: user.id, updatedBy: user.id })
      .returning({ id: poVendors.id });
    return { id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicate(clean);
    throw e;
  }
}

export async function renamePoVendor(user: SessionUser, id: number, name: string): Promise<void> {
  assertDeliveryManage(user);
  const clean = cleanName(name);
  try {
    const updated = await db
      .update(poVendors)
      .set({ name: clean, updatedBy: user.id })
      .where(eq(poVendors.id, id))
      .returning({ id: poVendors.id });
    if (!updated.length) throw new UserError("Vendor not found.");
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicate(clean);
    throw e;
  }
}

/** Deactivate hides the vendor from new-PO pickers; existing POs keep it. */
export async function setPoVendorActive(user: SessionUser, id: number, active: boolean): Promise<void> {
  assertDeliveryManage(user);
  const updated = await db
    .update(poVendors)
    .set({ active, updatedBy: user.id })
    .where(eq(poVendors.id, id))
    .returning({ id: poVendors.id });
  if (!updated.length) throw new UserError("Vendor not found.");
}

/**
 * Internal, no authorization. Throws unless the vendor exists and is active,
 * or is `allowInactiveId` (a PO may keep the vendor it already has). null is
 * always allowed (no vendor).
 */
export async function assertPoVendorUsable(
  vendorId: number | null,
  opts: { allowInactiveId?: number | null } = {},
): Promise<void> {
  if (vendorId === null) return;
  const [row] = await db
    .select({ active: poVendors.active })
    .from(poVendors)
    .where(eq(poVendors.id, vendorId))
    .limit(1);
  if (!row) throw new UserError("Pick a valid vendor.");
  if (!row.active && vendorId !== opts.allowInactiveId) {
    throw new UserError("That vendor is deactivated — pick an active one.");
  }
}
