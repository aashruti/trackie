/**
 * Create production users for Datagami team.
 * Idempotent: upserts by email (updates role + name if already exists).
 *
 * Run against production:
 *   DEFAULT_USER_PASSWORD="<chosen-password>" \
 *   DATABASE_URL="<neon-prod-url>" npx tsx scripts/create-prod-users.ts
 *
 * Or pull Vercel env first:
 *   vercel env pull .env.production.local && \
 *   DEFAULT_USER_PASSWORD="<chosen-password>" \
 *   npx tsx --env-file=.env.production.local scripts/create-prod-users.ts
 */
import { config } from "dotenv";
// Load .env.production.local if present, fallback to .env.local
config({ path: ".env.production.local" });
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { users } from "../lib/db/schema";
import { hashPassword } from "../lib/auth/password";

const PROD_USERS: { name: string; email: string; role: "super-admin" | "admin" | "viewer" }[] = [
  { name: "Aashruti Shah",    email: "aashruti@datagami.in",              role: "super-admin" },
  { name: "Abhishek Singh",   email: "abhishek.singh@datagami.in",        role: "admin" },
  { name: "Dhaval",           email: "Dhaval@datagami.in",                role: "super-admin" },
  { name: "farzana maghi",    email: "farzana@datagami.in",               role: "admin" },
  { name: "Kiran Mamtora",    email: "Kiran.Mamtora@datagami.in",         role: "admin" },
  { name: "Kunal Sharma",     email: "kunal.sharma@datagami.in",          role: "super-admin" },
  { name: "Prakruti Shah",    email: "prakruti@datagami.in",              role: "super-admin" },
  { name: "Sanjay Daga",      email: "Sanjay@datagami.in",               role: "super-admin" },
  { name: "Shweta Shah",      email: "shweta@datagami.in",               role: "admin" },
  { name: "Social Media",     email: "socialmediacreative@datagami.in",  role: "viewer" },
  { name: "Suresh",           email: "Suresh@datagami.in",               role: "admin" },
];

const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD;
if (!DEFAULT_PASSWORD) {
  console.error("Set DEFAULT_USER_PASSWORD env var before running this script.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../lib/db/client");
  const passwordHash = await hashPassword(DEFAULT_PASSWORD!);

  for (const u of PROD_USERS) {
    const [existing] = await db.select().from(users).where(eq(users.email, u.email)).limit(1);
    if (existing) {
      await db.update(users).set({ name: u.name, role: u.role }).where(eq(users.id, existing.id));
      console.log(`↻  Updated  ${u.email}  →  ${u.role}`);
    } else {
      await db.insert(users).values({ name: u.name, email: u.email, role: u.role, passwordHash });
      console.log(`✓  Created  ${u.email}  →  ${u.role}`);
    }
  }

  console.log(`\nDone. All ${PROD_USERS.length} users upserted.`);
  console.log(`Users should change their password on first login via /profile.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
