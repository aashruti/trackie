/**
 * One-off, idempotent DDL: add per-seat price columns to leads so estimated
 * value + margin are derived (like invoices) instead of hand-typed.
 * Applied directly (drizzle-kit push needs a TTY for some diffs). After this,
 * the live schema matches lib/db/schema.ts.
 *
 * Run: npx tsx scripts/migrate-leads.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("../lib/db/client");
  await db.execute(sql.raw(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS price_to_uni numeric NOT NULL DEFAULT '0'`));
  await db.execute(sql.raw(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS price_to_datagami numeric NOT NULL DEFAULT '0'`));
  await db.execute(
    sql.raw(
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_account_id integer REFERENCES accounts(id) ON DELETE SET NULL`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL`,
    ),
  );
  // Follow-up date becomes a real date (was free text) so "today" is comparable.
  // Reseeded immediately after, so dropping the text column loses nothing.
  await db.execute(sql.raw(`ALTER TABLE leads DROP COLUMN IF EXISTS next_date`));
  await db.execute(sql.raw(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_date date`));
  // Lost outcome: terminal stage + reason.
  await db.execute(sql.raw(`ALTER TYPE lead_stage ADD VALUE IF NOT EXISTS 'lost' AFTER 'won'`));
  await db.execute(sql.raw(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason text`));
  // Multiple follow-ups per lead. leads.next_action/next_date remain a cache of
  // the soonest pending follow-up (drives card + dashboard).
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS lead_followups (
      id serial PRIMARY KEY,
      lead_id integer NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      action text NOT NULL,
      due_date date,
      done boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now()
    )`),
  );
  console.log("leads migrated: prices, converted/created_by, next_date → date, 'lost' + reason, + lead_followups table.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
