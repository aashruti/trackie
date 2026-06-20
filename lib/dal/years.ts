import "server-only";
import { cookies } from "next/headers";
import { desc, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears, invoices } from "@/lib/db/schema";

const YEAR_COOKIE = "trackie-year";

export interface AcademicYearRow {
  id: number;
  label: string;
}

/** All academic years, newest first (by label, e.g. "FY27–28" > "FY26–27"). */
export async function listYears(): Promise<AcademicYearRow[]> {
  const rows = await db
    .select({ id: academicYears.id, label: academicYears.label })
    .from(academicYears)
    .orderBy(desc(academicYears.label));
  return rows;
}

export async function latestYearLabel(): Promise<string | null> {
  const rows = await listYears();
  return rows[0]?.label ?? null;
}

/**
 * The latest "active" year — newest year that has at least one non-draft invoice.
 * A freshly rolled-over all-Draft year does NOT become the default until its
 * invoices are raised. Falls back to the latest year overall.
 */
async function latestActiveYearLabel(years: AcademicYearRow[]): Promise<string | null> {
  const active = await db
    .select({ yearId: invoices.yearId })
    .from(invoices)
    .where(ne(invoices.status, "draft"));
  const activeIds = new Set(active.map((r) => r.yearId));
  const activeYear = years.find((y) => activeIds.has(y.id)); // years are desc
  return activeYear?.label ?? years[0]?.label ?? null;
}

/**
 * The user's current academic year: the `trackie-year` cookie if it names an
 * existing year, else the latest active (non-draft) year.
 */
export async function getCurrentYear(): Promise<string> {
  const years = await listYears();
  const labels = years.map((y) => y.label);
  const cookieVal = (await cookies()).get(YEAR_COOKIE)?.value;
  if (cookieVal && labels.includes(cookieVal)) return cookieVal;
  return (await latestActiveYearLabel(years)) ?? "FY26–27";
}

/**
 * Returns both the current year label and the full year list in a single
 * `listYears()` call. Use this instead of calling `getCurrentYear()` +
 * `listYears()` separately — pages were doing 2× listYears per request.
 */
export async function getYearContext(): Promise<{ currentYear: string; years: string[] }> {
  const rows = await listYears();
  const labels = rows.map((y) => y.label);
  const cookieVal = (await cookies()).get(YEAR_COOKIE)?.value;
  const currentYear = cookieVal && labels.includes(cookieVal)
    ? cookieVal
    : ((await latestActiveYearLabel(rows)) ?? "FY26–27");
  return { currentYear, years: labels };
}

export { YEAR_COOKIE };
