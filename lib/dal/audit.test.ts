import { describe, it, expect, afterAll } from "vitest";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oems, auditLog } from "@/lib/db/schema";
import { stampedDelete, stampedDeleteWhere } from "./audit";

async function auditRowsFor(id: number) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tableName, "oems"), eq(auditLog.rowId, String(id))));
}

describe("stampedDelete — the delete carries the deleter", () => {
  const createdOemIds: number[] = [];

  it("stamps updated_by then deletes, so the DELETE audit row shows the actor", async () => {
    const [o] = await db
      .insert(oems)
      .values({ name: `AuditTmp ${Date.now()}`, createdBy: 1, updatedBy: 1 })
      .returning({ id: oems.id });
    createdOemIds.push(o.id);

    const count = await stampedDelete(oems, o.id, 3); // actor 3 deletes
    expect(count).toBe(1);

    const gone = await db.select().from(oems).where(eq(oems.id, o.id));
    expect(gone.length).toBe(0);

    const rows = await auditRowsFor(o.id);
    const delRow = rows.find((r) => r.op === "DELETE");
    expect(delRow?.actorId).toBe(3); // the deleter, not the creator
  });

  it("returns 0 and writes no DELETE audit row for a nonexistent id", async () => {
    const missingId = 999_999_999;

    const count = await stampedDelete(oems, missingId, 3);
    expect(count).toBe(0);

    const rows = await auditRowsFor(missingId);
    expect(rows.find((r) => r.op === "DELETE")).toBeUndefined();
  });

  afterAll(async () => {
    // The row itself is already gone (that's the point of the test), but clean
    // up defensively in case the delete assertion failed partway through.
    for (const id of createdOemIds) {
      try {
        await db.delete(oems).where(eq(oems.id, id));
      } catch {
        /* already gone */
      }
      try {
        await db.delete(auditLog).where(and(eq(auditLog.tableName, "oems"), eq(auditLog.rowId, String(id))));
      } catch {
        /* best effort */
      }
    }
  });
});

describe("stampedDeleteWhere — predicate delete carries the deleter for every matched row", () => {
  const createdOemIds: number[] = [];

  it("stamps then deletes all rows matching the predicate, each DELETE audit row shows the actor", async () => {
    const prefix = `AuditWhereTmp-${Date.now()}`;
    const inserted = await db
      .insert(oems)
      .values([
        { name: `${prefix}-1`, createdBy: 1, updatedBy: 1 },
        { name: `${prefix}-2`, createdBy: 1, updatedBy: 1 },
      ])
      .returning({ id: oems.id });
    createdOemIds.push(...inserted.map((r) => r.id));

    const count = await stampedDeleteWhere(oems, ilike(oems.name, `${prefix}%`), 3); // actor 3 deletes
    expect(count).toBe(2);

    const gone = await db.select().from(oems).where(ilike(oems.name, `${prefix}%`));
    expect(gone.length).toBe(0);

    for (const id of inserted.map((r) => r.id)) {
      const rows = await auditRowsFor(id);
      const delRow = rows.find((r) => r.op === "DELETE");
      expect(delRow?.actorId).toBe(3);
    }
  });

  afterAll(async () => {
    for (const id of createdOemIds) {
      try {
        await db.delete(oems).where(eq(oems.id, id));
      } catch {
        /* already gone */
      }
      try {
        await db.delete(auditLog).where(and(eq(auditLog.tableName, "oems"), eq(auditLog.rowId, String(id))));
      } catch {
        /* best effort */
      }
    }
  });
});
