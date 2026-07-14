/**
 * Shared, client-safe constants + view types for the Team board and Leads CRM.
 * Mirrors the prototype's COLS / LSTAGES / PRIO / ASSIGNEES / LOWNERS / ACTMETA
 * maps. Colour values are design-system CSS variables so light/dark both work.
 * Pure — no DB, no `server-only` — so it imports cleanly into client components.
 */
import type {
  TaskStatus,
  TaskPriority,
  TaskCommentKind,
  TaskBoard,
  LeadStage,
  ActivityType,
} from "@/lib/db/enums";

// ---- View row types ---------------------------------------------------------
export type TaskRow = {
  id: number;
  title: string;
  accountId: number | null;
  accountName: string | null; // null → Internal
  oem: string | null; // derived from the account's OEM
  assigneeId: number | null;
  assigneeName: string | null; // null → unassigned
  priority: TaskPriority;
  tags: string[];
  startDate: string | null; // ISO "YYYY-MM-DD"
  dueDate: string | null; // ISO "YYYY-MM-DD"
  status: TaskStatus;
  board: TaskBoard;
  programId: number | null; // delivery-board tasks may carry program context
  programName: string | null;
  commentCount: number;
};

export type TaskComment = {
  id: number;
  kind: TaskCommentKind;
  author: string;
  body: string;
  createdAt: string; // ISO timestamp
};

export type TaskDetailRow = TaskRow & { comments: TaskComment[] };

export type Option = { id: number; name: string };

/** Program picker option for the delivery board (program → implies account). */
export type ProgramOption = { id: number; name: string; accountId: number };

export type LeadActivityRow = {
  id: number;
  type: ActivityType;
  author: string;
  body: string;
  dateLabel: string;
};

export type LeadRow = {
  id: number;
  prospect: string;
  city: string | null;
  oem: string | null;
  owner: string;
  stage: LeadStage;
  value: number; // derived: students × priceToUni
  margin: number; // derived: students × (priceToUni − priceToDatagami)
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  nextAction: string | null;
  nextDate: string | null;
  source: string | null;
  contact: { name: string | null; role: string | null; email: string | null; phone: string | null };
  lostReason: string | null;
  convertedAccountId: number | null;
  createdById: number | null;
  activityCount: number;
};

export type LeadFollowupRow = {
  id: number;
  action: string;
  dueDate: string | null; // ISO "YYYY-MM-DD"
  done: boolean;
};

export type LeadDetailRow = LeadRow & {
  activities: LeadActivityRow[];
  followups: LeadFollowupRow[];
};

// ---- People roster (assignees + lead owners + activity authors) -------------
export type Person = { name: string; bg: string; fg: string };

export const PEOPLE: Record<string, Person> = {
  RK: { name: "Ramesh Kothari", bg: "var(--primary-subtle)", fg: "var(--primary-text)" },
  PN: { name: "Priya Nair", bg: "var(--info-subtle)", fg: "var(--info-text)" },
  AR: { name: "Arjun Rao", bg: "var(--positive-subtle)", fg: "var(--positive-text)" },
  NS: { name: "Neha Singh", bg: "var(--pending-subtle)", fg: "var(--pending-text)" },
};

export function person(code: string): Person {
  return PEOPLE[code] ?? { name: code, bg: "var(--surface-sunken)", fg: "var(--text-secondary)" };
}

/** Initials a name into a roster code, e.g. "Ramesh Kothari" → "RK". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Deterministic avatar colours for real users (no fixed roster). Stable per name.
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: "var(--primary-subtle)", fg: "var(--primary-text)" },
  { bg: "var(--info-subtle)", fg: "var(--info-text)" },
  { bg: "var(--positive-subtle)", fg: "var(--positive-text)" },
  { bg: "var(--pending-subtle)", fg: "var(--pending-text)" },
  { bg: "var(--negative-subtle)", fg: "var(--negative-text)" },
];

export function userColor(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// ---- Team board: columns + priorities --------------------------------------
export const TASK_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "backlog", label: "Backlog", color: "var(--slate-400)" },
  { id: "open", label: "Open", color: "var(--primary)" },
  { id: "progress", label: "In progress", color: "var(--info)" },
  { id: "review", label: "In review", color: "var(--pending)" },
  { id: "blocked", label: "Blocked", color: "var(--negative)" },
  { id: "done", label: "Done", color: "var(--positive)" },
];

/** The active Kanban (Backlog is triaged on its own page). */
export const BOARD_COLUMNS = TASK_COLUMNS.filter((c) => c.id !== "backlog");
export const BOARD_STATUSES = BOARD_COLUMNS.map((c) => c.id);

export type StatusMeta = { label: string; dot: string; bg: string; text: string; border: string };

/** Per-status colours for the status chip (subtle fill + readable text). */
export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { label: "Backlog", dot: "var(--slate-400)", bg: "var(--neutral-status-subtle)", text: "var(--neutral-status-text)", border: "var(--neutral-status-border)" },
  open: { label: "Open", dot: "var(--primary)", bg: "var(--primary-subtle)", text: "var(--primary-text)", border: "var(--primary-border)" },
  progress: { label: "In progress", dot: "var(--info)", bg: "var(--info-subtle)", text: "var(--info-text)", border: "var(--info-border)" },
  review: { label: "In review", dot: "var(--pending)", bg: "var(--pending-subtle)", text: "var(--pending-text)", border: "var(--pending-border)" },
  blocked: { label: "Blocked", dot: "var(--negative)", bg: "var(--negative-subtle)", text: "var(--negative-text)", border: "var(--negative-border)" },
  done: { label: "Done", dot: "var(--positive)", bg: "var(--positive-subtle)", text: "var(--positive-text)", border: "var(--positive-border)" },
};

export type PriorityMeta = {
  label: string;
  color: string; // left-border + dot
  text: string;
  bg: string;
  border: string;
};

export const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  high: {
    label: "High",
    color: "var(--negative)",
    text: "var(--negative-text)",
    bg: "var(--negative-subtle)",
    border: "var(--negative-border)",
  },
  medium: {
    label: "Medium",
    color: "var(--pending)",
    text: "var(--pending-text)",
    bg: "var(--pending-subtle)",
    border: "var(--pending-border)",
  },
  low: {
    label: "Low",
    color: "var(--slate-400)",
    text: "var(--text-secondary)",
    bg: "var(--surface-sunken)",
    border: "var(--border)",
  },
};

// ---- Leads CRM: stages + activity types ------------------------------------
export const LEAD_STAGE_META: { id: LeadStage; label: string; color: string }[] = [
  { id: "new", label: "New", color: "var(--slate-400)" },
  { id: "contacted", label: "Contacted", color: "var(--info)" },
  { id: "qualified", label: "Qualified", color: "var(--gold-500)" },
  { id: "proposal", label: "Proposal", color: "var(--pending)" },
  { id: "negotiation", label: "Negotiation", color: "var(--gold-600)" },
  { id: "won", label: "Won", color: "var(--positive)" },
  { id: "lost", label: "Lost", color: "var(--negative)" },
];

/** Terminal stages — closed, not part of the open pipeline. */
export const CLOSED_LEAD_STAGES: LeadStage[] = ["won", "lost"];

export function stageLabel(stage: LeadStage): string {
  return LEAD_STAGE_META.find((s) => s.id === stage)?.label ?? stage;
}

export type ActivityMeta = { label: string; color: string; bg: string };

export const ACTIVITY_META: Record<ActivityType, ActivityMeta> = {
  call: { label: "Call", color: "var(--info-text)", bg: "var(--info-subtle)" },
  email: { label: "Email", color: "var(--primary-text)", bg: "var(--primary-subtle)" },
  meeting: { label: "Meeting", color: "var(--positive-text)", bg: "var(--positive-subtle)" },
  note: { label: "Note", color: "var(--text-secondary)", bg: "var(--surface-sunken)" },
};

// ---- Pure stat helpers (unit-tested) ---------------------------------------
export function teamStats(tasks: { status: TaskStatus }[]) {
  return {
    open: tasks.filter((t) => t.status !== "done").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    done: tasks.filter((t) => t.status === "done").length,
  };
}

const isOpenStage = (s: LeadStage) => s !== "won" && s !== "lost";

export function leadStats(leads: { stage: LeadStage; value: number }[]) {
  return {
    activeCount: leads.filter((l) => isOpenStage(l.stage)).length,
    pipelineValue: leads.filter((l) => isOpenStage(l.stage)).reduce((a, l) => a + l.value, 0),
    wonValue: leads.filter((l) => l.stage === "won").reduce((a, l) => a + l.value, 0),
    lostCount: leads.filter((l) => l.stage === "lost").length,
  };
}

/** Sum of est. value for the leads in one stage column. */
export function stageSum(leads: { value: number }[]): number {
  return leads.reduce((a, l) => a + l.value, 0);
}
