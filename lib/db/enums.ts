export const ROLES = ["super-admin", "admin", "viewer"] as const;
export const CATEGORIES = ["advance", "old", "new"] as const;
export const SEMESTERS = ["none", "1", "2"] as const;
export const STATUSES = ["draft", "raised", "partially-paid", "paid", "overdue"] as const;
export const MODES = ["RTGS", "NEFT", "IMPS", "UPI", "Cheque"] as const;
export const DIRECTIONS = ["receipt", "oem-payment"] as const;
export const ACCOUNT_TYPES = ["university", "programme"] as const;

// ---- Workspace: Team board (fixed status + priority vocabulary) -------------
// Lifecycle: backlog (icebox) → open (on the board) → progress → review → blocked → done.
export const TASK_STATUSES = ["backlog", "open", "progress", "review", "blocked", "done"] as const;
export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export const TASK_COMMENT_KINDS = ["worklog", "comment"] as const;

// ---- Workspace: Leads CRM (fixed pipeline stages + discussion types) --------
export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;

export type Role = (typeof ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskCommentKind = (typeof TASK_COMMENT_KINDS)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
