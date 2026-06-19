CREATE TYPE "public"."account_type" AS ENUM('university', 'programme');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('advance', 'old', 'new');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('receipt', 'oem-payment');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('RTGS', 'NEFT', 'IMPS', 'UPI', 'Cheque');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('super-admin', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."semester" AS ENUM('none', '1', '2');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'raised', 'partially-paid', 'paid', 'overdue');--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "academic_years_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" DEFAULT 'university' NOT NULL,
	"city" text,
	"oem_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"enrollment_year" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"price_to_uni" numeric,
	"price_to_datagami" numeric
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"year_id" integer NOT NULL,
	"category" "category" NOT NULL,
	"semester" "semester" DEFAULT 'none' NOT NULL,
	"students" integer DEFAULT 0 NOT NULL,
	"price_to_uni" numeric DEFAULT '0' NOT NULL,
	"price_to_datagami" numeric DEFAULT '0' NOT NULL,
	"gst_rate" numeric DEFAULT '0.18' NOT NULL,
	"tds_rate" numeric DEFAULT '0.10' NOT NULL,
	"advance_adj" numeric DEFAULT '0' NOT NULL,
	"invoice_date" date,
	"status" "status" DEFAULT 'raised' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oems" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	CONSTRAINT "oems_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"direction" "direction" NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric NOT NULL,
	"mode" "mode" NOT NULL,
	"ref" text
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"user_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	CONSTRAINT "user_accounts_user_id_account_id_pk" PRIMARY KEY("user_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_oem_id_oems_id_fk" FOREIGN KEY ("oem_id") REFERENCES "public"."oems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_year_id_academic_years_id_fk" FOREIGN KEY ("year_id") REFERENCES "public"."academic_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;