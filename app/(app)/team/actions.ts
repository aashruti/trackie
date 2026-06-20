"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { addTaskComment, createTask, moveTask, updateTaskPriority, type NewTaskInput } from "@/lib/dal/tasks";
import type { TaskStatus, TaskPriority, TaskCommentKind } from "@/lib/db/enums";
import { initials } from "@/lib/board/constants";

/** Team board is open to all authenticated roles — just require a session. */
async function requireUserCode() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return initials(session.user.name ?? "U");
}

function revalidateBoard() {
  revalidatePath("/team");
  revalidatePath("/team/backlog");
}

export async function moveTaskAction(id: number, status: TaskStatus) {
  await requireUserCode();
  await moveTask(id, status);
  revalidateBoard();
  return { ok: true };
}

export async function addTaskAction(input: NewTaskInput) {
  await requireUserCode();
  // createTask enforces the account/assignee rule and throws on a bad pairing.
  await createTask({
    title: input.title,
    accountId: input.accountId ?? null,
    assigneeId: input.assigneeId ?? null,
    priority: input.priority ?? "medium",
    tags: input.tags ?? [],
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? "backlog",
  });
  revalidateBoard();
  return { ok: true };
}

export async function updateTaskPriorityAction(id: number, priority: TaskPriority) {
  await requireUserCode();
  await updateTaskPriority(id, priority);
  revalidateBoard();
  return { ok: true };
}

export async function addTaskCommentAction(
  taskId: number,
  input: { kind: TaskCommentKind; body: string },
) {
  const code = await requireUserCode();
  await addTaskComment(taskId, { kind: input.kind, body: input.body, author: code });
  revalidateBoard();
  return { ok: true };
}
