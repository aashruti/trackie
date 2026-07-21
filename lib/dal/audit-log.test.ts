import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";
import {
  AUDIT_ACTOR_NONE,
  AUDIT_PAGE_SIZE,
  changedFields,
  isStampOnlyUpdate,
  listAuditEntries,
  listAuditFilterOptions,
} from "./audit-log";
import type { SessionUser } from "./authz";

/**
 * Read-side tests for the audit viewer DAL.
 *
 * These insert audit_log rows DIRECTLY rather than driving DAL mutations. That
 * is deliberate and complementary: audit-behavior.test.ts already proves the
 * triggers write the right rows; what needs proving here is that the reader
 * orders, filters, paginates and diffs whatever is in the table. Synthetic rows
 * under a RUN-suffixed table_name give exact control over `at`, actor and op —
 * and make cleanup precise (delete by our own table_name), which matters in a
 * local DB holding ~22.8k real audit rows this file must not disturb.
 */

const SUPER: SessionUser = { id: 1, roles: ["super-admin"] };
const NOT_SUPER: SessionUser = { id: 2, roles: ["sales", "hr", "delivery"] };

const RUN = String(Date.now()).slice(-9);
// Distinct synthetic table names so every filter assertion is scoped to rows
// this file created — the real log has 20k+ rows across ~30 tables.
const TBL = `zzaudit_${RUN}`;
const TBL2 = `zzaudit2_${RUN}`;
const PGTBL = `zzauditpg_${RUN}`;
/** Mixed NULL-actor and named-actor rows — for the "System / unknown" filter. */
const NTBL = `zzauditnull_${RUN}`;

const fx = {
  actorA: 0,
  actorB: 0,
  /** Created, used as an actor, then DELETED mid-suite — the no-FK proof. */
  ghostActor: 0,
  /** ids of the four TBL rows, in insertion (= ascending id) order. */
  tblIds: [] as number[],
  /** ids of the three NTBL rows: [null-actor, actorA, null-actor]. */
  ntblIds: [] as number[],
};

function img(over: Record<string, unknown>): Record<string, unknown> {
  return { id: 1, name: "original", amount: 100, note: null, updated_by: 1, updated_at: "2026-01-01T00:00:00Z", version: 1, ...over };
}

async function mkUser(label: string): Promise<number> {
  const [u] = await db
    .insert(users)
    .values({
      name: `AuditViewer ${label} ${RUN}`,
      email: `audit-viewer-${label.toLowerCase()}-${RUN}@test.local`,
      passwordHash: "x",
      role: "viewer",
    })
    .returning({ id: users.id });
  return u.id;
}

beforeAll(async () => {
  fx.actorA = await mkUser("A");
  fx.actorB = await mkUser("B");
  fx.ghostActor = await mkUser("Ghost");

  // --- TBL: four rows telling one row's whole life, newest last. ---
  const v1 = img({ version: 1, updated_by: fx.actorA });
  const v2 = img({ name: "edited", version: 2, updated_by: fx.actorB });
  const v3 = img({ name: "edited", version: 3, updated_by: fx.ghostActor });

  const inserted = await db
    .insert(auditLog)
    .values([
      { tableName: TBL, op: "INSERT", rowId: "1", actorId: fx.actorA, at: new Date("2026-01-01T00:00:00Z"), before: null, after: v1 },
      // A REAL edit: `name` changed (plus the attribution the triggers bump).
      { tableName: TBL, op: "UPDATE", rowId: "1", actorId: fx.actorB, at: new Date("2026-02-01T00:00:00Z"), before: v1, after: v2 },
      // The PHANTOM: stampedDelete's pre-stamp — only updated_by/updated_at/version move.
      { tableName: TBL, op: "UPDATE", rowId: "1", actorId: fx.ghostActor, at: new Date("2026-03-01T00:00:00Z"), before: v2, after: v3 },
      { tableName: TBL, op: "DELETE", rowId: "1", actorId: fx.ghostActor, at: new Date("2026-04-01T00:00:00Z"), before: v3, after: null },
    ])
    .returning({ id: auditLog.id });
  fx.tblIds = inserted.map((r) => r.id);

  // --- TBL2: one row, same actor as TBL's INSERT — makes the
  // tableName+actorId COMBINATION test discriminating (filtering on either
  // alone would return two rows). ---
  await db.insert(auditLog).values({
    tableName: TBL2,
    op: "INSERT",
    rowId: "9",
    actorId: fx.actorA,
    at: new Date("2026-02-15T00:00:00Z"),
    before: null,
    after: img({ id: 9 }),
  });

  // --- NTBL: NULL-actor rows interleaved with a named one. The interleaving is
  // the point: a filter that ignored the actor entirely would return all three,
  // so "returns exactly the two NULL rows" is discriminating. ---
  const nInserted = await db
    .insert(auditLog)
    .values([
      { tableName: NTBL, op: "INSERT" as const, rowId: "1", actorId: null, at: new Date("2026-06-01T00:00:00Z"), before: null, after: img({ id: 1 }) },
      { tableName: NTBL, op: "UPDATE" as const, rowId: "1", actorId: fx.actorA, at: new Date("2026-06-02T00:00:00Z"), before: img({ id: 1 }), after: img({ id: 1, name: "by a human" }) },
      { tableName: NTBL, op: "DELETE" as const, rowId: "1", actorId: null, at: new Date("2026-06-03T00:00:00Z"), before: img({ id: 1, name: "by a human" }), after: null },
    ])
    .returning({ id: auditLog.id });
  fx.ntblIds = nInserted.map((r) => r.id);

  // --- PGTBL: 60 rows, purely for pagination. ---
  await db.insert(auditLog).values(
    Array.from({ length: 60 }, (_, i) => ({
      tableName: PGTBL,
      op: "INSERT" as const,
      rowId: String(i + 1),
      actorId: fx.actorA,
      at: new Date("2026-05-01T00:00:00Z"),
      before: null,
      after: img({ id: i + 1 }),
    })),
  );
});

afterAll(async () => {
  // Every audit row this file wrote, by our own synthetic table names…
  await db.delete(auditLog).where(inArray(auditLog.tableName, [TBL, TBL2, PGTBL, NTBL]));
  // …plus the rows the users triggers wrote for the three throwaway users
  // (INSERT on create, DELETE on removal). Scoped by table + rowId, no op
  // filter, mirroring audit-behavior.test.ts.
  const userIds = [fx.actorA, fx.actorB, fx.ghostActor].filter(Boolean);
  if (userIds.length) {
    await db.delete(users).where(inArray(users.id, userIds));
    for (const id of userIds) {
      await db.delete(auditLog).where(and(eq(auditLog.tableName, "users"), eq(auditLog.rowId, String(id))));
    }
  }
});

describe("listAuditEntries / listAuditFilterOptions — authorization", () => {
  it("rejects a non-super-admin on listAuditEntries", async () => {
    await expect(listAuditEntries(NOT_SUPER, { tableName: TBL })).rejects.toThrow(/Super Admin/i);
  });

  it("rejects a non-super-admin on listAuditFilterOptions", async () => {
    await expect(listAuditFilterOptions(NOT_SUPER)).rejects.toThrow(/Super Admin/i);
  });

  it("rejects every non-super role individually — no role but super-admin gets in", async () => {
    for (const role of ["viewer", "sales", "hr", "delivery"] as const) {
      await expect(listAuditEntries({ id: 2, roles: [role] }, { tableName: TBL })).rejects.toThrow(/Super Admin/i);
    }
  });
});

describe("listAuditEntries — ordering", () => {
  it("returns newest first (id DESC), not insertion order", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL });
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.id)).toEqual([...fx.tblIds].reverse());
    // Corroborated by a field that isn't the sort key, so a coincidentally
    // correct id order can't carry this on its own.
    expect(entries.map((e) => e.op)).toEqual(["DELETE", "UPDATE", "UPDATE", "INSERT"]);
    // Strictly descending — rules out a stable-but-unsorted result.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].id).toBeGreaterThan(entries[i].id);
    }
  });
});

describe("listAuditEntries — filters", () => {
  it("filters by tableName", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL2 });
    expect(entries).toHaveLength(1);
    expect(entries[0].tableName).toBe(TBL2);
    expect(entries[0].rowId).toBe("9");
  });

  it("filters by op", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL, op: "UPDATE" });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.op === "UPDATE")).toBe(true);
    const del = await listAuditEntries(SUPER, { tableName: TBL, op: "DELETE" });
    expect(del.entries).toHaveLength(1);
    expect(del.entries[0].after).toBeNull();
  });

  it("filters by actorId", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL, actorId: fx.actorB });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorId).toBe(fx.actorB);
    expect(entries[0].id).toBe(fx.tblIds[1]);
  });

  it("filters by the NULL actor via AUDIT_ACTOR_NONE — the 40% no numeric id can reach", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: NTBL, actorId: AUDIT_ACTOR_NONE });
    // Exactly the two actor-less rows, newest first — not all three.
    expect(entries.map((e) => e.id)).toEqual([fx.ntblIds[2], fx.ntblIds[0]]);
    for (const e of entries) {
      expect(e.actorId).toBeNull();
      expect(e.actorName).toBeNull();
    }
  });

  it("AUDIT_ACTOR_NONE and a numeric actor id are disjoint and together cover the table", async () => {
    // The complement: asking for the named actor must NOT sweep in NULL rows,
    // which is the mistake a `WHERE actor_id = $1 OR actor_id IS NULL` would make.
    const named = await listAuditEntries(SUPER, { tableName: NTBL, actorId: fx.actorA });
    expect(named.entries.map((e) => e.id)).toEqual([fx.ntblIds[1]]);

    const none = await listAuditEntries(SUPER, { tableName: NTBL, actorId: AUDIT_ACTOR_NONE });
    const all = await listAuditEntries(SUPER, { tableName: NTBL });
    expect(named.entries.length + none.entries.length).toBe(all.entries.length);
    expect(all.entries).toHaveLength(3);
  });

  it("combines AUDIT_ACTOR_NONE with the other filters (still AND)", async () => {
    const { entries } = await listAuditEntries(SUPER, {
      tableName: NTBL,
      actorId: AUDIT_ACTOR_NONE,
      op: "DELETE",
    });
    expect(entries.map((e) => e.id)).toEqual([fx.ntblIds[2]]);
  });

  it("filters by date range (inclusive both ends)", async () => {
    const { entries } = await listAuditEntries(SUPER, {
      tableName: TBL,
      from: new Date("2026-02-01T00:00:00Z"),
      to: new Date("2026-03-01T00:00:00Z"),
    });
    expect(entries.map((e) => e.id)).toEqual([fx.tblIds[2], fx.tblIds[1]]);

    const openEnded = await listAuditEntries(SUPER, { tableName: TBL, from: new Date("2026-03-15T00:00:00Z") });
    expect(openEnded.entries.map((e) => e.id)).toEqual([fx.tblIds[3]]);

    const upTo = await listAuditEntries(SUPER, { tableName: TBL, to: new Date("2026-01-15T00:00:00Z") });
    expect(upTo.entries.map((e) => e.id)).toEqual([fx.tblIds[0]]);
  });

  it("combines filters (AND, not OR)", async () => {
    // actorA has one row in TBL and one in TBL2; TBL has four rows. Only the
    // intersection may come back — which is what makes this discriminating.
    const both = await listAuditEntries(SUPER, { tableName: TBL, actorId: fx.actorA });
    expect(both.entries.map((e) => e.id)).toEqual([fx.tblIds[0]]);

    const three = await listAuditEntries(SUPER, {
      tableName: TBL,
      actorId: fx.ghostActor,
      op: "UPDATE",
      from: new Date("2026-02-15T00:00:00Z"),
      to: new Date("2026-03-15T00:00:00Z"),
    });
    expect(three.entries.map((e) => e.id)).toEqual([fx.tblIds[2]]);

    // A combination with an empty intersection returns nothing, rather than
    // silently degrading to a single-filter result.
    const none = await listAuditEntries(SUPER, { tableName: TBL2, actorId: fx.actorB });
    expect(none.entries).toEqual([]);
    expect(none.hasMore).toBe(false);
  });
});

describe("listAuditEntries — pagination", () => {
  it("pages at 50 and page 2 repeats nothing from page 1", async () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
    const p1 = await listAuditEntries(SUPER, { tableName: PGTBL }, 1);
    expect(p1.entries).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    expect(p1.page).toBe(1);

    const p2 = await listAuditEntries(SUPER, { tableName: PGTBL }, 2);
    expect(p2.entries).toHaveLength(10);
    expect(p2.hasMore).toBe(false); // 60 rows exactly — no phantom third page

    const ids1 = new Set(p1.entries.map((e) => e.id));
    expect(p2.entries.some((e) => ids1.has(e.id))).toBe(false);
    // The two pages together are the whole set, in one continuous descending run.
    expect(p1.entries[49].id).toBeGreaterThan(p2.entries[0].id);
    expect(ids1.size + p2.entries.length).toBe(60);
  });

  it("treats a nonsensical page number as page 1 rather than a negative offset", async () => {
    const p = await listAuditEntries(SUPER, { tableName: PGTBL }, 0);
    expect(p.page).toBe(1);
    expect(p.entries).toHaveLength(50);
  });

  it("returns an empty page past the end", async () => {
    const p = await listAuditEntries(SUPER, { tableName: PGTBL }, 3);
    expect(p.entries).toEqual([]);
    expect(p.hasMore).toBe(false);
  });
});

describe("listAuditEntries — actor resolution", () => {
  it("resolves the actor's name via the join, with no per-row query", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL, actorId: fx.actorB });
    expect(entries[0].actorName).toBe(`AuditViewer B ${RUN}`);
  });

  it("still renders an entry whose actor has been deleted: id preserved, name absent", async () => {
    // The no-FK design (schema.ts:693) is what makes this possible — an FK with
    // ON DELETE SET NULL would have erased the id too, and a plain FK would have
    // blocked the user's deletion outright. Pinning it here so a future
    // "helpful" .references() on actor_id fails loudly.
    await db.delete(users).where(eq(users.id, fx.ghostActor));

    const { entries } = await listAuditEntries(SUPER, { tableName: TBL, actorId: fx.ghostActor });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.actorId).toBe(fx.ghostActor); // the id outlives the user
      expect(e.actorName).toBeNull(); // …but the name is honestly absent, not invented
    }
    // And the entry is otherwise intact — the row images survive too.
    const del = entries.find((e) => e.op === "DELETE")!;
    expect((del.before as Record<string, unknown>).name).toBe("edited");
  });
});

describe("listAuditEntries — isStampOnly", () => {
  it("flags the phantom stamp UPDATE and not the real edit", async () => {
    const { entries } = await listAuditEntries(SUPER, { tableName: TBL });
    const byId = new Map(entries.map((e) => [e.id, e]));

    const realEdit = byId.get(fx.tblIds[1])!;
    expect(realEdit.op).toBe("UPDATE");
    expect(realEdit.isStampOnly).toBe(false);
    expect(realEdit.changedFields.map((c) => c.key)).toContain("name");

    const phantom = byId.get(fx.tblIds[2])!;
    expect(phantom.op).toBe("UPDATE");
    expect(phantom.isStampOnly).toBe(true);
    expect(phantom.changedFields.map((c) => c.key).sort()).toEqual(["updated_by", "version"]);

    // INSERT and DELETE are never suppressed, whatever their fields.
    expect(byId.get(fx.tblIds[0])!.isStampOnly).toBe(false);
    expect(byId.get(fx.tblIds[3])!.isStampOnly).toBe(false);
  });
});

describe("listAuditFilterOptions", () => {
  it("offers the table names and actors that actually appear in the log", async () => {
    const opts = await listAuditFilterOptions(SUPER);
    expect(opts.tableNames).toContain(TBL);
    expect(opts.tableNames).toContain(TBL2);
    expect(opts.tableNames).toContain(PGTBL);
    expect(opts.tableNames).toContain(NTBL);
    // Alphabetical, so the dropdown is navigable. Compared with localeCompare,
    // not the default codepoint sort: Postgres orders by the DB collation,
    // which ignores punctuation ("zzaudit2_x" before "zzaudit_x") where a
    // codepoint sort would not. Either is "alphabetical"; what matters is that
    // the list is ordered at all.
    expect([...opts.tableNames].sort((a, b) => a.localeCompare(b))).toEqual(opts.tableNames);

    const ids = opts.actors.map((a) => a.id);
    expect(ids).toContain(fx.actorA);
    expect(ids).toContain(fx.actorB);
    expect(new Set(ids).size).toBe(ids.length); // distinct — one option per actor
    expect(opts.actors.every((a) => a.id !== null)).toBe(true); // NULL is not an actor
    expect(opts.actors.find((a) => a.id === fx.actorA)?.name).toBe(`AuditViewer A ${RUN}`);
    // The deleted ghost still appears (its rows are still in the log) but has
    // no name — same honesty rule as the entries themselves.
    const ghost = opts.actors.find((a) => a.id === fx.ghostActor);
    expect(ghost).toBeDefined();
    expect(ghost!.name).toBeNull();
  });
});

describe("changedFields — pure diff", () => {
  it("UPDATE: picks only the keys whose values differ", () => {
    const diff = changedFields(
      { id: 1, name: "a", amount: 100, note: "same" },
      { id: 1, name: "b", amount: 250, note: "same" },
    );
    expect(diff).toEqual([
      { key: "amount", before: 100, after: 250 },
      { key: "name", before: "a", after: "b" },
    ]);
  });

  it("UPDATE: excludes unchanged values, including deep-equal objects and arrays", () => {
    // jsonb round-trips as fresh objects, so a reference compare would report
    // these as changed — this is the assertion that catches that mistake.
    const diff = changedFields(
      { meta: { a: 1, b: [1, 2, { c: 3 }] }, tags: ["x", "y"], n: 0 },
      { meta: { b: [1, 2, { c: 3 }], a: 1 }, tags: ["x", "y"], n: 0 },
    );
    expect(diff).toEqual([]);
  });

  it("UPDATE: array order IS significant, object key order is NOT", () => {
    expect(changedFields({ t: ["a", "b"] }, { t: ["b", "a"] })).toHaveLength(1);
    expect(changedFields({ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } })).toEqual([]);
  });

  it("INSERT: shows the whole new row with before undefined", () => {
    const diff = changedFields(null, { id: 7, name: "new", note: null });
    expect(diff).toEqual([
      { key: "id", before: undefined, after: 7 },
      { key: "name", before: undefined, after: "new" },
      { key: "note", before: undefined, after: null },
    ]);
  });

  it("DELETE: shows the whole erased row with after undefined", () => {
    const diff = changedFields({ id: 7, name: "gone" }, null);
    expect(diff).toEqual([
      { key: "id", before: 7, after: undefined },
      { key: "name", before: "gone", after: undefined },
    ]);
  });

  it("null handling: null→value and value→null are changes; null→null is not", () => {
    expect(changedFields({ a: null, b: 1, c: null }, { a: 2, b: null, c: null })).toEqual([
      { key: "a", before: null, after: 2 },
      { key: "b", before: 1, after: null },
    ]);
  });

  it("missing key vs explicit null are DIFFERENT — a dropped/added column shows up", () => {
    // Documented policy: "column holds SQL NULL" and "column absent from the
    // image" are distinct facts, and an auditor wants to see the difference.
    expect(changedFields({ a: 1 }, { a: 1, b: null })).toEqual([{ key: "b", before: undefined, after: null }]);
    expect(changedFields({ a: 1, b: null }, { a: 1 })).toEqual([{ key: "b", before: null, after: undefined }]);
    // A key missing on BOTH sides simply never appears.
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("returns keys sorted, so a diff renders in a stable order", () => {
    const diff = changedFields({ z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 });
    expect(diff.map((c) => c.key)).toEqual(["a", "m", "z"]);
  });

  it("tolerates absent/degenerate images without throwing", () => {
    expect(changedFields(null, null)).toEqual([]);
    expect(changedFields(undefined, undefined)).toEqual([]);
    // A non-object jsonb payload (shouldn't happen, but jsonb permits it) is
    // treated as "no image" rather than crashing the whole viewer page.
    expect(changedFields("scalar", 42)).toEqual([]);
  });
});

describe("isStampOnlyUpdate — pure", () => {
  it("is true for an attribution-only UPDATE and for an empty diff", () => {
    expect(
      isStampOnlyUpdate("UPDATE", [
        { key: "updated_by", before: 1, after: 2 },
        { key: "updated_at", before: "t1", after: "t2" },
        { key: "version", before: 1, after: 2 },
      ]),
    ).toBe(true);
    expect(isStampOnlyUpdate("UPDATE", [])).toBe(true);
  });

  it("is false as soon as one real field moves", () => {
    expect(
      isStampOnlyUpdate("UPDATE", [
        { key: "updated_by", before: 1, after: 2 },
        { key: "version", before: 1, after: 2 },
        { key: "amount", before: 100, after: 200 },
      ]),
    ).toBe(false);
  });

  it("is false for INSERT and DELETE regardless of fields", () => {
    const attribution = [{ key: "updated_by", before: undefined, after: 2 }];
    expect(isStampOnlyUpdate("INSERT", attribution)).toBe(false);
    expect(isStampOnlyUpdate("DELETE", attribution)).toBe(false);
  });
});
