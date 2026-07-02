import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  boolean,
  pgEnum,
  primaryKey,
  time,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import {
  ROLES,
  CATEGORIES,
  SEMESTERS,
  STATUSES,
  MODES,
  DIRECTIONS,
  ACCOUNT_TYPES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_COMMENT_KINDS,
  LEAD_STAGES,
  ACTIVITY_TYPES,
  EMPLOYEE_STATUSES,
  LEAVE_REQUEST_STATUSES,
  LEAVE_ACCRUAL_MODES,
  ATTENDANCE_DAY_TYPES,
  ATTENDANCE_SOURCES,
  UPLOAD_STATUSES,
  PAYROLL_RUN_STATUSES,
  LATE_LOP_MODES,
} from "./enums";

export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const semesterEnum = pgEnum("semester", SEMESTERS);
export const statusEnum = pgEnum("status", STATUSES);
export const modeEnum = pgEnum("mode", MODES);
export const directionEnum = pgEnum("direction", DIRECTIONS);
export const accountTypeEnum = pgEnum("account_type", ACCOUNT_TYPES);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
export const taskCommentKindEnum = pgEnum("task_comment_kind", TASK_COMMENT_KINDS);
export const leadStageEnum = pgEnum("lead_stage", LEAD_STAGES);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);
export const employeeStatusEnum = pgEnum("employee_status", EMPLOYEE_STATUSES);
export const leaveRequestStatusEnum = pgEnum("leave_request_status", LEAVE_REQUEST_STATUSES);
export const leaveAccrualModeEnum = pgEnum("leave_accrual_mode", LEAVE_ACCRUAL_MODES);
export const attendanceDayTypeEnum = pgEnum("attendance_day_type", ATTENDANCE_DAY_TYPES);
export const attendanceSourceEnum = pgEnum("attendance_source", ATTENDANCE_SOURCES);
export const uploadStatusEnum = pgEnum("upload_status", UPLOAD_STATUSES);
export const payrollRunStatusEnum = pgEnum("payroll_run_status", PAYROLL_RUN_STATUSES);
export const lateLopModeEnum = pgEnum("late_lop_mode", LATE_LOP_MODES);

export const oems = pgTable("oems", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  // True when the "OEM" is Datagami itself (own product → no external transfer).
  isSelf: boolean("is_self").notNull().default(false),
});

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull().default("university"),
  city: text("city"),
  oemId: integer("oem_id")
    .notNull()
    .references(() => oems.id),
});

export const academicYears = pgTable("academic_years", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().unique(), // "FY26–27"
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  yearId: integer("year_id")
    .notNull()
    .references(() => academicYears.id),
  category: categoryEnum("category").notNull(),
  semester: semesterEnum("semester").notNull().default("none"),
  students: integer("students").notNull().default(0),
  priceToUni: numeric("price_to_uni").notNull().default("0"),
  priceToDatagami: numeric("price_to_datagami").notNull().default("0"),
  gstRate: numeric("gst_rate").notNull().default("0.18"),
  tdsRate: numeric("tds_rate").notNull().default("0.10"),
  advanceAdj: numeric("advance_adj").notNull().default("0"),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  status: statusEnum("status").notNull().default("raised"),
});

export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  enrollmentYear: text("enrollment_year").notNull(), // "2024-25"
  count: integer("count").notNull().default(0),
  // Per-cohort locked-in prices. Null → fall back to the invoice's price.
  priceToUni: numeric("price_to_uni"),
  priceToDatagami: numeric("price_to_datagami"),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  direction: directionEnum("direction").notNull(),
  paidOn: date("paid_on").notNull(),
  amount: numeric("amount").notNull(),
  mode: modeEnum("mode").notNull(),
  ref: text("ref"),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("viewer"),
  // Set when the user confirms their email via the verification link.
  // Notification emails are only sent to verified addresses.
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userAccounts = pgTable(
  "user_accounts",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId] })],
);

/* =============================================================================
   WORKSPACE — Team board (internal delivery / issue tracking)
   Tasks link to a real account (null → Internal) and a real user as assignee
   (null → unassigned). The OEM chip is derived from the account. Assigning a
   task for an account the assignee isn't on is rejected in the DAL.
   ============================================================================= */
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // Null → "Internal" (no account).
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  // Null → unassigned. set null (not cascade) so deleting a user orphans, not drops, the task.
  assigneeId: integer("assignee_id").references(() => users.id, { onDelete: "set null" }),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  startDate: date("start_date"),
  dueDate: date("due_date"),
  status: taskStatusEnum("status").notNull().default("backlog"),
  // When the task entered "done" — drives the board's recency window (old done
  // tasks are hidden by default so the board stays bounded).
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Worklog / comment thread on a task.
export const taskComments = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  kind: taskCommentKindEnum("kind").notNull().default("comment"),
  author: text("author").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* =============================================================================
   WORKSPACE — Leads CRM (sales pipeline)
   Ported from the prototype's `leads` array. Prospects are NOT existing accounts,
   so `oem` is free text and the contact card is inlined on the lead row.
   ============================================================================= */
export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  prospect: text("prospect").notNull(),
  city: text("city"),
  oem: text("oem"),
  owner: text("owner").notNull(),
  stage: leadStageEnum("stage").notNull().default("new"),
  // Estimated value is DERIVED: students × priceToUni. Stored for sort/sum.
  value: numeric("value").notNull().default("0"),
  students: integer("students").notNull().default(0),
  // Per-seat estimates → drive value + margin (mirrors the invoice model).
  priceToUni: numeric("price_to_uni").notNull().default("0"),
  priceToDatagami: numeric("price_to_datagami").notNull().default("0"),
  nextAction: text("next_action"),
  nextDate: date("next_date"),
  source: text("source"),
  contactName: text("contact_name"),
  contactRole: text("contact_role"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  // Why a lead was marked lost (set when stage = 'lost').
  lostReason: text("lost_reason"),
  // Who created the lead — its owner can convert it (when won) without super-admin.
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // Set once a (won) lead is converted into a real account.
  convertedAccountId: integer("converted_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Scheduled follow-ups / reminders on a lead (a lead can have several).
export const leadFollowups = pgTable("lead_followups", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  dueDate: date("due_date"),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leadActivities = pgTable("lead_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  type: activityTypeEnum("type").notNull().default("note"),
  author: text("author").notNull(),
  body: text("body").notNull(),
  // Human display date ("16 Jun 2026"); `occurredAt` drives reverse-chron order.
  dateLabel: text("date_label").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

/* =============================================================================
   HR MODULE — Leave, Attendance & Payroll
   An app user becomes an "employee" when an employee_profiles row exists for
   them (1:1). The `hr` role (see enums) manages this module and can override
   records; super-admin keeps full access. Design & rules:
   docs/superpowers/specs/2026-07-01-hr-leave-attendance-payroll-design.md
   ============================================================================= */

// Work schedule a shift defines — drives late (LC) / early-leave (LE) detection.
export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // "General", "Early", "Late"
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  // Grace after start before an arrival counts as late.
  graceMinutes: integer("grace_minutes").notNull().default(0),
  // Late beyond this many minutes past grace → the day is a half-day (null = off).
  halfDayAfterMinutes: integer("half_day_after_minutes"),
  // Leaving this many minutes before end → flagged as leaving-early (null = off).
  earlyLeaveBeforeMinutes: integer("early_leave_before_minutes"),
  // Worked-minutes that count as a full day.
  fullDayMinutes: integer("full_day_minutes").notNull().default(480),
});

// 1:1 with users. Presence of a row = "this user is an employee".
export const employeeProfiles = pgTable("employee_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  employeeCode: text("employee_code").notNull().unique(), // "DG008" (roster code)
  altCodes: text("alt_codes").array().notNull().default(sql`ARRAY[]::text[]`), // {"TH095"}
  // Device ENROLLMENT number (e.g. "8") — how the fingerprint report identifies
  // this person; distinct from DG/TH codes.
  biometricId: text("biometric_id"),
  dateOfJoining: date("date_of_joining"),
  monthlySalary: numeric("monthly_salary").notNull().default("0"),
  shiftId: integer("shift_id").references(() => shifts.id, { onDelete: "set null" }),
  weeklyOffDay: integer("weekly_off_day").default(0), // 0=Sun … 6=Sat
  wfhDay: integer("wfh_day").default(6), // company default: Saturday
  dob: date("dob"),
  pan: text("pan"),
  aadhar: text("aadhar"),
  phone: text("phone"),
  // [{ name, relation, number }, …]
  emergencyContacts: jsonb("emergency_contacts"),
  status: employeeStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Company holiday calendar (paid days off, excluded from working days).
export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  name: text("name").notNull(),
});

// Single-row (id=1) HR policy config — late→LOP rule, cycle, working-days basis.
export const hrSettings = pgTable("hr_settings", {
  id: serial("id").primaryKey(),
  lateLopMode: lateLopModeEnum("late_lop_mode").notNull().default("late-count"),
  latesPerLopDay: integer("lates_per_lop_day").notNull().default(3),
  absentIsLop: boolean("absent_is_lop").notNull().default(true),
  workingDaysBasis: text("working_days_basis").notNull().default("calendar-minus-offs"),
  // Attendance/payroll cycle runs cycleStartDay → (start-1) of next month (26→25).
  cycleStartDay: integer("cycle_start_day").notNull().default(26),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// HR-configurable leave types (Casual, Sick, Earned, Unpaid, Comp-off, …).
export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(), // maps to grid codes (CL, SL, …)
  isPaid: boolean("is_paid").notNull().default(true),
  accrualMode: leaveAccrualModeEnum("accrual_mode").notNull().default("monthly"),
  annualEntitlement: numeric("annual_entitlement").notNull().default("0"), // "Total" e.g. 18
  monthlyAccrual: numeric("monthly_accrual").notNull().default("0"), // e.g. 1.5
  active: boolean("active").notNull().default(true),
});

// Per employee / leave type / calendar year. balance = carried + accrued − used.
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(), // calendar year
    carriedForward: numeric("carried_forward").notNull().default("0"), // "Last Year's"
    accrued: numeric("accrued").notNull().default("0"), // accrual-to-date
    used: numeric("used").notNull().default("0"),
    unpaidTaken: numeric("unpaid_taken").notNull().default("0"), // "Unpaid TO"
  },
  (t) => [unique().on(t.employeeId, t.leaveTypeId, t.year)],
);

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeeProfiles.id, { onDelete: "cascade" }),
  leaveTypeId: integer("leave_type_id")
    .notNull()
    .references(() => leaveTypes.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isHalfDay: boolean("is_half_day").notNull().default(false),
  days: numeric("days").notNull(), // computed working days (skips off/holiday)
  reason: text("reason").notNull(),
  status: leaveRequestStatusEnum("status").notNull().default("pending"),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One HR upload of a scanner file.
export const attendanceUploads = pgTable("attendance_uploads", {
  id: serial("id").primaryKey(),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  fileName: text("file_name").notNull(),
  blobUrl: text("blob_url"), // Vercel Blob raw file
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  rowCount: integer("row_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  unmatchedCount: integer("unmatched_count").notNull().default(0),
  status: uploadStatusEnum("status").notNull().default("parsed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Raw parsed rows from an upload (audit / re-collapse). Optional for already-daily
// device reports; used when a format needs punch-level retention.
export const attendancePunches = pgTable("attendance_punches", {
  id: serial("id").primaryKey(),
  uploadId: integer("upload_id")
    .notNull()
    .references(() => attendanceUploads.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // enrollment/emp code as printed
  employeeId: integer("employee_id").references(() => employeeProfiles.id, {
    onDelete: "set null",
  }),
  punchAt: timestamp("punch_at").notNull(),
  raw: text("raw"),
});

// The daily attendance truth table — one row per employee per day.
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dayType: attendanceDayTypeEnum("day_type").notNull(),
    isLate: boolean("is_late").notNull().default(false), // LC
    lateMinutes: integer("late_minutes").notNull().default(0),
    isEarlyLeave: boolean("is_early_leave").notNull().default(false), // LE
    earlyMinutes: integer("early_minutes").notNull().default(0),
    firstIn: time("first_in"),
    lastOut: time("last_out"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lopDays: numeric("lop_days").notNull().default("0"), // 0 / 0.5 / 1 for this day
    source: attendanceSourceEnum("source").notNull(),
    note: text("note"),
    overriddenByUserId: integer("overridden_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadId: integer("upload_id").references(() => attendanceUploads.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.employeeId, t.date)],
);

// A monthly payroll cycle (labeled by its end month). 26→25 by default.
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    month: integer("month").notNull(), // 1-12 (cycle end month)
    year: integer("year").notNull(),
    status: payrollRunStatusEnum("status").notNull().default("draft"),
    generatedByUserId: integer("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at"),
  },
  (t) => [unique().on(t.month, t.year)],
);

export const payslips = pgTable(
  "payslips",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    baseSalary: numeric("base_salary").notNull(),
    workingDays: numeric("working_days").notNull(),
    presentDays: numeric("present_days").notNull(),
    paidLeaveDays: numeric("paid_leave_days").notNull().default("0"),
    lopDays: numeric("lop_days").notNull().default("0"),
    lopAmount: numeric("lop_amount").notNull().default("0"),
    netPay: numeric("net_pay").notNull(),
    breakdown: jsonb("breakdown"), // itemized lines for transparency
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.runId, t.employeeId)],
);
