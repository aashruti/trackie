/**
 * Seed the delivery-methods catalogue with the two styles the team uses today.
 * Idempotent (upsert on code). Run: npm run db:seed-delivery
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  // Dynamic import AFTER dotenv so the db client sees DATABASE_URL (ESM hoisting).
  const { db } = await import("../lib/db/client");
  const { deliveryMethods } = await import("../lib/db/schema");

  const seeds = [
    { code: "D2S", name: "Direct to Students", description: "Datagami/OEM trainers teach the enrolled students directly." },
    { code: "T3", name: "Teach the Teacher", description: "University faculty are trained to deliver the program themselves." },
  ];

  for (const s of seeds) {
    await db.insert(deliveryMethods).values(s).onConflictDoNothing({ target: deliveryMethods.code });
  }
  const rows = await db.select().from(deliveryMethods);
  console.log(`Delivery methods seeded. Catalogue now has ${rows.length}:`, rows.map((r) => r.code).join(", "));
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
