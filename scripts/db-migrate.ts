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
 * Which database does this touch?
 *   npx tsx scripts/db-migrate.ts           → your LOCAL db (.env.local)
 *   npx tsx scripts/db-migrate.ts --prod    → PRODUCTION (.env.production.local)
 *   on Vercel                               → whatever the platform injects
 *
 * Production requires the explicit flag. It used to be the silent default: both
 * env files were loaded with production first, and dotenv never overwrites an
 * already-set variable — so `.env.local` could not win and the plain command
 * migrated production from a laptop. The comment here even said "Run locally".
 * A schema change against production should be something you asked for.
 */
import { config } from "dotenv";

// On Vercel the platform injects DATABASE_URL and no .env files are present, so
// load nothing. VERCEL is never set in .env.local, so it only ever means the
// real platform.
const onVercel = !!process.env.VERCEL;
const wantsProd =
  process.argv.includes("--prod") || process.env.MIGRATE_TARGET === "production";

if (!onVercel) {
  config({ path: wantsProd ? ".env.production.local" : ".env.local" });
}

import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  const which = onVercel ? "the Vercel environment" : wantsProd ? ".env.production.local" : ".env.local";
  console.error(`DATABASE_URL is not set — expected it in ${which}.`);
  process.exit(1);
}

// Say which database is about to be altered, before altering it. The old
// default silently pointed at production; a schema change should never be a
// surprise.
const target = onVercel ? "vercel" : wantsProd ? "PRODUCTION" : "local";
console.log(`Migrating ${target}: ${new URL(url).host}\n`);

const isNeon = /neon\.tech/.test(url) || !!process.env.VERCEL;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { migrate } = isNeon ? require("drizzle-orm/neon-http/migrator") : require("drizzle-orm/postgres-js/migrator");

// Use the raw neon() client for bootstrap queries — its tagged-template results
// are always plain row arrays, avoiding Drizzle wrapper format differences.
// Falls back to postgres.js-style db.execute() for local dev.
async function query<T extends Record<string, unknown>>(
  rawSql: string,
): Promise<T[]> {
  if (isNeon) {
    const client = neon(url);
    return client.query(rawSql) as Promise<T[]>;
  }
  // Local postgres.js path (avoid importing neon when not needed)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const postgres = require("postgres");
  const pg = postgres(url, { max: 1, prepare: false });
  const result = await pg.unsafe(rawSql);
  await pg.end();
  return result as T[];
}

async function exec(rawSql: string): Promise<void> {
  if (isNeon) {
    const client = neon(url);
    await client.query(rawSql);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const postgres = require("postgres");
  const pg = postgres(url, { max: 1, prepare: false });
  await pg.unsafe(rawSql);
  await pg.end();
}

async function main() {
  const { db } = await import("../lib/db/client");

  // Ensure the drizzle tracking schema + table exist.
  await exec(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await exec(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  // Check whether tracking has ever been seeded.
  const [countRow] = await query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM drizzle.__drizzle_migrations`);
  const tracked = Number(countRow?.cnt ?? 0);

  if (tracked === 0) {
    // Check if this is an existing DB (accounts table already exists from prior
    // manual setup before migration tracking was introduced).
    const [existsRow] = await query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts'
      ) AS "exists"
    `);
    const dbExists = existsRow?.exists === true || String(existsRow?.exists) === "true";

    if (dbExists) {
      console.log("Bootstrapping migration history for existing database…");
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      for (const m of migrations) {
        await exec(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${m.hash}', ${m.folderMillis})`,
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
