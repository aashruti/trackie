import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Shared by the Next.js server (DAL) and standalone scripts (seed/reconcile).
// The `server-only` guard lives on the DAL modules, not here, so tsx scripts can
// import the client without tripping it.
const url = process.env.DATABASE_URL!;

// On Neon (production / Vercel) use the HTTP driver: avoids TCP connection
// establishment on every cold-start function invocation (~800-1200ms saved).
// On localhost use postgres.js (TCP is fine for a persistent local server).
const isNeon = /neon\.tech/.test(url) || !!process.env.VERCEL;

function createDb(): NeonHttpDatabase<typeof schema> {
  if (isNeon) {
    return drizzleNeon(neon(url), { schema });
  }
  // Local dev path — cast to the canonical type (same query interface).
  const client = postgres(url, { max: 5, prepare: false });
  return drizzlePg(client, { schema }) as unknown as NeonHttpDatabase<typeof schema>;
}

export const db = createDb();
