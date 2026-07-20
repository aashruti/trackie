/**
 * Demo team members the seed upserts so the board + assignment graph are populated.
 * `accountSlots` index into the accounts list (sorted by name); the seed resolves
 * them to real account ids and writes real `user_accounts` rows. Actual tasks are
 * then generated from the live assignment graph (see scripts/seed-tasks.ts), so
 * every task is a real user on an account they're genuinely assigned to.
 */
import type { Role } from "@/lib/db/enums";

export type DemoUser = {
  email: string;
  name: string;
  role: Role;
  accountSlots: number[];
};

export const DEMO_PASSWORD = "changeme123";

export const DEMO_USERS: DemoUser[] = [
  { email: "ramesh@datagami.local", name: "Ramesh Kothari", role: "sales", accountSlots: [0, 1, 2] },
  { email: "arjun@datagami.local", name: "Arjun Rao", role: "sales", accountSlots: [2, 3, 4] },
  { email: "priya@datagami.local", name: "Priya Nair", role: "viewer", accountSlots: [1, 4] },
  { email: "neha@datagami.local", name: "Neha Singh", role: "viewer", accountSlots: [0, 3] },
];
