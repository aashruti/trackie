/**
 * Full idempotent production migration — runs ALL schema changes in order.
 * Safe to run on a DB that already has accounts/invoices/users but is missing
 * the workspace tables (tasks, leads, lead_followups, etc.).
 *
 * Run:
 *   DATABASE_URL="postgres://...neon.tech/neondb?sslmode=require" \
 *     npx tsx scripts/migrate-production.ts
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exec(db: any, stmt: string, label: string) {
  try {
    await db.execute(sql.raw(stmt));
    console.log(`  ✓ ${label}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ↷ ${label} (already done)`);
    } else {
      throw e;
    }
  }
}

async function main() {
  const { db } = await import("../lib/db/client");

  console.log("\n── Step 1: Enums ──────────────────────────────────────────");
  // PostgreSQL doesn't support CREATE TYPE IF NOT EXISTS — use DO/EXCEPTION instead
  const enums: [string, string] = ["", ""];
  void enums;
  for (const [name, values, label] of [
    ["activity_type", `'call', 'email', 'meeting', 'note'`, "enum activity_type"],
    ["lead_stage", `'new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'`, "enum lead_stage"],
    ["task_priority", `'high', 'medium', 'low'`, "enum task_priority"],
    ["task_status", `'backlog', 'open', 'progress', 'review', 'blocked', 'done'`, "enum task_status"],
    ["task_comment_kind", `'worklog', 'comment'`, "enum task_comment_kind"],
  ] as const) {
    await exec(
      db,
      `DO $$ BEGIN CREATE TYPE ${name} AS ENUM(${values}); EXCEPTION WHEN duplicate_object THEN null; END $$`,
      label,
    );
  }

  await exec(db, `ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'lost' AFTER 'won'`, "lead_stage + lost");
  await exec(db, `ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'open' BEFORE 'progress'`, "task_status + open");

  console.log("\n── Step 2: New tables ─────────────────────────────────────");
  await exec(db, `CREATE TABLE IF NOT EXISTS leads (
    id serial PRIMARY KEY,
    prospect text NOT NULL,
    city text,
    oem text,
    owner text NOT NULL,
    stage lead_stage NOT NULL DEFAULT 'new',
    value numeric NOT NULL DEFAULT '0',
    students integer NOT NULL DEFAULT 0,
    price_to_uni numeric NOT NULL DEFAULT '0',
    price_to_datagami numeric NOT NULL DEFAULT '0',
    next_action text,
    next_date date,
    source text,
    contact_name text,
    contact_role text,
    contact_email text,
    contact_phone text,
    lost_reason text,
    converted_account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
    created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now()
  )`, "table leads");

  await exec(db, `CREATE TABLE IF NOT EXISTS lead_activities (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type activity_type NOT NULL DEFAULT 'note',
    author text NOT NULL,
    body text NOT NULL,
    date_label text NOT NULL,
    occurred_at timestamp NOT NULL DEFAULT now()
  )`, "table lead_activities");

  await exec(db, `CREATE TABLE IF NOT EXISTS lead_followups (
    id serial PRIMARY KEY,
    lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    action text NOT NULL,
    due_date date,
    done boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now()
  )`, "table lead_followups");

  await exec(db, `CREATE TABLE IF NOT EXISTS tasks (
    id serial PRIMARY KEY,
    title text NOT NULL,
    account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
    assignee_id integer REFERENCES users(id) ON DELETE SET NULL,
    priority task_priority NOT NULL DEFAULT 'medium',
    tags text[] NOT NULL DEFAULT ARRAY[]::text[],
    status task_status NOT NULL DEFAULT 'backlog',
    start_date date,
    due_date date,
    completed_at timestamp,
    created_at timestamp NOT NULL DEFAULT now()
  )`, "table tasks");

  await exec(db, `CREATE TABLE IF NOT EXISTS task_comments (
    id serial PRIMARY KEY,
    task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind task_comment_kind NOT NULL DEFAULT 'comment',
    author text NOT NULL,
    body text NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  )`, "table task_comments");

  console.log("\n── Step 3: Column additions (idempotent) ──────────────────");
  // leads extra columns (for DBs that have old leads table without these)
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS price_to_uni numeric NOT NULL DEFAULT '0'`, "leads.price_to_uni");
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS price_to_datagami numeric NOT NULL DEFAULT '0'`, "leads.price_to_datagami");
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_account_id integer REFERENCES accounts(id) ON DELETE SET NULL`, "leads.converted_account_id");
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL`, "leads.created_by_user_id");
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason text`, "leads.lost_reason");
  await exec(db, `ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_date date`, "leads.next_date (date)");

  // tasks extra columns
  await exec(db, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS account_id integer REFERENCES accounts(id) ON DELETE SET NULL`, "tasks.account_id");
  await exec(db, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id integer REFERENCES users(id) ON DELETE SET NULL`, "tasks.assignee_id");
  await exec(db, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date`, "tasks.start_date");
  await exec(db, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date date`, "tasks.due_date");
  await exec(db, `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamp`, "tasks.completed_at");

  console.log("\n── Done ───────────────────────────────────────────────────");
  console.log("Production schema is fully up-to-date.");
  console.log("Next: run create-prod-users and import-ibm-accounts scripts.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
