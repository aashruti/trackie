export const ROLES = ["super-admin", "admin", "viewer", "hr"] as const;
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

// ---- HR module: leave / attendance / payroll --------------------------------
// Employee lifecycle on the roster.
export const EMPLOYEE_STATUSES = ["active", "inactive"] as const;
// Leave request approval lifecycle.
export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
// How a leave type is granted: whole entitlement up-front (annual) or monthly steps.
export const LEAVE_ACCRUAL_MODES = ["annual", "monthly"] as const;
// The mutually-exclusive nature of a single attendance day (matches the workbook
// code grid: blank=office, WFH, OV, CL, leave, off, holiday, absent).
export const ATTENDANCE_DAY_TYPES = [
  "office",
  "wfh",
  "official-visit",
  "comp-off",
  "paid-leave",
  "unpaid-leave",
  "weekly-off",
  "holiday",
  "absent",
  "half-day",
] as const;
// Where an attendance record came from.
export const ATTENDANCE_SOURCES = ["scanner", "manual", "import", "leave", "auto-off"] as const;
// Lifecycle of a scanner-file upload batch.
export const UPLOAD_STATUSES = ["parsed", "committed", "discarded"] as const;
// Payroll run lifecycle — draft is editable, finalized is locked.
export const PAYROLL_RUN_STATUSES = ["draft", "finalized"] as const;
// How lateness turns into loss of pay.
export const LATE_LOP_MODES = ["late-count", "half-day-threshold"] as const;

export type Role = (typeof ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskCommentKind = (typeof TASK_COMMENT_KINDS)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];
export type LeaveAccrualMode = (typeof LEAVE_ACCRUAL_MODES)[number];
export type AttendanceDayType = (typeof ATTENDANCE_DAY_TYPES)[number];
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];
export type LateLopMode = (typeof LATE_LOP_MODES)[number];
