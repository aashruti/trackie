import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

const BASE_COLUMNS = ["created_at", "updated_at", "created_by", "updated_by", "version"];
const TRIGGERS = ["trg_stamp", "trg_audit"];

// Tables deliberately NOT instrumented with base columns + audit triggers.
// Adding a table here is a decision, not a default — justify it.
const SKIP = new Set([
  "audit_log", // the audit trail itself; auditing it would recurse forever
  "auth_sessions", // login/session churn — high volume, zero forensic value
  "attendance_punches", // raw bulk-import rows; the attendance_uploads row is the audited event
  "__drizzle_migrations", // migration bookkeeping, lives in the `drizzle` schema anyway (not `public`) — kept for defense in depth
]);

interface TableRow {
  table_name: string;
}
interface ColumnRow {
  table_name: string;
  column_name: string;
}
interface TriggerRow {
  table_name: string;
  tgname: string;
}

// db.execute()'s return shape differs by driver: neon-http (prod) returns
// { rows: T[] }; postgres-js (local, what this test runs against) returns the
// row array directly. Normalize so the test works against the live local DB.
async function rowsOf<T>(query: Promise<unknown>): Promise<T[]> {
  const result = await query;
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}

describe("audit coverage — every domain table is instrumented", () => {
  it("has the 5 base columns and both triggers on every non-skiplisted public table", async () => {
    const tables = await rowsOf<TableRow>(
      db.execute(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`),
    );

    // Sanity floor: 33 tables exist today. Without this, a wrong DATABASE_URL,
    // an unmigrated/fresh DB, or missing catalog visibility would make `tables`
    // empty, the loop below a no-op, and the test PASS — the worst outcome for
    // a guard whose entire job is to fail loudly when instrumentation is missing.
    expect(tables.length).toBeGreaterThanOrEqual(25);

    const columns = await rowsOf<ColumnRow>(
      db.execute(sql`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('created_at', 'updated_at', 'created_by', 'updated_by', 'version')
        ORDER BY table_name`),
    );

    const triggers = await rowsOf<TriggerRow>(
      db.execute(sql`
        SELECT c.relname AS table_name, t.tgname
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = 'public'`),
    );

    // table_name -> set of column names present on it
    const columnsByTable = new Map<string, Set<string>>();
    for (const { table_name, column_name } of columns) {
      let set = columnsByTable.get(table_name);
      if (!set) {
        set = new Set();
        columnsByTable.set(table_name, set);
      }
      set.add(column_name);
    }

    // table_name -> set of trigger names present on it
    const triggersByTable = new Map<string, Set<string>>();
    for (const { table_name, tgname } of triggers) {
      let set = triggersByTable.get(table_name);
      if (!set) {
        set = new Set();
        triggersByTable.set(table_name, set);
      }
      set.add(tgname);
    }

    const missing: string[] = [];
    for (const { table_name } of tables) {
      if (SKIP.has(table_name)) continue;

      const presentColumns = columnsByTable.get(table_name) ?? new Set<string>();
      for (const column of BASE_COLUMNS) {
        if (!presentColumns.has(column)) missing.push(`${table_name}.${column}`);
      }

      const presentTriggers = triggersByTable.get(table_name) ?? new Set<string>();
      for (const trigger of TRIGGERS) {
        if (!presentTriggers.has(trigger)) missing.push(`${table_name}:${trigger}`);
      }
    }

    // A non-empty array here names exactly which table(s) escaped instrumentation
    // and what's missing on each — e.g. "foo.created_by", "foo:trg_audit".
    expect(missing).toEqual([]);
  });
});
