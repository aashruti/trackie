import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, ne, or, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, taskComments, accounts, oems, users, userAccounts, programs } from "@/lib/db/schema";
import type { TaskStatus, TaskPriority, TaskCommentKind, TaskBoard } from "@/lib/db/enums";
import type { TaskRow, TaskComment, TaskDetailRow, Option, ProgramOption } from "@/lib/board/constants";
import { todayISO } from "@/lib/dates";

/**
 * Board reads/writes. Available to every authenticated role (the page +
 * actions assert a session). One `tasks` table serves two kanbans, split by the
 * `board` column: "team" (the original board) and "delivery" (the delivery
 * team's board, whose tasks may carry program context). Tasks link to a real
 * account + a real user; the assignment rule below rejects assigning a TEAM
 * task to a user who isn't on the account.
 */

const TASK_SELECT = {
  id: tasks.id,
  title: tasks.title,
  accountId: tasks.accountId,
  accountName: accounts.name,
  oem: oems.name,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  priority: tasks.priority,
  tags: tasks.tags,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  status: tasks.status,
  board: tasks.board,
  programId: tasks.programId,
  programName: programs.name,
  commentCount: sql<number>`(select count(*)::int from ${taskComments} where ${taskComments.taskId} = ${tasks.id})`,
} as const;

/**
 * Board tasks. Open tasks (not done) are always returned; Done tasks are limited
 * to those completed within `doneWithinDays` (default 30) so the board stays
 * bounded as completed work piles up. Pass `null` to include all Done tasks.
 * `statuses` further restricts which lifecycle columns to load.
 */
export async function listTasks(
  {
    doneWithinDays = 30,
    statuses,
    board = "team",
  }: { doneWithinDays?: number | null; statuses?: TaskStatus[]; board?: TaskBoard } = {},
): Promise<TaskRow[]> {
  let doneFilter = undefined;
  if (doneWithinDays != null) {
    const cutoff = new Date(Date.now() - doneWithinDays * 24 * 60 * 60 * 1000);
    // Keep every non-done task; for done, only those completed since the cutoff.
    doneFilter = or(
      ne(tasks.status, "done"),
      and(eq(tasks.status, "done"), isNotNull(tasks.completedAt), gte(tasks.completedAt, cutoff)),
    );
  }
  const statusFilter = statuses && statuses.length ? inArray(tasks.status, statuses) : undefined;
  return db
    .select(TASK_SELECT)
    .from(tasks)
    .leftJoin(accounts, eq(tasks.accountId, accounts.id))
    .leftJoin(oems, eq(accounts.oemId, oems.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(programs, eq(tasks.programId, programs.id))
    .where(and(eq(tasks.board, board), statusFilter, doneFilter))
    .orderBy(asc(tasks.status), desc(tasks.dueDate), desc(tasks.id));
}

/** Comments for a set of tasks, grouped by task id (newest first). */
async function loadCommentsByTask(taskIds: number[]): Promise<Map<number, TaskComment[]>> {
  const byTask = new Map<number, TaskComment[]>();
  if (taskIds.length === 0) return byTask;
  const rows = await db
    .select()
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))
    .orderBy(desc(taskComments.createdAt), desc(taskComments.id));
  for (const r of rows) {
    const list = byTask.get(r.taskId) ?? [];
    list.push({ id: r.id, kind: r.kind, author: r.author, body: r.body, createdAt: r.createdAt.toISOString() });
    byTask.set(r.taskId, list);
  }
  return byTask;
}

/** Board tasks with their comment threads attached (for the detail dialog). */
export async function listTasksWithComments(
  opts: { doneWithinDays?: number | null; statuses?: TaskStatus[]; board?: TaskBoard } = {},
): Promise<TaskDetailRow[]> {
  const rows = await listTasks(opts);
  const comments = await loadCommentsByTask(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, comments: comments.get(r.id) ?? [] }));
}

/** Count of tasks in a given status on a board (e.g. the Backlog badge). */
export async function countTasksByStatus(status: TaskStatus, board: TaskBoard = "team"): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.status, status), eq(tasks.board, board)));
  return row?.n ?? 0;
}

export async function addTaskComment(
  taskId: number,
  input: { kind: TaskCommentKind; body: string; author: string },
): Promise<TaskComment> {
  const body = input.body.trim();
  if (!body) throw new Error("Comment cannot be empty");
  const [row] = await db
    .insert(taskComments)
    .values({ taskId, kind: input.kind, author: input.author, body })
    .returning();
  return { id: row.id, kind: row.kind, author: row.author, body: row.body, createdAt: row.createdAt.toISOString() };
}

/** Tasks assigned to a user that are open and due today or overdue. */
export async function myTasksToday(userId: number): Promise<TaskRow[]> {
  const today = todayISO();
  return db
    .select(TASK_SELECT)
    .from(tasks)
    .leftJoin(accounts, eq(tasks.accountId, accounts.id))
    .leftJoin(oems, eq(accounts.oemId, oems.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .leftJoin(programs, eq(tasks.programId, programs.id))
    .where(
      and(
        eq(tasks.assigneeId, userId),
        ne(tasks.status, "done"),
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, today),
      ),
    )
    .orderBy(asc(tasks.dueDate), desc(tasks.priority));
}

/** Lean user picker options (e.g. the event-owner select) — one query, no extras. */
export async function listUserOptions(): Promise<Option[]> {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
}

/** Accounts + users + programs for the New-task pickers and board filters. */
export async function listTaskOptions(): Promise<{
  accounts: Option[];
  users: Option[];
  programs: ProgramOption[];
}> {
  const [accRows, userRows, programRows] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).orderBy(asc(accounts.name)),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
    db
      .select({ id: programs.id, name: programs.name, accountId: programs.accountId, status: programs.status })
      .from(programs)
      .orderBy(asc(programs.name)),
  ]);
  // Active programs first — completed/on-hold ones sink but stay pickable.
  const progs = programRows
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))
    .map(({ id, name, accountId }) => ({ id, name, accountId }));
  return { accounts: accRows, users: userRows, programs: progs };
}

/**
 * The rule: a task on an account can only be assigned to a user who is on that
 * account. Super-admins see every account, so they're exempt. Internal tasks
 * (no account) and unassigned tasks skip the check.
 */
export async function assertAssignable(
  assigneeId: number | null,
  accountId: number | null,
): Promise<void> {
  if (accountId == null || assigneeId == null) return;

  const [u] = await db
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, assigneeId))
    .limit(1);
  if (!u) throw new Error("Assignee not found");
  if (u.role === "super-admin") return;

  const [membership] = await db
    .select({ accountId: userAccounts.accountId })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, assigneeId), eq(userAccounts.accountId, accountId)))
    .limit(1);

  if (!membership) {
    const [acc] = await db
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    throw new Error(
      `${u.name} isn't assigned to ${acc?.name ?? "that account"} — assign them the account first (Users & access).`,
    );
  }
}

export async function updateTaskPriority(id: number, priority: TaskPriority): Promise<void> {
  await db.update(tasks).set({ priority }).where(eq(tasks.id, id));
}

export async function moveTask(id: number, status: TaskStatus): Promise<void> {
  // Status-only change — assignee/account are unchanged, so the rule still holds.
  // Stamp completedAt entering "done" (drives the recency window); clear it leaving.
  await db
    .update(tasks)
    .set({ status, completedAt: status === "done" ? new Date() : null })
    .where(eq(tasks.id, id));
}

export type NewTaskInput = {
  title: string;
  accountId?: number | null;
  assigneeId?: number | null;
  priority?: TaskPriority;
  tags?: string[];
  startDate?: string | null; // ISO "YYYY-MM-DD"
  dueDate?: string | null;
  status?: TaskStatus;
  board?: TaskBoard;
  programId?: number | null; // delivery board: picking a program implies the account
};

export async function createTask(input: NewTaskInput): Promise<{ id: number }> {
  const board = input.board ?? "team";
  let accountId = input.accountId ?? null;
  const assigneeId = input.assigneeId ?? null;
  const programId = input.programId ?? null;

  // Program context is a delivery-board concept. Rejecting it elsewhere also
  // keeps program names (delivery-gated data) off the all-roles team board.
  if (programId != null && board !== "delivery") {
    throw new Error("Programs can only be linked to delivery-board tasks");
  }

  if (programId != null) {
    const [program] = await db
      .select({ accountId: programs.accountId })
      .from(programs)
      .where(eq(programs.id, programId))
      .limit(1);
    if (!program) throw new Error("Program not found");
    if (accountId != null && accountId !== program.accountId) {
      throw new Error("That program belongs to a different account");
    }
    accountId = program.accountId; // program implies its account
  }

  // The user_accounts membership rule is a sales-side constraint; delivery
  // staff work across accounts without assignments, so their board skips it.
  if (board === "team") await assertAssignable(assigneeId, accountId);

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title.trim() || "New delivery task",
      accountId,
      assigneeId,
      priority: input.priority ?? "medium",
      tags: input.tags ?? [],
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status ?? "backlog",
      board,
      programId,
    })
    .returning({ id: tasks.id });
  return { id: row.id };
}
