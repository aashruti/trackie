/**
 * Smart migration runner — wraps Drizzle's migrate() with a bootstrap step
 * so existing databases (set up before migration tracking existed) are handled
 * gracefully.
 *
 * How it works:
 *  1. If `drizzle.__drizzle_migrations` is empty AND the `accounts` table already
 *     exists (i.e. this is an existing DB, not a fresh one), we pre-seed the
 *     tracking table with all migrations up to and including the current latest.
 *     That tells Drizzle "these are already applied — skip them."
 *  2. Then we call Drizzle's migrate() normally. On an existing DB it runs nothing
 *     (all pre-seeded). On a fresh DB it runs everything from 0000.
 *  3. Future schema changes: edit schema.ts → npx drizzle-kit generate →
 *     commit the SQL file. This script picks it up on next deploy automatically.
 *
 * Run locally:  npx tsx scripts/db-migrate.ts
 * On Vercel:    runs automatically as part of `vercel-build` (see package.json)
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";

const url = process.env.DATABASE_URL ?? "";
const isNeon = /neon\.tech/.test(url) || !!process.env.VERCEL;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = isNeon ? require("drizzle-orm/neon-http/migrator") : require("drizzle-orm/postgres-js/migrator");

async function main() {
  const { db } = await import("../lib/db/client");

  // Ensure the drizzle tracking schema + table exist (migrate() does this too, but
  // we need it before we can query it below).
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Check whether tracking has ever been seeded.
  const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM drizzle.__drizzle_migrations`);
  const tracked = Number((rows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);

  if (tracked === 0) {
    // Check if this is an existing DB (accounts table already exists).
    const check = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS "exists"
    `);
    const dbExists = (check as unknown as Array<{ exists: boolean }>)[0]?.exists ?? false;

    if (dbExists) {
      // Existing DB set up before Drizzle tracking — pre-seed all migrations so
      // migrate() sees them as already applied and skips them.
      console.log("Bootstrapping migration history for existing database…");
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      for (const m of migrations) {
        await db.execute(
          sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.folderMillis})`,
        );
        console.log(`  ✓ seeded: ${m.hash.slice(0, 12)}… (${m.folderMillis})`);
      }
      console.log("Bootstrap complete — no migrations to run on this deploy.");
    }
  }

  // Run any pending migrations (no-ops when all are seeded; applies new ones on
  // subsequent deploys).
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations up to date.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
