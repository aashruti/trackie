ALTER TABLE "employee_profiles" ADD COLUMN "insurance_monthly" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "tds_monthly" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "professional_tax" numeric DEFAULT '200' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "per_day" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "days_worked" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "earned_gross" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "basic" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "hra" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "other_allowance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "insurance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "professional_tax" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "tds" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "additions" numeric DEFAULT '0' NOT NULL;