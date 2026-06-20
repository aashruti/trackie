/**
 * Shared workspace seeding: ensures demo team members + their account assignments
 * exist, then generates ACTUAL tasks from the live assignment graph — every task
 * is a real user on an account they're genuinely assigned to (rule-valid by
 * construction). Used by both `seed.ts` (full reset) and `seed-workspace.ts`.
 *
 * `db`/`t` are passed in (typed only) so this module never imports the live DB
 * client at load time — the caller dynamic-imports it after dotenv runs.
 */
import { eq, inArray, sql, asc } from "drizzle-orm";
import { hashPassword } from "../lib/auth/password";
import { DEMO_USERS, DEMO_PASSWORD } from "../lib/fixtures/tasks";
import type { TaskStatus, TaskPriority } from "../lib/db/enums";

type Db = (typeof import("../lib/db/client"))["db"];
type Schema = typeof import("../lib/db/schema");

// Templates rotated across each user's real account assignments.
const TASK_TEMPLATES: { title: string; tags: string[] }[] = [
  { title: "Reconcile receipts", tags: ["Receipts", "Finance"] },
  { title: "Verify GST on advance bill", tags: ["GST"] },
  { title: "Chase outstanding collections", tags: ["Collections"] },
  { title: "Raise new-students invoice", tags: ["Invoicing"] },
  { title: "TDS certificate follow-up", tags: ["TDS"] },
  { title: "Review margin", tags: ["Margin", "Review"] },
  { title: "Collect 2nd-sem receipts", tags: ["Collections"] },
  { title: "Onboard into FY25–26", tags: ["Onboarding"] },
];
const STATUSES: TaskStatus[] = ["backlog", "open", "progress", "review", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["high", "medium", "low"];
// Spread around "today" (≈ 2026-06-20) so some land today / overdue / upcoming.
const DUE_DATES = [
  "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21", "2026-06-22",
  "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-28", "2026-07-01",
];

const shortName = (n: string) => n.replace(/\s*\(own product\)\s*$/i, "").trim();

/** Add days to an ISO date, returning ISO. */
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

export async function seedWorkspaceUsersAndTasks(db: Db, t: Schema) {
  const accounts = await db
    .select({ id: t.accounts.id, name: t.accounts.name })
    .from(t.accounts)
    .orderBy(asc(t.accounts.name));
  if (accounts.length < 5) {
    throw new Error("Seed accounts first — need at least 5 accounts for the workspace demo.");
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Upsert demo users by email.
  const emailToId = new Map<string, number>();
  for (const du of DEMO_USERS) {
    const [existing] = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.email, du.email))
      .limit(1);
    if (existing) {
      await db.update(t.users).set({ name: du.name, role: du.role }).where(eq(t.users.id, existing.id));
      emailToId.set(du.email, existing.id);
    } else {
      const [row] = await db
        .insert(t.users)
        .values({ email: du.email, name: du.name, role: du.role, passwordHash })
        .returning({ id: t.users.id });
      emailToId.set(du.email, row.id);
    }
  }

  // Reset only the demo users' account assignments, then apply their slots.
  const demoIds = [...emailToId.values()];
  await db.delete(t.userAccounts).where(inArray(t.userAccounts.userId, demoIds));
  const assignRows = DEMO_USERS.flatMap((du) =>
    du.accountSlots.map((slot) => ({ userId: emailToId.get(du.email)!, accountId: accounts[slot].id })),
  );
  if (assignRows.length) await db.insert(t.userAccounts).values(assignRows);

  // Generate tasks from the LIVE assignment graph (all users, not just demo ones).
  const assignments = await db
    .select({ userId: t.userAccounts.userId, accountId: t.userAccounts.accountId, accountName: t.accounts.name })
    .from(t.userAccounts)
    .innerJoin(t.accounts, eq(t.userAccounts.accountId, t.accounts.id))
    .orderBy(asc(t.userAccounts.userId), asc(t.accounts.name));

  type TaskInsert = {
    title: string;
    accountId: number | null;
    assigneeId: number | null;
    priority: TaskPriority;
    tags: string[];
    startDate: string;
    dueDate: string;
    status: TaskStatus;
    completedAt: Date | null;
  };
  const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const taskRows: TaskInsert[] = assignments.map((a, i) => {
    const tmpl = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
    const dueDate = DUE_DATES[i % DUE_DATES.length];
    const status = STATUSES[i % STATUSES.length];
    return {
      title: `${tmpl.title} — ${shortName(a.accountName)}`,
      accountId: a.accountId,
      assigneeId: a.userId,
      priority: PRIORITIES[i % PRIORITIES.length],
      tags: tmpl.tags,
      startDate: addDaysISO(dueDate, -3),
      dueDate,
      status,
      // Recently done → within the default 30-day window, so they stay visible.
      completedAt: status === "done" ? noon(dueDate) : null,
    };
  });

  // A couple of Internal (no-account) tasks for a super-admin, if one exists.
  const [sa] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.role, "super-admin"))
    .limit(1);
  if (sa) {
    taskRows.push(
      { title: "Update IBM rate card in pricing sheet", accountId: null, assigneeId: sa.id, priority: "medium", tags: ["Pricing"], startDate: "2026-06-13", dueDate: "2026-06-20", status: "progress", completedAt: null },
      { title: "QA new-students ladder calculation", accountId: null, assigneeId: sa.id, priority: "low", tags: ["QA"], startDate: "2026-06-12", dueDate: "2026-06-19", status: "backlog", completedAt: null },
      // Old completed task — hidden by the default 30-day window, shown under "Done · all".
      { title: "Archive FY24–25 closing checklist", accountId: null, assigneeId: sa.id, priority: "low", tags: ["Archive"], startDate: "2026-04-10", dueDate: "2026-04-15", status: "done", completedAt: noon("2026-04-15") },
    );
  }

  await db.execute(sql.raw(`TRUNCATE TABLE task_comments, tasks RESTART IDENTITY CASCADE`));
  const inserted = taskRows.length ? await db.insert(t.tasks).values(taskRows).returning({ id: t.tasks.id, assigneeId: t.tasks.assigneeId, status: t.tasks.status }) : [];

  // Seed a couple of worklog/comment entries on a few active tasks for the demo.
  const active = inserted.filter((r) => r.status !== "backlog" && r.status !== "done" && r.assigneeId != null).slice(0, 5);
  let comments = 0;
  for (const tk of active) {
    await db.insert(t.taskComments).values([
      { taskId: tk.id, kind: "worklog", author: "RK", body: "Reviewed the figures and reconciled the receipt against the ledger." },
      { taskId: tk.id, kind: "comment", author: "PN", body: "Looks good — waiting on the university to confirm before closing." },
    ]);
    comments += 2;
  }

  return { users: DEMO_USERS.length, assignments: assignments.length, tasks: taskRows.length, comments };
}
