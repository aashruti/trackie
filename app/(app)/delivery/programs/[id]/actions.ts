"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { setProgramStatus, updateProgram, type NewProgram } from "@/lib/dal/delivery/programs";
import {
  addActivity,
  createEvent,
  deleteActivity,
  deleteEvent,
  setEventStatus,
  updateEvent,
  type NewActivity,
  type NewEvent,
} from "@/lib/dal/delivery/events";
import { isUserError } from "@/lib/dal/errors";
import type { DeliveryEventStatus, ProgramStatus } from "@/lib/db/enums";

async function session() {
  const s = await auth();
  if (!s?.user) throw new Error("Not authenticated");
  return { actor: { id: Number(s.user.id), role: s.user.role }, name: s.user.name ?? "Unknown" };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// Event/activity data feeds the program detail, the list rollups, the account
// report (fetched live) and the delivery dashboard.
function revalidateProgram(programId: number) {
  revalidatePath(`/delivery/programs/${programId}`);
  revalidatePath("/delivery/programs");
  revalidatePath("/dashboard");
}

export async function setProgramStatusAction(programId: number, status: ProgramStatus): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await setProgramStatus(actor, programId, status);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[programs:set-status]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not change the program status." };
  }
}

export async function updateProgramAction(programId: number, input: NewProgram): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await updateProgram(actor, programId, input);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[programs:update]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the program." };
  }
}

export async function createEventAction(input: NewEvent): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await createEvent(actor, input);
    revalidateProgram(input.programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-events:create]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not create the event." };
  }
}

export async function updateEventAction(
  programId: number,
  eventId: number,
  input: Omit<NewEvent, "programId">,
): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await updateEvent(actor, eventId, input);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-events:update]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the event." };
  }
}

export async function setEventStatusAction(
  programId: number,
  eventId: number,
  status: DeliveryEventStatus,
): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await setEventStatus(actor, eventId, status);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-events:set-status]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not change the event status." };
  }
}

export async function deleteEventAction(programId: number, eventId: number): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await deleteEvent(actor, eventId);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-events:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the event." };
  }
}

export async function addActivityAction(programId: number, input: NewActivity): Promise<ActionResult> {
  try {
    const { actor, name } = await session();
    await addActivity(actor, name, input);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-activities:add]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not log the activity." };
  }
}

export async function deleteActivityAction(programId: number, activityId: number): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await deleteActivity(actor, activityId);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[delivery-activities:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the activity." };
  }
}
