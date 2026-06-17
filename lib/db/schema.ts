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
} from "./enums";

export const roleEnum = pgEnum("role", ROLES);
export const categoryEnum = pgEnum("category", CATEGORIES);
export const semesterEnum = pgEnum("semester", SEMESTERS);
export const statusEnum = pgEnum("status", STATUSES);
export const modeEnum = pgEnum("mode", MODES);
export const directionEnum = pgEnum("direction", DIRECTIONS);
export const accountTypeEnum = pgEnum("account_type", ACCOUNT_TYPES);

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
  status: statusEnum("status").notNull().default("raised"),
});

export const cohorts = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  enrollmentYear: text("enrollment_year").notNull(), // "2024-25"
  count: integer("count").notNull().default(0),
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
