"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  addActivity,
  createLead,
  setLeadStage,
  addLeadFollowup,
  setLeadFollowupDone,
  deleteLeadFollowup,
  convertLeadToAccount,
  type NewLeadInput,
} from "@/lib/dal/leads";
import { getCurrentYear } from "@/lib/dal/years";
import type { LeadStage, ActivityType } from "@/lib/db/enums";
import { initials } from "@/lib/board/constants";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return {
    user: { id: Number(session.user.id), role: session.user.role },
    code: initials(session.user.name ?? "U"),
  };
}

export async function moveLeadAction(id: number, stage: LeadStage, lostReason?: string | null) {
  const { user } = await actor();
  await setLeadStage(user, id, stage, lostReason);
  revalidatePath("/leads");
  return { ok: true };
}

export async function addFollowupAction(
  leadId: number,
  input: { action: string; dueDate: string | null },
) {
  const { user } = await actor();
  await addLeadFollowup(user, leadId, input);
  revalidatePath("/leads");
  return { ok: true };
}

export async function setFollowupDoneAction(followupId: number, done: boolean) {
  const { user } = await actor();
  await setLeadFollowupDone(user, followupId, done);
  revalidatePath("/leads");
  return { ok: true };
}

export async function deleteFollowupAction(followupId: number) {
  const { user } = await actor();
  await deleteLeadFollowup(user, followupId);
  revalidatePath("/leads");
  return { ok: true };
}

export async function addActivityAction(
  leadId: number,
  input: { type: ActivityType; body: string },
) {
  const { user, code } = await actor();
  await addActivity(user, leadId, { type: input.type, body: input.body, author: code });
  revalidatePath("/leads");
  return { ok: true };
}

export async function convertLeadAction(leadId: number) {
  const { user } = await actor();
  const year = await getCurrentYear();
  const { accountId } = await convertLeadToAccount(user, leadId, year);
  revalidatePath("/leads");
  revalidatePath("/accounts");
  return { accountId };
}

export async function addLeadAction(input: Partial<NewLeadInput>) {
  const { user, code } = await actor();
  await createLead(user, {
    prospect: input.prospect ?? "",
    owner: input.owner || code,
    oem: input.oem ?? null,
    city: input.city ?? null,
    stage: "new",
    students: input.students ?? 0,
    priceToUni: input.priceToUni ?? 0,
    priceToDatagami: input.priceToDatagami ?? 0,
    source: input.source ?? null,
    nextAction: input.nextAction ?? null,
    nextDate: input.nextDate ?? null,
    contactName: input.contactName ?? null,
    contactRole: input.contactRole ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
  });
  revalidatePath("/leads");
  return { ok: true };
}
