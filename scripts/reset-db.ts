/**
 * ⚠️  DESTRUCTIVE — wipes ALL tables, types, and migration history.
 * Use to get a clean slate before running db-migrate.ts from scratch.
 *
 * Run:
 *   DATABASE_URL="postgres://...neon.tech/..." npx tsx scripts/reset-db.ts
 *   # then: npx tsx scripts/db-migrate.ts
 *   # then: DEFAULT_USER_PASSWORD="..." npx tsx scripts/create-prod-users.ts
 *   # then: npx tsx scripts/import-ibm-accounts.ts
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL!;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const sql = neon(url);

  console.log("Dropping all tables in public schema…");
  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `;
  for (const { tablename } of tables) {
    await sql`DROP TABLE IF EXISTS public.${sql(tablename)} CASCADE`;
    console.log(`  dropped table: ${tablename}`);
  }

  console.log("Dropping all enums in public schema…");
  const enums = await sql`
    SELECT typname FROM pg_type
    JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'public' AND pg_type.typtype = 'e'
  `;
  for (const { typname } of enums) {
    await sql`DROP TYPE IF EXISTS public.${sql(typname)} CASCADE`;
    console.log(`  dropped enum: ${typname}`);
  }

  console.log("Dropping drizzle migration-tracking schema…");
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

  console.log("\n✓ Database reset complete. Now run:");
  console.log("  npx tsx scripts/db-migrate.ts");
  console.log("  DEFAULT_USER_PASSWORD='...' npx tsx scripts/create-prod-users.ts");
  console.log("  npx tsx scripts/import-ibm-accounts.ts");
  process.exit(0);
}

main().catch((e) => {
  console.error("Reset failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
