import { describe, it, expect, afterAll } from "vitest";
import { listMethods, createMethod, updateMethod, setMethodActive } from "./methods";
import { db } from "@/lib/db/client";
import { deliveryMethods } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

const SUPER = { id: 1, role: "super-admin" as const };
const DELIVERY = { id: 998, role: "delivery" as const };
const ADMIN = { id: 997, role: "admin" as const };
const VIEWER = { id: 999, role: "viewer" as const };

// Unique per-run code so reruns against a dirty local DB never collide.
const CODE = `TX${String(Date.now()).slice(-6)}`;

describe("delivery methods catalogue", () => {
  const created: number[] = [];

  it("delivery role creates a method; code is normalised to uppercase", async () => {
    const { id } = await createMethod(DELIVERY, { name: "  Test Style ", code: CODE.toLowerCase(), description: " x " });
    created.push(id);
    const rows = await listMethods(SUPER);
    const mine = rows.find((r) => r.id === id)!;
    expect(mine.code).toBe(CODE);
    expect(mine.name).toBe("Test Style");
    expect(mine.description).toBe("x");
    expect(mine.active).toBe(true);
    expect(mine.programCount).toBe(0);
  });

  it("duplicate code is a user-safe error", async () => {
    await expect(createMethod(SUPER, { name: "Dup", code: CODE })).rejects.toThrow(/already exists/);
  });

  it("update renames; deactivate hides from the active-only listing", async () => {
    const id = created[0];
    await updateMethod(SUPER, id, { name: "Renamed Style", code: CODE });
    await setMethodActive(SUPER, id, false);
    const all = await listMethods(SUPER);
    expect(all.find((r) => r.id === id)!.name).toBe("Renamed Style");
    expect(all.find((r) => r.id === id)!.active).toBe(false);
    const activeOnly = await listMethods(SUPER, { includeInactive: false });
    expect(activeOnly.find((r) => r.id === id)).toBeUndefined();
  });

  it("admin can read but not write; viewer can do neither", async () => {
    await expect(listMethods(ADMIN)).resolves.toBeInstanceOf(Array);
    await expect(createMethod(ADMIN, { name: "Nope", code: "NOPE1" })).rejects.toThrow();
    await expect(listMethods(VIEWER)).rejects.toThrow();
    await expect(setMethodActive(VIEWER, created[0] ?? 1, true)).rejects.toThrow();
  });

  it("bad inputs are rejected with user-safe messages", async () => {
    await expect(createMethod(SUPER, { name: "", code: "OK1" })).rejects.toThrow(/name/i);
    await expect(createMethod(SUPER, { name: "Ok", code: "way too long code!!" })).rejects.toThrow(/code/i);
  });

  afterAll(async () => {
    if (created.length) await db.delete(deliveryMethods).where(inArray(deliveryMethods.id, created));
  });
});
