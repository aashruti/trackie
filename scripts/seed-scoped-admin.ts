/**
 * Dev utility: create (or reset) a scoped Admin assigned to specific accounts,
 * to demonstrate/verify RBAC scoping. Run: tsx scripts/seed-scoped-admin.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "../lib/auth/password";

const EMAIL = "region@datagami.local";
const PASSWORD = "region123";
const ASSIGN = ["Pillai University", "Kalinga University", "Medicaps DG Programme"];

async function main() {
  const { db } = await import("../lib/db/client");
  const t = await import("../lib/db/schema");

  // Upsert the admin user.
  await db.delete(t.users).where(eq(t.users.email, EMAIL));
  const [user] = await db
    .insert(t.users)
    .values({
      name: "Region Admin",
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      role: "admin",
    })
    .returning();

  // Assign the named accounts.
  const accs = await db
    .select({ id: t.accounts.id, name: t.accounts.name })
    .from(t.accounts)
    .where(inArray(t.accounts.name, ASSIGN));

  await db.insert(t.userAccounts).values(
    accs.map((a) => ({ userId: user.id, accountId: a.id })),
  );

  console.log(
    `Scoped admin ready: ${EMAIL} / ${PASSWORD}\nAssigned ${accs.length} accounts: ${accs
      .map((a) => a.name)
      .join(", ")}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
