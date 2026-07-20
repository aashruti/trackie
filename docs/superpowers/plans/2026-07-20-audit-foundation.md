# Audit Foundation (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every domain table base-entity columns (`created_at/updated_at/created_by/updated_by/version`) and attach Postgres triggers that write a generic `audit_log` row for every INSERT/UPDATE/DELETE, with the actor carried *inside* the mutation (`updated_by`) so it survives neon-http's stateless requests — changing no existing data.

**Architecture:** One idempotent migration adds columns + `audit_log` + two trigger functions (`stamp_row`, `audit_row`) + triggers on the 29 audited tables (32 total minus the 3-table skiplist). Drizzle schema gains a `baseColumns` spread. DAL mutations thread `actor.id` into `created_by`/`updated_by`; deletes become stamp-then-delete via a `stampedDelete` helper. A coverage test fails CI if any non-skiplisted table lacks the columns or triggers. Byte-parity of `/reports` before/after the migration proves no data moved.

**Tech Stack:** Drizzle ORM, Postgres (neon-http in prod, postgres.js local), plpgsql triggers, Vitest.

**Scope note:** This is PR 1 of three (foundation → viewer → bill-delete). The `/admin/audit` viewer and bill deletion are separate plans per the spec.

**The 32 tables** (var → sql name). **Skiplist (NOT audited):** `audit_log` (recursion), `auth_sessions` (login noise), `attendance_punches` (bulk import; the `attendance_uploads` row is the audited event). **Audited: the other 29**, including composite-PK `user_accounts` & `user_roles` (security-relevant grants).

```
oems, account_groups, accounts, academic_years, invoices, cohorts, payments, users,
user_accounts*, user_roles*, tasks, task_comments, leads, lead_followups, lead_activities,
shifts, employee_profiles, holidays, hr_settings, leave_types, leave_balances, leave_requests,
attendance_uploads, attendance_records, payroll_runs, payslips, delivery_methods, programs,
delivery_events, delivery_activities
(* = composite PK, no `id` column)
SKIP: auth_sessions, attendance_punches, (and audit_log once created)
```

---

## Phase A — Migration + schema + triggers (no behavior change)

### Task A1: `baseColumns` helper in the Drizzle schema

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the helper near the top of `lib/db/schema.ts`** (after the imports/enums, before the first `pgTable`). `users` is referenced lazily so ordering doesn't matter.

```ts
// Base-entity columns on every audited table. created_by/updated_by are the
// actor-delivery mechanism for the audit triggers (the app writes updated_by on
// every mutation; the trigger reads it) — nullable because pre-migration rows,
// seed scripts, and the users self-reference have no known author. updated_at
// and version are maintained by the stamp_row() trigger, never by app code.
export const baseColumns = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: integer("created_by").references((): any => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references((): any => users.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
};
```

- [ ] **Step 2: Apply `...baseColumns` to each of the 29 audited tables.** For a table with NO existing `created_at`, insert `...baseColumns,` after `id`. For a table that ALREADY declares `createdAt` (accounts? no — the 12 are: account_groups, users, tasks, task_comments, leads, lead_followups, employee_profiles, leave_requests, attendance_uploads, programs, delivery_events, delivery_activities; plus hr_settings has updatedAt), **remove that individual `createdAt:`/`updatedAt:` line** and add `...baseColumns,` so the column isn't declared twice. Do NOT add to the 3 skiplisted tables.

Example (users — remove its `createdAt` line, add the spread):

```ts
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  ...baseColumns,
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("viewer"),
  emailVerifiedAt: timestamp("email_verified_at"),
});
```

- [ ] **Step 3: Add the `auditLog` table** at the end of `schema.ts` (no `...baseColumns` — it is not audited):

```ts
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at").notNull().defaultNow(),
    tableName: text("table_name").notNull(),
    op: text("op").notNull(), // INSERT | UPDATE | DELETE
    rowId: text("row_id"), // text so it survives the row's deletion; null for composite-PK tables
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => ({
    byTable: index("audit_log_table_at_idx").on(t.tableName, t.at),
    byActor: index("audit_log_actor_at_idx").on(t.actorId, t.at),
  }),
);
```

Add `bigserial` to the `drizzle-orm/pg-core` import list at the top.

- [ ] **Step 4: Verify it compiles.** Run `npx tsc --noEmit`. Expected: exit 0. (No DB yet — this is type-only.)

### Task A2: The migration SQL

**Files:**
- Create: `drizzle/0016_audit_foundation.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write `drizzle/0016_audit_foundation.sql`.** Fully idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`). `ADD COLUMN IF NOT EXISTS` is what makes it change no data on the 12 tables that already have `created_at`.

```sql
-- audit foundation: base-entity columns + generic audit triggers.
-- Additive only: adds columns (new values), one empty table, two functions,
-- and triggers. No existing row is read, updated, or deleted.

-- 1) audit_log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY,
  "at" timestamptz NOT NULL DEFAULT now(),
  "table_name" text NOT NULL,
  "op" text NOT NULL,
  "row_id" text,
  "actor_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "before" jsonb,
  "after" jsonb
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_table_at_idx" ON "audit_log" ("table_name","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_at_idx" ON "audit_log" ("actor_id","at");--> statement-breakpoint

-- 2) base columns on every audited table (29). ADD COLUMN IF NOT EXISTS is
--    idempotent and skips columns that already exist, so no data is rewritten.
--    (repeat this block per table — full list below)
ALTER TABLE "oems"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;--> statement-breakpoint
-- ... identical ALTER for each of these 29 tables (same five columns):
--   oems, account_groups, accounts, academic_years, invoices, cohorts, payments,
--   users, user_accounts, user_roles, tasks, task_comments, leads, lead_followups,
--   lead_activities, shifts, employee_profiles, holidays, hr_settings, leave_types,
--   leave_balances, leave_requests, attendance_uploads, attendance_records,
--   payroll_runs, payslips, delivery_methods, programs, delivery_events,
--   delivery_activities
-- (each ALTER is its own --> statement-breakpoint)

-- 3) trigger functions
CREATE OR REPLACE FUNCTION stamp_row() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE v_actor int; v_row text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_actor := (to_jsonb(OLD) ->> 'updated_by')::int;
    v_row := to_jsonb(OLD) ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, to_jsonb(OLD), NULL);
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_actor := (to_jsonb(NEW) ->> 'updated_by')::int;
    v_row := to_jsonb(NEW) ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    v_actor := (to_jsonb(NEW) ->> 'updated_by')::int;
    v_row := to_jsonb(NEW) ->> 'id';
    INSERT INTO audit_log(table_name, op, row_id, actor_id, before, after)
      VALUES (TG_TABLE_NAME, TG_OP, v_row, v_actor, NULL, to_jsonb(NEW));
    RETURN NEW;
  END IF;
END; $$ LANGUAGE plpgsql;--> statement-breakpoint

-- 4) triggers on each audited table (repeat per the 29 tables above)
DROP TRIGGER IF EXISTS "trg_stamp" ON "oems";--> statement-breakpoint
CREATE TRIGGER "trg_stamp" BEFORE UPDATE ON "oems" FOR EACH ROW EXECUTE FUNCTION stamp_row();--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_audit" ON "oems";--> statement-breakpoint
CREATE TRIGGER "trg_audit" AFTER INSERT OR UPDATE OR DELETE ON "oems" FOR EACH ROW EXECUTE FUNCTION audit_row();--> statement-breakpoint
-- ... identical trg_stamp + trg_audit pair for each of the other 28 tables
```

**Generation note for the implementer:** the 29 ALTER blocks and 29 trigger pairs are byte-identical except the table name. Generate them programmatically (a throwaway node/tsx loop over the table-name array) and paste, rather than hand-typing 58 blocks. Verify the final file has exactly 29 `ALTER TABLE`, 29 `trg_stamp`, 29 `trg_audit`.

- [ ] **Step 2: Register the migration in `drizzle/meta/_journal.json`** — append an entry `{ "idx": 16, "version": "7", "when": <copy the format of the last entry>, "tag": "0016_audit_foundation", "breakpoints": true }`. Match the existing entries' shape exactly.

- [ ] **Step 3: Apply locally.** Run `npx tsx scripts/db-migrate.ts` (targets LOCAL — confirm the printed host is localhost, NOT prod). Expected: applies 0016, exit 0.

- [ ] **Step 4: Sanity-check the DB.** Run a tsx one-liner: assert `audit_log` exists and empty; `SELECT count(*) FROM information_schema.columns WHERE column_name IN ('created_by','updated_by','version')` returns 29×3 = 87; `SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_stamp','trg_audit')` returns 58. Expected: those counts.

### Task A3: Byte-parity proof — the migration changed no data

**Files:**
- Create (throwaway, delete after): a capture script under the scratchpad.

- [ ] **Step 1:** Before this task you already applied the migration. Capture reports AFTER, and compare to a BEFORE snapshot. Since the migration is already applied, regenerate BEFORE from a pre-migration checkout OR (simpler) rely on the money-engine argument + the test suite: run the FULL suite `npx vitest run` on the migrated schema. Expected: same pass count as `main` (no test reads/asserts the new columns yet). Record the number.

- [ ] **Step 2 (stronger, do it):** In the browser (dev server), open `/reports` signed in as super-admin, capture the rendered table totals (billing basis, receipts, outstanding, net margin) and the XLSX export bytes. These must match the values observed before 0016 (the money engine reads none of the new columns). Note any difference — a difference is a STOP-and-investigate.

---

## Phase B — Thread the actor into every mutation

The mechanism: every INSERT sets `createdBy`/`updatedBy`; every UPDATE sets `updatedBy`; every DELETE becomes stamp-then-delete. `created_at`/`updated_at`/`version` are never set by app code (defaults + `stamp_row`).

### Task B1: The `stampedDelete` helper + actor plumbing

**Files:**
- Create: `lib/dal/audit.ts`
- Test: `lib/dal/audit.test.ts`

- [ ] **Step 1: Write the failing test** `lib/dal/audit.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oems, auditLog } from "@/lib/db/schema";
import { stampedDelete } from "./audit";

describe("stampedDelete — the delete carries the deleter", () => {
  const made: number[] = [];
  afterAll(async () => { for (const id of made) await db.delete(oems).where(eq(oems.id, id)).catch(() => {}); });

  it("stamps updated_by then deletes, so the DELETE audit row shows the actor", async () => {
    const [o] = await db.insert(oems).values({ name: `AuditTmp ${Date.now()}`, createdBy: 1, updatedBy: 1 }).returning({ id: oems.id });
    await stampedDelete(oems, o.id, 3); // actor 3 deletes
    const gone = await db.select().from(oems).where(eq(oems.id, o.id));
    expect(gone.length).toBe(0);
    const [del] = await db.select().from(auditLog)
      .where(eq(auditLog.rowId, String(o.id)))
      .orderBy(auditLog.at);
    const delRow = (await db.select().from(auditLog).where(eq(auditLog.rowId, String(o.id)))).find((r) => r.op === "DELETE");
    expect(delRow?.actorId).toBe(3); // the deleter, not the creator
  });
});
```

- [ ] **Step 2: Run it — expect failure** (`stampedDelete` undefined). `npx vitest run lib/dal/audit.test.ts`.

- [ ] **Step 3: Implement `lib/dal/audit.ts`:**

```ts
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";

/**
 * Delete a row so the DELETE audit trigger records the ACTOR, not the last
 * editor. The trigger reads OLD.updated_by, so we stamp it first, then delete.
 * Not atomic on neon-http (no transactions) — but the failure mode is benign:
 * a failed delete leaves only a touched updated_by/version, no data lost.
 * The table MUST have base columns (every audited table does).
 */
export async function stampedDelete(table: PgTable, id: number, actorId: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  await db.update(table).set({ updatedBy: actorId }).where(eq(t.id, id));
  await db.delete(table).where(eq(t.id, id));
}
```

- [ ] **Step 4: Run it — expect pass.** `npx vitest run lib/dal/audit.test.ts`. Expected: PASS. Commit.

### Task B2 … B(n): Thread actor per DAL file

For each file below, apply the three rules. Every listed mutation already has (or its function receives) a `SessionUser`/`actor` — use `actor.id`. Where a mutation function currently has no actor param (notably parts of `lib/dal/tasks.ts`, `lib/dal/sessions.ts`, `lib/dal/email-verify.ts`, `lib/dal/hr/holidays.ts` accrual), add an `actorId: number` (or `actor: SessionUser`) parameter and thread it from the caller (server action / page), mirroring the roles[] refactor. `sessions.ts` writes `auth_sessions` (skiplisted) — **no stamping needed there**; leave it.

**Rules:**
- INSERT `.values({ ...existing, createdBy: actor.id, updatedBy: actor.id })` (arrays: map each element).
- UPDATE `.set({ ...existing, updatedBy: actor.id })`.
- DELETE → `await stampedDelete(<table>, <id>, actor.id)` (replaces `db.delete(...)`), UNLESS the table is skiplisted.

Do it one file per task, run `npx tsc --noEmit` + that file's test after each, commit. Exact sites (from inventory):

- [ ] **B2 `lib/dal/account-admin.ts`** — insert accounts:52, insert invoices:116, plus createInvoice/createAccount/deleteAccount deletes. (deleteDraftInvoice stays for now; PR 3 replaces it.)
- [ ] **B3 `lib/dal/user-admin.ts`** — insert users:84 (+ role scalar), update users:173, the delete/insert in setUserRoles/setUserAccounts (`user_roles`/`user_accounts` — audited, composite PK: add createdBy/updatedBy to the mapped `.values`), deleteUser.
- [ ] **B4 `lib/dal/leads.ts`** — update leads:198, insert leadFollowups:212, insert leadActivities:245, update leads:339, insert leads:353 (+ any delete).
- [ ] **B5 `lib/dal/mutations.ts`** — its 4 insert/update/delete sites (payments record/delete, invoice edits — thread actor).
- [ ] **B6 `lib/dal/payments.ts`** — record/delete payment (delete → stampedDelete(payments, id, actor.id)).
- [ ] **B7 `lib/dal/groups.ts`** — update accounts:320/328, update accountGroups:391, group create/delete.
- [ ] **B8 `lib/dal/rollover.ts`** — insert academicYears:154, insert invoices:221, insert cohorts:242 (bulk maps — set createdBy/updatedBy on each).
- [ ] **B9 `lib/dal/tasks.ts`** — insert taskComments:113, update tasks:211, insert tasks:259 (add `actorId` param; thread from `app/(app)/team/actions.ts` + `delivery/*` actions).
- [ ] **B10 `lib/dal/hr/employees.ts`** — insert employeeProfiles:135, update employeeProfiles:173/203.
- [ ] **B11 `lib/dal/hr/leave.ts`** — inserts leaveBalances/leaveRequests/attendanceRecords/employeeProfiles (254,319,437,451,556,605), updates leaveRequests/leaveBalances (379,464,469). `getOrCreateEmployeeForUser` provisions for `userId` — stamp createdBy/updatedBy = that userId.
- [ ] **B12 `lib/dal/hr/attendance.ts`** — insert attendanceUploads:171, insert attendanceRecords:207/337/350 (bulk).
- [ ] **B13 `lib/dal/hr/payroll.ts`** — update payrollRuns:511 + payslip insert/delete-and-reinsert.
- [ ] **B14 `lib/dal/hr/holidays.ts`** — insert/delete attendanceRecords:32/51, insert holidays:84 (add actor param).
- [ ] **B15 `lib/dal/delivery/programs.ts`** — its 4 sites (create/update/status/delete program).
- [ ] **B16 `lib/dal/delivery/events.ts`** — insert deliveryEvents:78, insert deliveryActivities:124, updates/deletes.
- [ ] **B17 `lib/dal/delivery/methods.ts`** — update deliveryMethods:90/107, insert.
- [ ] **B18 `app/(app)/profile/actions.ts:71`** — `db.update(users).set({ passwordHash })` → add `updatedBy: userId`.
- [ ] **B19 `lib/dal/email-verify.ts:25`** — `update(users)` on verification: stamp `updatedBy` = that user's id (self-service).

After each: `npx tsc --noEmit` clean; run the file's existing test if any; commit.

---

## Phase C — Coverage test + full verification

### Task C1: Coverage-enforcement test

**Files:**
- Create: `lib/db/audit-coverage.test.ts`

- [ ] **Step 1: Write the test** (introspects the live local DB):

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

const SKIP = new Set(["audit_log", "auth_sessions", "attendance_punches", "__drizzle_migrations"]);

describe("audit coverage — every domain table is instrumented", () => {
  it("has the 5 base columns and both triggers on every non-skiplisted public table", async () => {
    const tables = (await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows as { table_name: string }[];
    const cols = (await db.execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('created_at','updated_at','created_by','updated_by','version')`)).rows as { table_name: string; column_name: string }[];
    const trigs = (await db.execute(sql`
      SELECT c.relname AS table_name, t.tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`)).rows as { table_name: string; tgname: string }[];

    const colBy = new Map<string, Set<string>>();
    for (const r of cols) { (colBy.get(r.table_name) ?? colBy.set(r.table_name, new Set()).get(r.table_name)!).add(r.column_name); }
    const trigBy = new Map<string, Set<string>>();
    for (const r of trigs) { (trigBy.get(r.table_name) ?? trigBy.set(r.table_name, new Set()).get(r.table_name)!).add(r.tgname); }

    const missing: string[] = [];
    for (const { table_name } of tables) {
      if (SKIP.has(table_name)) continue;
      const c = colBy.get(table_name) ?? new Set();
      for (const need of ["created_at","updated_at","created_by","updated_by","version"]) if (!c.has(need)) missing.push(`${table_name}.${need}`);
      const tg = trigBy.get(table_name) ?? new Set();
      for (const need of ["trg_stamp","trg_audit"]) if (!tg.has(need)) missing.push(`${table_name}:${need}`);
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect PASS** (Phase A added everything). `npx vitest run lib/db/audit-coverage.test.ts`. If it lists a missing table, either instrument it or add it to `SKIP` deliberately.

### Task C2: Audit-behavior integration test

**Files:**
- Create: `lib/dal/audit-behavior.test.ts`

- [ ] **Step 1: Write** a test that, for a throwaway `oems` (or `leads`) row: INSERT writes an audit row `op=INSERT, actor_id=creator, after` set; UPDATE (via a DAL update that sets `updatedBy`) bumps `version` 1→2, sets `updated_at`, and writes `op=UPDATE, actor_id=editor, before/after`; `stampedDelete` writes `op=DELETE, actor_id=deleter`. Also assert a **cascade**: inserting an invoice + a payment, then `stampedDelete(invoices, id, actor)` after stamping the payment, produces DELETE audit rows for BOTH with the actor. Full assertions, no placeholders.
- [ ] **Step 2: Run — expect PASS.** `npx vitest run lib/dal/audit-behavior.test.ts`.

### Task C3: Full verification + PR

- [ ] **Step 1:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 2:** `npx vitest run` → all pass; compare count to the Phase-A baseline (only additions).
- [ ] **Step 3:** Browser: `/reports` totals + XLSX unchanged vs. pre-migration (Phase A snapshot).
- [ ] **Step 4:** Browser smoke: create a lead/task/invoice as super-admin, confirm an `audit_log` row appears with `actor_id` = your user id (proves end-to-end actor capture on the real app path, not just tests).
- [ ] **Step 5:** Open the PR to `main`; strict self-review; ensure the migration deploy note (prod runs 0016 via `vercel-build`; additive + idempotent) is in the PR body.

---

## Self-Review checklist (run before handing off)
- Spec coverage: base columns ✓ (A1/A2), triggers+audit_log ✓ (A2), actor via updated_by ✓ (B), stamp-then-delete ✓ (B1), skiplist ✓ (A2/C1), coverage test ✓ (C1), no-data-change proof ✓ (A3/C3). Viewer + bill-delete are out of scope (separate PRs) — correct.
- Placeholders: the migration's 29-table repetition is generated (A2 step 1 note), not "TODO"; every B-task lists concrete file+sites.
- Type consistency: `baseColumns` field names (`createdBy`/`updatedBy`/`version`) match what B-tasks set and what triggers read (`created_by`/`updated_by`/`version`).
- Composite-PK tables (`user_roles`,`user_accounts`): audited, `row_id` null-safe via `to_jsonb->>'id'` (A2), stamped in `.values` maps (B3) — `stampedDelete` is NOT used for their delete-all (they delete by `userId`, not `id`); B3 keeps their existing `db.delete(...).where(eq(userRoles.userId, ...))` but the AFTER-DELETE audit still fires (actor may be null on that bulk delete — acceptable, the re-insert rows carry the actor). Note this in B3.
