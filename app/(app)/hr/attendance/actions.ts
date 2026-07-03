"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import {
  previewAttendance,
  commitAttendance,
  overrideAttendanceDay,
  setAttendanceLate,
  getDayAttendance,
  getEmployeeCalendar,
  type AttendancePreview,
} from "@/lib/dal/hr/attendance";
import type { AttendanceDayType } from "@/lib/db/enums";
import { isStorageConfigured, uploadBlob } from "@/lib/storage/blob";
import { isUserError } from "@/lib/dal/errors";

async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  return { id: Number(session.user.id), role: session.user.role };
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB — device reports are ~100 KB

async function fileBytes(formData: FormData): Promise<{ bytes: Buffer; name: string; type: string } | { error: string } | null> {
  const f = formData.get("file");
  if (!f || typeof f === "string") return null;
  const file = f as File;
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is too large (max 8 MB)." };
  return { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, type: file.type || "application/vnd.ms-excel" };
}

export async function previewAttendanceAction(
  formData: FormData,
): Promise<{ ok: true; preview: AttendancePreview } | { ok: false; error: string }> {
  try {
    const f = await fileBytes(formData);
    if (!f) return { ok: false, error: "No file selected." };
    if ("error" in f) return { ok: false, error: f.error };
    const preview = await previewAttendance(await actor(), f.bytes);
    if (!preview.matched.length && !preview.unmatched.length)
      return { ok: false, error: "No attendance rows found — is this the ZKTeco 'Basic Work Duration Report'?" };
    return { ok: true, preview };
  } catch (e) {
    console.error("[attendance:preview]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not read that file. Check it's the scanner .xls export." };
  }
}

export async function commitAttendanceAction(
  formData: FormData,
): Promise<{ ok: true; committed: number; matchedEmployees: number; unmatched: number } | { ok: false; error: string }> {
  try {
    const f = await fileBytes(formData);
    if (!f) return { ok: false, error: "No file selected." };
    if ("error" in f) return { ok: false, error: f.error };
    // Store the raw file for audit (best-effort — never blocks the commit).
    let blobUrl: string | null = null;
    if (isStorageConfigured()) {
      try {
        const safe = f.name.replace(/[^\w.\-]+/g, "_");
        const res = await uploadBlob(`attendance/${new Date().getFullYear()}/${Date.now()}-${safe}`, f.bytes, f.type);
        blobUrl = res.url;
      } catch (e) {
        console.error("[attendance:blob] upload failed:", e instanceof Error ? e.message : e);
      }
    }
    const result = await commitAttendance(await actor(), f.bytes, f.name, blobUrl);
    revalidatePath("/hr/attendance");
    return { ok: true, ...result };
  } catch (e) {
    console.error("[attendance:commit]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not commit attendance." };
  }
}

export async function overrideAttendanceAction(
  employeeId: number,
  date: string,
  dayType: AttendanceDayType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await overrideAttendanceDay(await actor(), employeeId, date, dayType);
    revalidatePath("/hr/attendance");
    return { ok: true };
  } catch (e) {
    console.error("[attendance:override]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update that day." };
  }
}

export async function setAttendanceLateAction(
  employeeId: number,
  date: string,
  isLate: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setAttendanceLate(await actor(), employeeId, date, isLate);
    revalidatePath("/hr/attendance");
    return { ok: true };
  } catch (e) {
    console.error("[attendance:late]", e);
    return { ok: false, error: isUserError(e) ? e.message : "Could not update the late flag." };
  }
}

export async function getDayAttendanceAction(date: string) {
  try {
    const data = await getDayAttendance(await actor(), date);
    return { ok: true as const, data };
  } catch (e) {
    console.error("[attendance:day]", e);
    return { ok: false as const, error: isUserError(e) ? e.message : "Could not load that day." };
  }
}

export async function getEmployeeCalendarAction(employeeId: number, year: number, month: number) {
  try {
    const data = await getEmployeeCalendar(await actor(), employeeId, year, month);
    return { ok: true as const, data };
  } catch (e) {
    console.error("[attendance:calendar]", e);
    return { ok: false as const, error: isUserError(e) ? e.message : "Could not load the calendar." };
  }
}
