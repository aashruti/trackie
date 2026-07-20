import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { listMethods, createMethod, updateMethod, setMethodActive } from "./methods";
import { db } from "@/lib/db/client";
import { deliveryMethods, users } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

const SUPER = { id: 1, roles: ["super-admin" as const] };
// Real users row (created in beforeAll) — createdBy/updatedBy now has a users
// FK, so the acting user must exist. Mirrors lib/dal/delivery/programs.test.ts.
const DELIVERY = { id: 0, roles: ["delivery" as const] };
// Sales lost delivery read/write in the admin→sales split (the ONE intended
// reduction from stackable roles — see lib/dal/authz.test.ts). Never reaches
// a DB write (rejected by authz first), so a non-existent id is fine here.
const SALES = { id: 997, roles: ["sales" as const] };
const VIEWER = { id: 999, roles: ["viewer" as const] };

// Unique per-run code so reruns against a dirty local DB never collide.
const RUN = String(Date.now()).slice(-6);
const CODE = `TX${RUN}`;
const fixtures = { deliveryUserId: 0 };

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ name: `Methods Tester ${RUN}`, email: `methods-test-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
    .returning({ id: users.id });
  fixtures.deliveryUserId = u.id;
  DELIVERY.id = u.id;
});

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
    const [row] = await db.select().from(deliveryMethods).where(eq(deliveryMethods.id, id));
    expect(row.createdBy).toBe(DELIVERY.id);
    expect(row.updatedBy).toBe(DELIVERY.id);
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
    // updateMethod + setMethodActive both stamp updatedBy with the acting user,
    // while createdBy attribution from the original create is left untouched.
    const [row] = await db.select().from(deliveryMethods).where(eq(deliveryMethods.id, id));
    expect(row.updatedBy).toBe(SUPER.id);
    expect(row.createdBy).toBe(DELIVERY.id);
  });

  it("sales has no delivery access at all (lost it in the admin→sales split); viewer neither", async () => {
    await expect(listMethods(SALES)).rejects.toThrow();
    await expect(createMethod(SALES, { name: "Nope", code: "NOPE1" })).rejects.toThrow();
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

afterAll(async () => {
  await db.delete(users).where(eq(users.id, fixtures.deliveryUserId));
});
