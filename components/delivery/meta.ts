/**
 * Client-safe display metadata for the delivery module (chips, dots, labels).
 * Colours are design-system CSS variables so light/dark both work.
 */
import type { DeliveryActivityType, DeliveryEventStatus, ProgramStatus } from "@/lib/db/enums";

export type ChipMeta = { label: string; text: string; bg: string; border: string };

export const PROGRAM_STATUS_META: Record<ProgramStatus, ChipMeta> = {
  planned: { label: "Planned", text: "var(--neutral-status-text)", bg: "var(--neutral-status-subtle)", border: "var(--neutral-status-border)" },
  active: { label: "Active", text: "var(--positive-text)", bg: "var(--positive-subtle)", border: "var(--positive-border)" },
  completed: { label: "Completed", text: "var(--info-text)", bg: "var(--info-subtle)", border: "var(--info-border)" },
  "on-hold": { label: "On hold", text: "var(--pending-text)", bg: "var(--pending-subtle)", border: "var(--pending-border)" },
};

export const EVENT_STATUS_META: Record<DeliveryEventStatus, ChipMeta> = {
  planned: { label: "Planned", text: "var(--primary-text)", bg: "var(--primary-subtle)", border: "var(--primary-border)" },
  completed: { label: "Completed", text: "var(--positive-text)", bg: "var(--positive-subtle)", border: "var(--positive-border)" },
  cancelled: { label: "Cancelled", text: "var(--negative-text)", bg: "var(--negative-subtle)", border: "var(--negative-border)" },
};

/** Calendar chip fill per event status (solid-ish so spans read as bars). */
export const EVENT_STATUS_BAR: Record<DeliveryEventStatus, { bg: string; text: string }> = {
  planned: { bg: "var(--primary-subtle)", text: "var(--primary-text)" },
  completed: { bg: "var(--positive-subtle)", text: "var(--positive-text)" },
  cancelled: { bg: "var(--negative-subtle)", text: "var(--negative-text)" },
};

export const ACTIVITY_TYPE_META: Record<DeliveryActivityType, { label: string; text: string; bg: string }> = {
  session: { label: "Session", text: "var(--positive-text)", bg: "var(--positive-subtle)" },
  meeting: { label: "Meeting", text: "var(--info-text)", bg: "var(--info-subtle)" },
  logistics: { label: "Logistics", text: "var(--pending-text)", bg: "var(--pending-subtle)" },
  procurement: { label: "Procurement", text: "var(--primary-text)", bg: "var(--primary-subtle)" },
  milestone: { label: "Milestone", text: "var(--info-text)", bg: "var(--info-subtle)" },
  expense: { label: "Expense", text: "var(--negative-text)", bg: "var(--negative-subtle)" },
  note: { label: "Note", text: "var(--text-secondary)", bg: "var(--surface-sunken)" },
};

/** Compact ₹ figure for chips and cells (full Money component elsewhere). */
export function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}
