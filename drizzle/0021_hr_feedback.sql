ALTER TABLE "employee_profiles" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "employee_profiles" ALTER COLUMN "wfh_day" DROP DEFAULT;--> statement-breakpoint

-- Saturday is a company-wide working day. Remove the old recurring-WFH default
-- and normalize imported Saturday WFH marks to Present.
UPDATE "employee_profiles"
SET "wfh_day" = NULL,
    "updated_by" = NULL
WHERE "wfh_day" = 6;--> statement-breakpoint
UPDATE "attendance_records"
SET "day_type" = 'office',
    "updated_by" = NULL
WHERE "day_type" = 'wfh'
  AND EXTRACT(DOW FROM "date"::date) = 6;--> statement-breakpoint

-- HR correction: preserve each person's joining month/day and set the year.
UPDATE "employee_profiles" AS ep
SET "date_of_joining" = make_date(
      2025,
      EXTRACT(MONTH FROM ep."date_of_joining"::date)::integer,
      EXTRACT(DAY FROM ep."date_of_joining"::date)::integer
    ),
    "updated_by" = NULL
FROM "users" AS u
WHERE ep."user_id" = u."id"
  AND ep."date_of_joining" IS NOT NULL
  AND (
    lower(u."name") LIKE 'kiran%'
    OR lower(u."name") LIKE 'bini%'
  );
