import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deliveryActivities, deliveryEvents, programs, users } from "@/lib/db/schema";
import { assertDeliveryManage, type SessionUser } from "@/lib/dal/authz";
import { UserError } from "@/lib/dal/errors";
import {
  DELIVERY_ACTIVITY_TYPES,
  DELIVERY_EVENT_STATUSES,
  type DeliveryActivityType,
  type DeliveryEventStatus,
} from "@/lib/db/enums";
import { assertDateOrder, assertIsoDate, toMoney } from "./util";

/**
 * Events (budgeted) and their activity log. Reads happen through
 * programs.ts (getProgramDetail / getProgramCalendar) and report.ts — this file
 * is the write side, so everything asserts MANAGE access.
 */

export type NewEvent = {
  programId: number;
  title: string;
  description?: string;
  venue?: string;
  startDate: string;
  endDate?: string;
  budget?: number;
  ownerUserId?: number | null;
};

export type NewActivity = {
  eventId: number;
  type: DeliveryActivityType;
  title: string;
  body?: string;
  activityDate: string;
  cost?: number;
};

function cleanEventInput(input: Omit<NewEvent, "programId">) {
  const title = input.title?.trim();
  if (!title) throw new UserError("Give the event a title.");
  if (title.length > 160) throw new UserError("Event title is too long.");
  assertIsoDate(input.startDate, "start date");
  if (input.endDate) assertIsoDate(input.endDate, "end date");
  assertDateOrder(input.startDate, input.endDate, "The event's");
  return {
    title,
    description: input.description?.trim() || null,
    venue: input.venue?.trim() || null,
    startDate: input.startDate,
    endDate: input.endDate || null,
    budget: toMoney(input.budget, "Budget"),
    ownerUserId: input.ownerUserId ?? null,
  };
}

async function assertEventRefs(ownerUserId: number | null): Promise<void> {
  if (ownerUserId === null) return;
  const owner = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerUserId)).limit(1);
  if (!owner.length) throw new UserError("Pick a valid owner.");
}

export async function createEvent(user: SessionUser, input: NewEvent): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const values = cleanEventInput(input);
  // Program and owner checks are independent — run them together (house rule).
  const [programRows] = await Promise.all([
    db.select({ id: programs.id }).from(programs).where(eq(programs.id, input.programId)).limit(1),
    assertEventRefs(values.ownerUserId),
  ]);
  if (!programRows.length) throw new UserError("Program not found.");
  const [row] = await db
    .insert(deliveryEvents)
    .values({ ...values, programId: input.programId })
    .returning({ id: deliveryEvents.id });
  return { id: row.id };
}

export async function updateEvent(user: SessionUser, id: number, input: Omit<NewEvent, "programId">): Promise<void> {
  assertDeliveryManage(user);
  const values = cleanEventInput(input);
  await assertEventRefs(values.ownerUserId);
  const updated = await db.update(deliveryEvents).set(values).where(eq(deliveryEvents.id, id)).returning({ id: deliveryEvents.id });
  if (!updated.length) throw new UserError("Event not found.");
}

export async function setEventStatus(user: SessionUser, id: number, status: DeliveryEventStatus): Promise<void> {
  assertDeliveryManage(user);
  if (!DELIVERY_EVENT_STATUSES.includes(status)) throw new UserError("Unknown event status.");
  const updated = await db.update(deliveryEvents).set({ status }).where(eq(deliveryEvents.id, id)).returning({ id: deliveryEvents.id });
  if (!updated.length) throw new UserError("Event not found.");
}

/** Hard delete — its activity log cascades away with it. */
export async function deleteEvent(user: SessionUser, id: number): Promise<void> {
  assertDeliveryManage(user);
  const deleted = await db.delete(deliveryEvents).where(eq(deliveryEvents.id, id)).returning({ id: deliveryEvents.id });
  if (!deleted.length) throw new UserError("Event not found.");
}

/**
 * Log something done under an event. `authorName` is snapshotted for report
 * history (mirrors lead_activities) alongside the user FK.
 */
export async function addActivity(user: SessionUser, authorName: string, input: NewActivity): Promise<{ id: number }> {
  assertDeliveryManage(user);
  const title = input.title?.trim();
  if (!title) throw new UserError("Describe the activity in a short title.");
  if (title.length > 200) throw new UserError("Activity title is too long.");
  if (!DELIVERY_ACTIVITY_TYPES.includes(input.type)) throw new UserError("Unknown activity type.");
  assertIsoDate(input.activityDate, "activity date");
  const [event] = await db.select({ id: deliveryEvents.id }).from(deliveryEvents).where(eq(deliveryEvents.id, input.eventId)).limit(1);
  if (!event) throw new UserError("Event not found.");
  const [row] = await db
    .insert(deliveryActivities)
    .values({
      eventId: input.eventId,
      type: input.type,
      title,
      body: input.body?.trim() || null,
      activityDate: input.activityDate,
      cost: toMoney(input.cost, "Cost"),
      createdByUserId: user.id,
      author: authorName.trim() || "Unknown",
    })
    .returning({ id: deliveryActivities.id });
  return { id: row.id };
}

export async function deleteActivity(user: SessionUser, id: number): Promise<void> {
  assertDeliveryManage(user);
  const deleted = await db.delete(deliveryActivities).where(eq(deliveryActivities.id, id)).returning({ id: deliveryActivities.id });
  if (!deleted.length) throw new UserError("Activity not found.");
}
