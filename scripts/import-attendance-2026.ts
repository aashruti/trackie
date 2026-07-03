/**
 * Import the manual monthly attendance grid (Datagami Attendance 2026.xlsx →
 * "Jan-26" … "Jul-26") into attendance_records as source='import'. This is the
 * pre-fingerprint history that lets payroll be validated back to January.
 *
 *   npx tsx scripts/import-attendance-2026.ts [--file <path>] [--commit]
 *
 * Cell codes → day_type: blank/H handled; P=office, WFH, A=absent, OV=official-
 * visit, CL=comp-off, HD=half-day, LC=late (present), LE=early-leave (present).
 * Dry-run by default; --commit writes. Target = DATABASE_URL (else .env.local).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import os from "node:os";
import * as XLSX from "xlsx";
import type { AttendanceDayType } from "../lib/db/enums";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const fileArg = args.indexOf("--file");
const FILE = (fileArg >= 0 && args[fileArg + 1] ? args[fileArg + 1] : `${os.homedir()}/Downloads/Datagami Attendance 2026.xlsx`).replace(/^~/, os.homedir());

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

type Rec = { dayType: AttendanceDayType; lopDays: string; isLate: boolean; isEarlyLeave: boolean };

/** Map a grid cell code to an attendance record, or null to skip (blank / no data). */
function mapCode(raw: string, dow: number): Rec | null {
  const c = raw.trim().toUpperCase();
  if (c === "" || c === "-") return dow === 0 ? { dayType: "weekly-off", lopDays: "0", isLate: false, isEarlyLeave: false } : null;
  const base = (dt: AttendanceDayType, lop: string, late = false, early = false): Rec => ({ dayType: dt, lopDays: lop, isLate: late, isEarlyLeave: early });
  switch (c) {
    case "P": return base("office", "0");
    case "WFH": return base("wfh", "0");
    case "A": return base("absent", "1");
    case "OV": return base("official-visit", "0");
    case "CL": return base("comp-off", "0");
    case "HD": return base("half-day", "0.5");
    case "H": return base("holiday", "0");
    case "WO": return base("weekly-off", "0");
    case "LC": return base("office", "0", true, false); // late coming — present but late
    case "LE": return base("office", "0", false, true); // leaving early — present
    default: return null; // unknown code — skip + report (never silently mark present)
  }
}

async function main() {
  const wb = XLSX.readFile(FILE);
  const monthSheets = wb.SheetNames.filter((s) => /^[A-Z][a-z]{2}-26$/.test(s));
  console.log(`File: ${FILE}\nMonthly sheets: ${monthSheets.join(", ")}\n`);

  const { db } = await import("../lib/db/client");
  const schema = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");

  // code → employeeId (primary DG code + alt codes)
  const profs = await db.select({ id: schema.employeeProfiles.id, code: schema.employeeProfiles.employeeCode, alts: schema.employeeProfiles.altCodes }).from(schema.employeeProfiles);
  const byCode = new Map<string, number>();
  for (const p of profs) {
    byCode.set(p.code.toUpperCase(), p.id);
    for (const a of p.alts ?? []) byCode.set(String(a).toUpperCase(), p.id);
  }

  type Row = { employeeId: number; date: string; dayType: AttendanceDayType; source: "import"; lopDays: string; isLate: boolean; isEarlyLeave: boolean };
  const rows: Row[] = [];
  const unmatched = new Set<string>();
  const unknownCells = new Set<string>();
  const perMonth: Record<string, number> = {};

  for (const sheet of monthSheets) {
    const mon = MONTHS[sheet.slice(0, 3)];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: false, defval: null }) as unknown[][];
    const dayCols: { col: number; day: number }[] = [];
    for (let c = 2; c < (grid[1]?.length ?? 0); c++) {
      const d = Number(String(grid[1]?.[c] ?? "").trim());
      if (Number.isInteger(d) && d >= 1 && d <= 31) dayCols.push({ col: c, day: d });
    }
    let count = 0;
    for (let r = 3; r < grid.length; r++) {
      const row = grid[r] || [];
      const rawCode = String(row[0] ?? "").trim();
      if (!rawCode) continue;
      const parts = rawCode.split("/").map((s) => s.trim().toUpperCase());
      const empId = parts.map((p) => byCode.get(p)).find((x) => x != null);
      if (empId == null) { unmatched.add(rawCode); continue; }
      for (const { col, day } of dayCols) {
        const date = `2026-${pad(mon)}-${pad(day)}`;
        const dow = new Date(date + "T00:00:00Z").getUTCDay();
        const cell = String(row[col] ?? "").trim();
        const rec = mapCode(cell, dow);
        if (!rec) {
          // A non-blank cell that mapped to nothing is an unrecognized code — flag it
          // (blanks / "-" are expected skips; a weekly-off Sunday blank maps to a rec).
          if (cell && cell !== "-") unknownCells.add(`${cell} (${sheet} ${rawCode})`);
          continue;
        }
        rows.push({ employeeId: empId, date, source: "import", ...rec });
        count++;
      }
    }
    perMonth[sheet] = count;
  }

  console.log("records per month:", JSON.stringify(perMonth));
  console.log(`total: ${rows.length} records for ${new Set(rows.map((r) => r.employeeId)).size} employees`);
  if (unmatched.size) console.log("UNMATCHED employee codes (skipped):", [...unmatched].join(", "));
  if (unknownCells.size) console.log("UNKNOWN cell codes (skipped, NOT counted):", [...unknownCells].join(" | "));

  if (!COMMIT) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); process.exit(0); }

  // Import is authoritative over scanner/prior-import, but preserves deliberate
  // manual overrides and approved-leave rows.
  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await db
      .insert(schema.attendanceRecords)
      .values(batch)
      .onConflictDoUpdate({
        target: [schema.attendanceRecords.employeeId, schema.attendanceRecords.date],
        set: {
          dayType: sql`excluded.day_type`,
          lopDays: sql`excluded.lop_days`,
          isLate: sql`excluded.is_late`,
          isEarlyLeave: sql`excluded.is_early_leave`,
          source: sql`excluded.source`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${schema.attendanceRecords.source} in ('scanner', 'import')`,
      });
    written += batch.length;
  }
  console.log(`\nCOMMITTED: ${written} attendance records (source=import).`);
  process.exit(0);
}

main().catch((e) => { console.error("Import failed:", e); process.exit(1); });
