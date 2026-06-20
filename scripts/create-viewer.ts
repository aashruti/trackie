/**
 * Create (or reset) a viewer (Designer / Employee) user for local testing of
 * role-gated UI. Idempotent on email.
 *
 * Run: npm run create-viewer
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { users } from "../lib/db/schema";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const { db } = await import("../lib/db/client");
  const email = "viewer@datagami.local";
  const passwordHash = await hashPassword("changeme123");
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, role: "viewer", name: "Priya Nair" }).where(eq(users.id, existing.id));
    console.log(`✓ Updated ${email} → viewer.`);
  } else {
    await db.insert(users).values({ email, passwordHash, role: "viewer", name: "Priya Nair" });
    console.log(`✓ Created viewer ${email} / changeme123.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
