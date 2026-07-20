"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { addTaskComment, createTask, moveTask, updateTaskPriority, type NewTaskInput } from "@/lib/dal/tasks";
import { canAccessDelivery } from "@/lib/dal/authz";
import type { TaskStatus, TaskPriority, TaskCommentKind } from "@/lib/db/enums";
import { initials } from "@/lib/board/constants";

/** Boards are open to all authenticated roles — just require a session. */
async function requireActor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), code: initials(session.user.name ?? "U") };
}

/** Creating on the delivery board (or with program context) needs delivery access. */
async function assertDeliveryBoardWrite() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  const actor = { id: Number(session.user.id), roles: session.user.roles };
  if (!canAccessDelivery(actor)) {
    throw new Error("The delivery board is available to the Delivery team / Admin / Super Admin only");
  }
}

// Both kanbans (team + delivery) share these actions — refresh every board view.
function revalidateBoard() {
  revalidatePath("/team");
  revalidatePath("/team/backlog");
  revalidatePath("/delivery/board");
}

export async function moveTaskAction(id: number, status: TaskStatus) {
  const { id: actorId } = await requireActor();
  await moveTask(actorId, id, status);
  revalidateBoard();
  return { ok: true };
}

export async function addTaskAction(input: NewTaskInput) {
  const { id: actorId } = await requireActor();
  if (input.board === "delivery" || input.programId != null) await assertDeliveryBoardWrite();
  // createTask enforces the account/assignee rule and throws on a bad pairing.
  await createTask(actorId, {
    title: input.title,
    accountId: input.accountId ?? null,
    assigneeId: input.assigneeId ?? null,
    priority: input.priority ?? "medium",
    tags: input.tags ?? [],
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? "backlog",
    board: input.board ?? "team",
    programId: input.programId ?? null,
  });
  revalidateBoard();
  return { ok: true };
}

export async function updateTaskPriorityAction(id: number, priority: TaskPriority) {
  const { id: actorId } = await requireActor();
  await updateTaskPriority(actorId, id, priority);
  revalidateBoard();
  return { ok: true };
}

export async function addTaskCommentAction(
  taskId: number,
  input: { kind: TaskCommentKind; body: string },
) {
  const { id: actorId, code } = await requireActor();
  await addTaskComment(actorId, taskId, { kind: input.kind, body: input.body, author: code });
  revalidateBoard();
  return { ok: true };
}
