"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { YEAR_COOKIE } from "@/lib/dal/years";

/** Set the sticky current academic year and return to the current page. */
export async function setYearAction(year: string, pathname: string) {
  (await cookies()).set(YEAR_COOKIE, year, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(pathname || "/dashboard");
}
