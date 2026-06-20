/**
 * One-off, idempotent DDL to move `tasks` from free-text (account/oem/assignee)
 * to real FKs (account_id → accounts, assignee_id → users). Applied directly
 * because drizzle-kit push needs a TTY to resolve the column rename ambiguity.
 * After this runs, the live schema matches lib/db/schema.ts (push sees no diff).
 *
 * Run: npx tsx scripts/migrate-tasks.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../lib/db/client");

  await db.execute(sql.raw(`ALTER TABLE tasks DROP COLUMN IF EXISTS account`));
  await db.execute(sql.raw(`ALTER TABLE tasks DROP COLUMN IF EXISTS oem`));
  await db.execute(sql.raw(`ALTER TABLE tasks DROP COLUMN IF EXISTS assignee`));
  await db.execute(
    sql.raw(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_id integer REFERENCES accounts(id) ON DELETE SET NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id integer REFERENCES users(id) ON DELETE SET NULL`,
    ),
  );
  // Real start/due dates replace the free-text `due`.
  await db.execute(sql.raw(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date`));
  await db.execute(sql.raw(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date date`));
  await db.execute(sql.raw(`ALTER TABLE tasks DROP COLUMN IF EXISTS due`));
  await db.execute(sql.raw(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamp`));

  // New lifecycle state: backlog → open → progress → … (positioned before progress).
  await db.execute(sql.raw(`ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'open' BEFORE 'progress'`));

  // Worklog / comment thread.
  await db.execute(sql.raw(`CREATE TYPE task_comment_kind AS ENUM ('worklog', 'comment')`)).catch(() => {});
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS task_comments (
      id serial PRIMARY KEY,
      task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind task_comment_kind NOT NULL DEFAULT 'comment',
      author text NOT NULL,
      body text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )`),
  );

  console.log("tasks migrated: +completed_at, +status 'open', + task_comments table.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
