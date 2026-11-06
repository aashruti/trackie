import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, deliveryMethods, oems, poVendors, programs, users } from "@/lib/db/schema";
import { createPoVendor, listPoVendors, renamePoVendor, setPoVendorActive } from "./po-vendors";

const SUPER = { id: 1, roles: ["super-admin" as const] };
const DELIVERY = { id: 0, roles: ["delivery" as const] };
// Sales and viewer have no delivery access; rejected by authz before any write.
const SALES = { id: 997, roles: ["sales" as const] };
const VIEWER = { id: 999, roles: ["viewer" as const] };

// Unique per run so reruns against a dirty local DB never collide.
const RUN = String(Date.now()).slice(-6);
const f = { userId: 0, oemId: 0, accountId: 0, methodId: 0 };
const vendorIds: number[] = [];
const programIds: number[] = [];

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ name: `PoVendor Tester ${RUN}`, email: `po-vendor-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
    .returning({ id: users.id });
  f.userId = u.id;
  DELIVERY.id = u.id;
  const [o] = await db.insert(oems).values({ name: `PvOEM-${RUN}` }).returning({ id: oems.id });
  f.oemId = o.id;
  const [a] = await db
    .insert(accounts)
    .values({ name: `PvAcc-${RUN}`, type: "university", city: "Pune", oemId: o.id })
    .returning({ id: accounts.id });
  f.accountId = a.id;
  const [m] = await db.insert(deliveryMethods).values({ name: `PvStyle-${RUN}`, code: `V${RUN}` }).returning({ id: deliveryMethods.id });
  f.methodId = m.id;
});

afterAll(async () => {
  if (programIds.length) await db.delete(programs).where(inArray(programs.id, programIds));
  if (vendorIds.length) await db.delete(poVendors).where(inArray(poVendors.id, vendorIds));
  await db.delete(accounts).where(eq(accounts.id, f.accountId));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.id, f.methodId));
  await db.delete(oems).where(eq(oems.id, f.oemId));
  await db.delete(users).where(eq(users.id, f.userId));
});

async function mkProgram(name: string, vendorId: number | null, vendorText: string | null = null) {
  const [p] = await db
    .insert(programs)
    .values({ accountId: f.accountId, oemId: f.oemId, deliveryMethodId: f.methodId, name: `${name} ${RUN}`, vendorId, vendor: vendorText })
    .returning({ id: programs.id });
  programIds.push(p.id);
  return p.id;
}

describe("PO vendors", () => {
  it("delivery role creates a vendor, trimmed, active, stamped, with no POs", async () => {
    const { id } = await createPoVendor(DELIVERY, `  Reseller A ${RUN} `);
    vendorIds.push(id);
    const mine = (await listPoVendors(SUPER)).find((v) => v.id === id)!;
    expect(mine).toEqual({ id, name: `Reseller A ${RUN}`, active: true, poCount: 0 });
    const [row] = await db.select().from(poVendors).where(eq(poVendors.id, id));
    expect(row.createdBy).toBe(DELIVERY.id);
    expect(row.updatedBy).toBe(DELIVERY.id);
  });

  it("rejects a duplicate name case-insensitively, a blank name and a too-long name", async () => {
    await expect(createPoVendor(SUPER, `reseller a ${RUN}`)).rejects.toThrow(/already exists/);
    await expect(createPoVendor(SUPER, "   ")).rejects.toThrow(/name/i);
    await expect(createPoVendor(SUPER, "x".repeat(161))).rejects.toThrow(/too long/);
  });

  it("renames, and a rename onto another vendor's name is rejected", async () => {
    const { id } = await createPoVendor(SUPER, `Reseller B ${RUN}`);
    vendorIds.push(id);
    await renamePoVendor(DELIVERY, id, ` Reseller Bee ${RUN} `);
    expect((await listPoVendors(SUPER)).find((v) => v.id === id)!.name).toBe(`Reseller Bee ${RUN}`);
    await expect(renamePoVendor(SUPER, id, `RESELLER A ${RUN}`)).rejects.toThrow(/already exists/);
    // Changing only the case of its own name is fine.
    await renamePoVendor(SUPER, id, `reseller bee ${RUN}`);
    await expect(renamePoVendor(SUPER, -1, "Nope")).rejects.toThrow(/not found/);
    const [row] = await db.select().from(poVendors).where(eq(poVendors.id, id));
    expect(row.updatedBy).toBe(SUPER.id);
  });

  it("deactivates and reactivates; the active-only list hides inactive vendors", async () => {
    const id = vendorIds[0];
    await setPoVendorActive(DELIVERY, id, false);
    expect((await listPoVendors(SUPER)).find((v) => v.id === id)!.active).toBe(false);
    expect((await listPoVendors(SUPER, { includeInactive: false })).find((v) => v.id === id)).toBeUndefined();
    await setPoVendorActive(DELIVERY, id, true);
    expect((await listPoVendors(SUPER, { includeInactive: false })).find((v) => v.id === id)!.active).toBe(true);
    await expect(setPoVendorActive(SUPER, -1, true)).rejects.toThrow(/not found/);
  });

  it("counts the POs using each vendor, and sorts by name", async () => {
    const { id } = await createPoVendor(SUPER, `AAA Reseller ${RUN}`);
    vendorIds.push(id);
    await mkProgram("PvCount1", id);
    await mkProgram("PvCount2", id);
    const list = await listPoVendors(SUPER);
    expect(list.find((v) => v.id === id)!.poCount).toBe(2);
    const names = list.map((v) => v.name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("only delivery and super-admin can read; only managers can write", async () => {
    await expect(listPoVendors(DELIVERY)).resolves.toBeInstanceOf(Array);
    for (const u of [SALES, VIEWER]) {
      await expect(listPoVendors(u)).rejects.toThrow();
      await expect(createPoVendor(u, `Nope ${RUN}`)).rejects.toThrow();
      await expect(renamePoVendor(u, vendorIds[0], `Nope ${RUN}`)).rejects.toThrow();
      await expect(setPoVendorActive(u, vendorIds[0], false)).rejects.toThrow();
    }
  });
});

describe("migration 0029 backfill", () => {
  // Re-runs the two backfill statements from the migration file against
  // fixtures. They are idempotent, so running them on a migrated DB is safe.
  const file = readFileSync(path.join(process.cwd(), "drizzle/0029_po_vendors.sql"), "utf8");
  const statements = file
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => /^(-- .*\n)*\s*(INSERT INTO "po_vendors"|UPDATE "programs")/.test(s));

  it("creates one vendor per case-insensitive name, links POs, keeps the text, and is idempotent", async () => {
    expect(statements).toHaveLength(2);
    const name = `Legacy Vendor ${RUN}`;
    const p1 = await mkProgram("PvLegacy1", null, `  ${name} `);
    const p2 = await mkProgram("PvLegacy2", null, name.toUpperCase());
    const p3 = await mkProgram("PvLegacy3", null, "   ");
    for (let i = 0; i < 2; i++) for (const s of statements) await db.execute(sql.raw(s));

    const made = await db.select().from(poVendors).where(sql`lower(${poVendors.name}) = lower(${name})`);
    vendorIds.push(...made.map((v) => v.id));
    expect(made).toHaveLength(1);
    expect(made[0].name.toLowerCase()).toBe(name.toLowerCase());
    expect(made[0].active).toBe(true);
    const rows = await db.select({ id: programs.id, vendorId: programs.vendorId, vendor: programs.vendor }).from(programs).where(inArray(programs.id, [p1, p2, p3]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(p1)).toMatchObject({ vendorId: made[0].id, vendor: `  ${name} ` });
    expect(byId.get(p2)).toMatchObject({ vendorId: made[0].id, vendor: name.toUpperCase() });
    // Blank text never becomes a vendor.
    expect(byId.get(p3)).toMatchObject({ vendorId: null });
    expect(await db.select().from(poVendors).where(sql`btrim(${poVendors.name}) = ''`)).toHaveLength(0);
  });

  it("links to an existing vendor without overwriting a vendor_id already set", async () => {
    const { id: existing } = await createPoVendor(SUPER, `Existing ${RUN}`);
    const { id: other } = await createPoVendor(SUPER, `Other ${RUN}`);
    vendorIds.push(existing, other);
    const linked = await mkProgram("PvLinked", other, `existing ${RUN}`);
    const unlinked = await mkProgram("PvUnlinked", null, `EXISTING ${RUN}`);
    for (const s of statements) await db.execute(sql.raw(s));
    const rows = await db.select({ id: programs.id, vendorId: programs.vendorId }).from(programs).where(inArray(programs.id, [linked, unlinked]));
    const byId = new Map(rows.map((r) => [r.id, r.vendorId]));
    expect(byId.get(linked)).toBe(other);
    expect(byId.get(unlinked)).toBe(existing);
    expect(await db.select().from(poVendors).where(sql`lower(${poVendors.name}) = lower(${`Existing ${RUN}`})`)).toHaveLength(1);
  });
});
