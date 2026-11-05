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
import {
  addPayment,
  deletePayment,
  moveToNewPo,
  updatePayment,
  updateProgramPo,
  type NewPayment,
  type PoInput,
} from "@/lib/dal/delivery/po";
import { deleteProgramFile } from "@/lib/dal/delivery/po-files";
import { isUserError } from "@/lib/dal/errors";
import type { DeliveryEventStatus, ProgramStatus } from "@/lib/db/enums";

async function session() {
  const s = await auth();
  if (!s?.user) throw new Error("Not authenticated");
  return { actor: { id: Number(s.user.id), roles: s.user.roles }, name: s.user.name ?? "Unknown" };
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
    return { ok: false, error: isUserError(e) ? e.message : "Could not change the PO status." };
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
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the PO." };
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

export async function updateProgramPoAction(
  programId: number,
  input: PoInput,
): Promise<{ ok: true; duplicates: { id: number; name: string }[] } | { ok: false; error: string }> {
  try {
    const { actor } = await session();
    const { duplicates } = await updateProgramPo(actor, programId, input);
    revalidateProgram(programId);
    return { ok: true, duplicates };
  } catch (e) {
    console.error("[programs:update-po]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not save the PO details." };
  }
}

export async function addPaymentAction(input: NewPayment): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await addPayment(actor, input);
    revalidateProgram(input.programId);
    return { ok: true };
  } catch (e) {
    console.error("[program-payments:add]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not record the payment." };
  }
}

export async function updatePaymentAction(
  programId: number,
  paymentId: number,
  input: Omit<NewPayment, "programId">,
): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await updatePayment(actor, paymentId, input);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[program-payments:update]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the payment." };
  }
}

export async function deletePaymentAction(programId: number, paymentId: number): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await deletePayment(actor, paymentId);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[program-payments:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the payment." };
  }
}

export async function moveToNewPoAction(
  sourceId: number,
  input: { name: string; eventIds: number[]; paymentIds?: number[] } & PoInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const { actor } = await session();
    const { id } = await moveToNewPo(actor, sourceId, input);
    revalidateProgram(sourceId);
    revalidateProgram(id);
    return { ok: true, id };
  } catch (e) {
    console.error("[programs:move-to-new-po]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not split the events into a new PO." };
  }
}

export async function deleteProgramFileAction(programId: number, fileId: number): Promise<ActionResult> {
  try {
    const { actor } = await session();
    await deleteProgramFile(actor, fileId);
    revalidateProgram(programId);
    return { ok: true };
  } catch (e) {
    console.error("[program-files:delete]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not delete the file." };
  }
}
