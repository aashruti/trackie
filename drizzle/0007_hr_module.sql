-- Add 'half-day' to the attendance day-type enum (½P from the scanner report).
ALTER TYPE "public"."attendance_day_type" ADD VALUE IF NOT EXISTS 'half-day';
