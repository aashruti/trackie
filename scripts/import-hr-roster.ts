/**
 * Flag EXISTING users as employees from the Datagami attendance workbook.
 *
 * Does NOT create users — it matches each existing `users` row to a roster
 * employee by name, then upserts an employee_profiles row (code, alt codes,
 * DOB/PAN/Aadhaar/phone, biometric id) and the Earned-leave balance from the
 * Leave-26 sheet. Idempotent (keyed on user_id / employee_code).
 *
 * Dry-run by default (prints the plan, writes nothing). Pass --commit to write.
 *
 *   npx tsx scripts/import-hr-roster.ts \
 *     --roster "~/Downloads/Attendance June 2026.xlsx" \
 *     --scanner "~/Downloads/June Month Report.xls" [--commit]
 *
 * Target DB = DATABASE_URL (set it explicitly for prod; else .env.local).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import os from "node:os";
import * as XLSX from "xlsx";

type RosterEmp = {
  code: string; // primary (DG… preferred)
  altCodes: string[];
  name: string;
  status: string;
  dob: string | null;
  pan: string | null;
  aadhar: string | null;
  phone: string | null;
};
type LeaveRow = { lastYear: number; accrued: number; used: number; unpaid: number };

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
function argVal(flag: string, def: string) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const expand = (p: string) => p.replace(/^~/, os.homedir());
const ROSTER_PATH = expand(argVal("--roster", `${os.homedir()}/Downloads/Attendance June 2026.xlsx`));
const SCANNER_PATH = expand(argVal("--scanner", `${os.homedir()}/Downloads/June Month Report.xls`));

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function excelDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  // Use LOCAL components — cellDates gives a Date at local midnight; toISOString
  // would shift it to the previous day in +ve timezones (off-by-one DOB bug).
  if (v instanceof Date)
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  if (typeof v === "number") {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function parseRoster(path: string): RosterEmp[] {
  // No cellDates → dates come through as raw Excel serials, which excelDate()
  // converts via SSF (timezone-independent), avoiding the local-midnight/UTC
  // off-by-one that cellDates Date objects cause.
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets["Employee Data"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][];
  const out: RosterEmp[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawCode = row[0] == null ? "" : String(row[0]).trim();
    const name = row[1] == null ? "" : String(row[1]).trim();
    if (!rawCode || !name || name === "?") continue;
    const codes = rawCode.split("/").map((c) => c.trim()).filter(Boolean);
    const primary = codes.find((c) => /^DG/i.test(c)) ?? codes[0];
    out.push({
      code: primary,
      altCodes: codes.filter((c) => c !== primary),
      name,
      status: String(row[2] ?? "").trim(),
      dob: excelDate(row[3]),
      pan: row[4] ? String(row[4]).trim() : null,
      aadhar: row[5] ? String(row[5]).trim() : null,
      phone: row[6] ? String(row[6]).trim() : null,
    });
  }
  return out;
}

function parseLeave(path: string): Map<string, LeaveRow> {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets["Leave-26"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }) as unknown[][];
  // Columns (0-based): 0 Emp Id, 1 Name, 3 Total, 4 Last Year's, 5 Accrued, 6 Unpaid TO, 7 Used
  const byName = new Map<string, LeaveRow>();
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = row[1] == null ? "" : String(row[1]).trim();
    if (!name) continue;
    byName.set(norm(name), {
      lastYear: toNum(row[4]),
      accrued: toNum(row[5]),
      unpaid: toNum(row[6]),
      used: toNum(row[7]),
    });
  }
  return byName;
}

function parseScannerEnrollment(path: string): Map<string, string> {
  const wb = XLSX.readFile(path, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }) as unknown[][];
  const byName = new Map<string, string>();
  for (const row of rows) {
    const c0 = String(row?.[0] ?? "");
    if (!c0.startsWith("Emp. Code")) continue;
    const code = String(row[2] ?? "").trim();
    const nameCell = (row as unknown[]).findIndex((v) => String(v ?? "").startsWith("Emp. Name"));
    let name = "";
    if (nameCell >= 0) {
      for (let c = nameCell + 1; c < row.length; c++) {
        if (row[c]) { name = String(row[c]).trim(); break; }
      }
    }
    if (name && code) byName.set(norm(name), code);
  }
  return byName;
}

function matchRoster(userName: string, roster: RosterEmp[]): RosterEmp | null {
  const un = norm(userName);
  const ut = un.split(" ");
  for (const e of roster) {
    const rn = norm(e.name);
    const rt = rn.split(" ");
    // exact, or a single-name that prefixes the full name ("Dhaval" → "Dhaval Shah",
    // "Bini" → "Biniyamin Bhoraniya"), or both multi-token with first AND last matching
    // (so "Rahul Sharma" ≠ "Rahul Verma").
    if (rn === un) return e;
    if ((ut.length === 1 || rt.length === 1) && (rn.startsWith(un) || un.startsWith(rn))) return e;
    if (ut.length >= 2 && rt.length >= 2 && ut[0] === rt[0] && ut[ut.length - 1] === rt[rt.length - 1]) return e;
  }
  return null;
}
function matchBiometric(name: string, enroll: Map<string, string>): string | null {
  const n = norm(name);
  const t = n.split(" ");
  for (const [enm, ec] of enroll) {
    const et = enm.split(" ");
    if (enm === n || enm.includes(n) || n.includes(enm)) return ec;
    // first + last token match (handles a middle name in the scanner's version)
    if (t.length >= 2 && et.length >= 2 && t[0] === et[0] && t[t.length - 1] === et[t.length - 1]) return ec;
  }
  return null;
}

async function main() {
  const roster = parseRoster(ROSTER_PATH);
  const leave = parseLeave(ROSTER_PATH);
  const enroll = parseScannerEnrollment(SCANNER_PATH);
  console.log(
    `Loaded: ${roster.length} roster employees, ${leave.size} leave rows, ${enroll.size} scanner enrollments.`,
  );

  const { db } = await import("../lib/db/client");
  const schema = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const users = await db.select().from(schema.users);
  const existingProfiles = await db.select({ userId: schema.employeeProfiles.userId }).from(schema.employeeProfiles);
  const haveProfile = new Set(existingProfiles.map((p) => p.userId));
  const [earned] = await db.select().from(schema.leaveTypes).where(eq(schema.leaveTypes.code, "EL")).limit(1);

  const year = 2026;
  const plan: { userId: number; userName: string; emp: RosterEmp; bio: string | null; lv: LeaveRow | undefined; already: boolean }[] = [];
  const skipped: string[] = [];
  for (const u of users) {
    const emp = matchRoster(u.name, roster);
    if (!emp || emp.status.toLowerCase() !== "active") {
      skipped.push(`${u.name} (${u.email})${emp ? " — matched but not active" : " — no roster match"}`);
      continue;
    }
    plan.push({
      userId: u.id,
      userName: u.name,
      emp,
      bio: matchBiometric(emp.name, enroll),
      lv: leave.get(norm(emp.name)),
      already: haveProfile.has(u.id),
    });
  }

  console.log(`\n=== PLAN — ${plan.length} employees to flag, ${skipped.length} skipped ===`);
  console.log("user".padEnd(18), "code".padEnd(12), "bio".padEnd(5), "already?", "leave(EL c/a/u/unp)");
  for (const p of plan) {
    const lv = p.lv ? `${p.lv.lastYear}/${p.lv.accrued}/${p.lv.used}/${p.lv.unpaid}` : "—";
    console.log(
      p.userName.padEnd(18),
      p.emp.code.padEnd(12),
      String(p.bio ?? "—").padEnd(5),
      (p.already ? "yes" : "no").padEnd(8),
      earned ? lv : "(no EL type — seed config first)",
    );
  }
  console.log("\nSkipped:");
  for (const s of skipped) console.log("  -", s);

  if (!COMMIT) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    process.exit(0);
  }
  if (!earned) {
    console.error("\nABORT: leave type 'EL' (Earned) not found — run `db:seed-hr` (config) first.");
    process.exit(1);
  }

  let profiles = 0;
  let balances = 0;
  for (const p of plan) {
    await db
      .insert(schema.employeeProfiles)
      .values({
        userId: p.userId,
        employeeCode: p.emp.code,
        altCodes: p.emp.altCodes,
        biometricId: p.bio,
        dob: p.emp.dob,
        pan: p.emp.pan,
        aadhar: p.emp.aadhar,
        phone: p.emp.phone,
        status: "active",
      })
      .onConflictDoNothing({ target: schema.employeeProfiles.userId });
    const [prof] = await db
      .select({ id: schema.employeeProfiles.id })
      .from(schema.employeeProfiles)
      .where(eq(schema.employeeProfiles.userId, p.userId))
      .limit(1);
    profiles++;
    if (prof && p.lv) {
      await db
        .insert(schema.leaveBalances)
        .values({
          employeeId: prof.id,
          leaveTypeId: earned.id,
          year,
          carriedForward: String(p.lv.lastYear),
          accrued: String(p.lv.accrued),
          used: String(p.lv.used),
          unpaidTaken: String(p.lv.unpaid),
        })
        .onConflictDoNothing({
          target: [schema.leaveBalances.employeeId, schema.leaveBalances.leaveTypeId, schema.leaveBalances.year],
        });
      balances++;
    }
  }
  console.log(`\nCOMMITTED: ${profiles} employee profiles, ${balances} leave balances.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Import failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
