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
