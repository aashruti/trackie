import "server-only";
import { cookies } from "next/headers";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { academicYears } from "@/lib/db/schema";

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
 * The user's current academic year: the `trackie-year` cookie if it names an
 * existing year, else the latest year.
 */
export async function getCurrentYear(): Promise<string> {
  const years = await listYears();
  const labels = years.map((y) => y.label);
  const cookieVal = (await cookies()).get(YEAR_COOKIE)?.value;
  if (cookieVal && labels.includes(cookieVal)) return cookieVal;
  return labels[0] ?? "FY26–27";
}

export { YEAR_COOKIE };
