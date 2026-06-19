/**
 * Create (or reset) a Super Admin user — the way to bootstrap login on a fresh
 * production database, where the Excel seed isn't run.
 *
 * Reads credentials from env (preferred) or positional args:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
 *
 * Run against the cloud DB (inline env wins; dotenv never overrides it):
 *   DATABASE_URL="<neon-pooled-url>" \
 *   ADMIN_EMAIL="you@datagami.in" ADMIN_PASSWORD="••••••" ADMIN_NAME="You" \
 *   npm run create-admin
 *
 * Idempotent: if the email already exists, its password + role are updated.
 */
import { config } from "dotenv";
config({ path: ".env.local" }); // does NOT override vars already in process.env

import { eq } from "drizzle-orm";
import { users } from "../lib/db/schema";
import { hashPassword } from "../lib/auth/password";

async function main() {
  // Import the client AFTER dotenv has run (static imports hoist above config()).
  const { db } = await import("../lib/db/client");

  const email = (process.env.ADMIN_EMAIL ?? process.argv[2] ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? process.argv[3] ?? "";
  const name = (process.env.ADMIN_NAME ?? process.argv[4] ?? "Super Admin").trim();

  if (!email || !password) {
    throw new Error(
      "Missing credentials. Set ADMIN_EMAIL and ADMIN_PASSWORD (and optionally ADMIN_NAME).",
    );
  }
  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  }

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    await db
      .update(users)
      .set({ passwordHash, role: "super-admin", name })
      .where(eq(users.id, existing.id));
    console.log(`✓ Updated existing user ${email} → super-admin.`);
  } else {
    await db.insert(users).values({ email, passwordHash, role: "super-admin", name });
    console.log(`✓ Created super-admin ${email}.`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
