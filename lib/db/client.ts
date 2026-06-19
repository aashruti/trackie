import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Shared by the Next.js server (DAL) and standalone scripts (seed/reconcile).
// The `server-only` guard lives on the DAL modules, not here, so tsx scripts can
// import the client without tripping it.
const url = process.env.DATABASE_URL!;

// Managed Postgres (Neon/Supabase/RDS) requires SSL; local Postgres.app does not.
const needsSsl =
  /sslmode=require|neon\.tech|supabase\.|amazonaws\.com|render\.com/.test(url) ||
  !!process.env.VERCEL;

// On Vercel (serverless) each function instance should keep a tiny pool; local
// dev/scripts can use a larger one. `prepare: false` keeps us compatible with
// transaction-mode poolers (Neon pooler / PgBouncer).
const client = postgres(url, {
  max: process.env.VERCEL ? 1 : 5,
  ssl: needsSsl ? "require" : undefined,
  prepare: false,
});

export const db = drizzle(client, { schema });
