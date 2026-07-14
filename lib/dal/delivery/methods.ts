import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deliveryMethods, programs } from "@/lib/db/schema";
import { assertDeliveryAccess, assertDeliveryManage, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";

/**
 * Delivery methods = the teaching-style catalogue ("Direct to Students" D2S,
 * "Teach the Teacher" T3, …) attached to each program. Managed in Delivery
 * settings. Methods are deactivated, never deleted — programs keep pointing at
 * them and the report history stays intact.
 */

export type DeliveryMethodRow = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  /** How many programs currently use this method (drives "can't be removed" UX). */
  programCount: number;
};

export type MethodInput = { name: string; code: string; description?: string };

/** Drizzle wraps driver errors — walk the cause chain for a 23505 unique violation. */
function isUniqueViolation(e: unknown): boolean {
  let cur = e as { code?: string; message?: string; cause?: unknown } | undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (cur.code === "23505" || (cur.message && /unique|duplicate/i.test(cur.message))) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

function cleanInput(input: MethodInput): { name: string; code: string; description: string | null } {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (!name) throw new UserError("Give the teaching style a name.");
  if (name.length > 120) throw new UserError("Name is too long.");
  if (!code) throw new UserError("Give the teaching style a short code (e.g. D2S).");
  if (!/^[A-Z0-9-]{1,12}$/.test(code)) throw new UserError("Code must be 1–12 letters/digits (e.g. D2S, T3).");
  const description = input.description?.trim() || null;
  return { name, code, description };
}

/** Whole catalogue (active first, then by code), with per-method usage counts. */
export async function listMethods(
  user: SessionUser,
  opts: { includeInactive?: boolean } = {},
): Promise<DeliveryMethodRow[]> {
  assertDeliveryAccess(user);
  const { includeInactive = true } = opts;
  const rows = await db
    .select({
      id: deliveryMethods.id,
      name: deliveryMethods.name,
      code: deliveryMethods.code,
      description: deliveryMethods.description,
      active: deliveryMethods.active,
      programCount: sql<number>`(SELECT count(*)::int FROM ${programs} WHERE ${programs.deliveryMethodId} = ${deliveryMethods.id})`,
    })
    .from(deliveryMethods)
    .orderBy(asc(deliveryMethods.code));
  const list = includeInactive ? rows : rows.filter((r) => r.active);
  return list.sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));
}

export async function createMethod(user: SessionUser, input: MethodInput): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const values = cleanInput(input);
  try {
    const [row] = await db.insert(deliveryMethods).values(values).returning({ id: deliveryMethods.id });
    return { id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new UserError(`A teaching style with code ${values.code} already exists.`);
    }
    throw e;
  }
}

export async function updateMethod(user: SessionUser, id: number, input: MethodInput): Promise<void> {
  assertDeliveryManage(user);
  const values = cleanInput(input);
  try {
    const updated = await db
      .update(deliveryMethods)
      .set(values)
      .where(eq(deliveryMethods.id, id))
      .returning({ id: deliveryMethods.id });
    if (!updated.length) throw new UserError("Teaching style not found.");
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new UserError(`A teaching style with code ${values.code} already exists.`);
    }
    throw e;
  }
}

/** Deactivate hides the method from new-program pickers; existing programs keep it. */
export async function setMethodActive(user: SessionUser, id: number, active: boolean): Promise<void> {
  assertDeliveryManage(user);
  const updated = await db
    .update(deliveryMethods)
    .set({ active })
    .where(eq(deliveryMethods.id, id))
    .returning({ id: deliveryMethods.id });
  if (!updated.length) throw new UserError("Teaching style not found.");
}
