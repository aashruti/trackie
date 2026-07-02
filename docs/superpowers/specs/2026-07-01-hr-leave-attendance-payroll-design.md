# HR Module: Leave, Attendance & Payroll — Design

**Date:** 2026-07-01
**Status:** Design (approved to draft; phased implementation)
**Author:** brainstormed with aashruti
**Reference implementation:** opsy (`/Users/kunalsharma/theplahouse/opsy`) — Prisma, but the leave /
attendance / salary building blocks already exist and are ported here to Drizzle.
**Reference data:** `Datagami Attendance 2026.xlsx` — the current manual attendance workbook
(roster + monthly code grids + leave ledger). Its structure defines the target model and is
the initial import source.

## 1. Summary

Add an HR module to trackie so app users can be flagged as **employees**, apply for **leave**,
have **attendance** ingested from a biometric fingerprint scanner file, be marked **late /
leaving early**, and have **loss of pay (LOP)** flow into a monthly **payroll** run. A new **HR
role** administers and overrides everything.

Trackie today is a financial/CRM tracker (Next.js 16 · Drizzle · Neon · next-auth JWT · Tailwind
v4 custom tokens) with no employee/attendance/payroll concept. This module is additive and
follows existing conventions: `lib/db/schema.ts` single source of truth, Drizzle migrations via
`scripts/db-migrate.ts`, DAL in `lib/dal/*` (batched, no N+1, `Promise.all`), Server Actions
under `app/(app)/**/actions.ts`, custom UI in `components/`.

### Decisions locked during brainstorming
- **Employees = app users with a flag.** Any `users` row can be an employee via a 1:1
  `employee_profiles` row. Being an employee is a profile, not a role.
- **New `hr` role** manages the module and can override. Super-admin keeps god access.
- **Scanner file:** manual HR upload → parse → preview → commit. Parser is **format-agnostic**
  (pluggable), finalized against the real device export shared later.
- **Full payroll**, LOP driven by attendance + approved leave.
- **Build from opsy** as the reference for leave/attendance/salary; add the new LOP + late logic.

### Model calibrated to the current workbook (`Datagami Attendance 2026.xlsx`)
- **Roster** keyed by `DG###` code; some staff carry a **second code** (`TH###`, Theplahouse) —
  so an employee has one primary code plus optional alternate code(s); the biometric device may
  emit either. Profile fields seen: name, status, DOB, PAN, Aadhar, phone, email, emergency
  contacts (name/relation/number ×2).
- **Attendance is a per-day code grid.** Vocabulary from the sheet legend: blank = present in
  office, `WFH`, `LC` (late coming), `LE` (leaving early), `OV` (official visit), `CL`
  (compensatory leave); Sundays = weekly off, Saturdays = company-wide WFH. LC/LE are day
  *modifiers*; WFH/OV/CL/leave/off are day *types*.
- **Leave is monthly-accrual, not fixed quota:** annual entitlement (e.g. 18), monthly accrual
  (1.5/mo → 10.5 by July), carry-forward ("Last Year's"), used, unpaid time-off, and pending
  balance. Late-comings counted per employee ("6 Late Comings") and feed LOP.

### Defaults chosen (HR-overridable, flagged for later change)
- **Phasing:** one overall design (this doc), implemented in **4 phases** + a Phase 0 importer.
- **Leave accrual:** monthly accrual + carry-forward + unpaid tracking (matches the workbook);
  entitlement and accrual rate configurable per leave type / employee.
- **Late→LOP:** both mechanisms shipped as HR policy; default **3 lates = 1 LOP day**, optional
  per-day half-day-if-late-after-X-minutes. `LE` (early leaving) tracked, policy-configurable.
- **Raw file storage:** **Vercel Blob** (`@vercel/blob` + `BLOB_READ_WRITE_TOKEN`).
- **Leave/payroll year basis:** **calendar year** (independent of `academicYears`).
- **Weekly pattern default:** Sun = weekly off, Sat = WFH (per-employee overridable).

## 2. Non-goals (YAGNI)
- Self check-in / QR / geofencing. Attendance = scanner file or HR manual override only.
- Multi-level approval chains. Single approval step (HR / super-admin).
- Statutory payroll (PF/PT/ESI), payslip PDFs, bank ENET. Payroll → net-pay rows + xlsx export.
- Overtime pay (opsy lacks it too). Overtime can be a later add.
- Leave encashment. Carry-forward is modeled; encashment payout is out of scope.

## 3. Roles & authorization

`ROLES = ["super-admin", "admin", "viewer", "hr"]` (add `"hr"`).

`lib/dal/authz.ts`:
```ts
export function canManageHr(user: SessionUser): boolean {
  return user.role === "super-admin" || user.role === "hr";
}
```

| Capability | employee (self) | hr | super-admin | admin / viewer |
|---|---|---|---|---|
| Apply for own leave; view own attendance/payslip | ✓ (if employee) | ✓ | ✓ | ✓ (if employee) |
| Approve/reject leave, override attendance, run payroll, edit config, toggle employee | ✗ | ✓ | ✓ | ✗ |

"Am I an employee?" = an `employee_profiles` row exists for `users.id`. Self screens gate on
that; management screens gate on `canManageHr`. Mirrors opsy's role checks
(`opsy/src/app/api/leave-requests/route.ts`, `opsy/src/lib/access-control.ts`).

## 4. Data model

New enums → `lib/db/enums.ts`; tables → `lib/db/schema.ts`. Money as `numeric`, snake_case cols,
`serial` PKs.

### 4.1 Enums
```ts
export const EMPLOYEE_STATUSES = ["active", "inactive"] as const;
export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
// day type = mutually-exclusive nature of the day
export const ATTENDANCE_DAY_TYPES =
  ["office", "wfh", "official-visit", "comp-off",
   "paid-leave", "unpaid-leave", "weekly-off", "holiday", "absent"] as const;
export const ATTENDANCE_SOURCES = ["scanner", "manual", "import", "leave", "auto-off"] as const;
export const UPLOAD_STATUSES = ["parsed", "committed", "discarded"] as const;
export const PAYROLL_RUN_STATUSES = ["draft", "finalized"] as const;
export const LATE_LOP_MODES = ["late-count", "half-day-threshold"] as const;
export const LEAVE_ACCRUAL_MODES = ["annual", "monthly"] as const;
```
`role` enum gains `"hr"` via `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'hr'`.

### 4.2 Phase 1 — Foundation & config
```
employee_profiles
  id serial pk
  user_id int -> users.id (unique, on delete cascade)   // 1:1 flag = "is employee"
  employee_code text unique                              // "DG008" (roster code)
  alt_codes text[] default '{}'                          // e.g. {"TH095"} — Theplahouse code
  biometric_id text                                      // device ENROLLMENT number (int, e.g. "8") —
                                                         // distinct from DG/TH codes; how the scanner
                                                         // report identifies this person
  date_of_joining date
  monthly_salary numeric not null default '0'
  shift_id int -> shifts.id (nullable)
  weekly_off_day int default 0                           // 0=Sun
  wfh_day int default 6                                  // 6=Sat (company default)
  // HR profile fields seen in workbook
  dob date
  pan text
  aadhar text
  phone text
  emergency_contacts jsonb                               // [{name,relation,number}, ...]
  status employee_status not null default 'active'
  created_at timestamp default now()

shifts
  id serial pk
  name text not null                                     // "General 10-7"
  start_time time not null
  end_time time not null
  grace_minutes int not null default 0
  half_day_after_minutes int                             // late beyond => half day (nullable)
  early_leave_before_minutes int                         // out before => LE (nullable)
  full_day_minutes int not null default 480

holidays
  id serial pk
  date date not null unique
  name text not null

hr_settings                                              // single-row config (id always 1)
  id serial pk
  late_lop_mode late_lop_mode not null default 'late-count'
  lates_per_lop_day int not null default 3
  absent_is_lop boolean not null default true
  working_days_basis text not null default 'calendar-minus-offs'
  cycle_start_day int not null default 26                // attendance/payroll cycle runs 26th -> 25th
  updated_by_user_id int -> users.id
  updated_at timestamp default now()
```

### 4.3 Phase 2 — Leave (accrual model, matches Leave-26 sheet)
```
leave_types                                              // HR-configurable
  id serial pk
  name text not null                                     // Casual, Sick, Comp-off, Unpaid...
  code text not null unique                              // maps to grid codes (CL etc.)
  is_paid boolean not null default true
  accrual_mode leave_accrual_mode not null default 'monthly'
  annual_entitlement numeric not null default '0'        // "Total" (e.g. 18)
  monthly_accrual numeric not null default '0'           // e.g. 1.5
  active boolean not null default true

leave_balances                                           // per employee/type/calendar year
  id serial pk
  employee_id int -> employee_profiles.id (on delete cascade)
  leave_type_id int -> leave_types.id
  year int not null
  carried_forward numeric not null default '0'           // "Last Year's"
  accrued numeric not null default '0'                   // accrual-to-date
  used numeric not null default '0'
  unpaid_taken numeric not null default '0'              // "Unpaid TO"
  // balance (pending) = carried_forward + accrued - used   (derived, not stored)
  unique(employee_id, leave_type_id, year)

leave_requests
  id serial pk
  employee_id int -> employee_profiles.id (on delete cascade)
  leave_type_id int -> leave_types.id
  start_date date not null
  end_date date not null
  is_half_day boolean not null default false
  days numeric not null                                  // computed working days (skips off/holiday)
  reason text not null
  status leave_request_status not null default 'pending'
  reviewed_by_user_id int -> users.id
  reviewed_at timestamp
  review_note text
  created_at timestamp default now()
```
Approval debits `used` (or `unpaid_taken` for unpaid types) and writes `attendance_records`
(`paid-leave`/`unpaid-leave`). Reject/cancel restores. Accrual advanced by a monthly step
(cron or lazy top-up on read). Ports opsy `leave-requests` route + `leave-notifications.ts`.

### 4.4 Phase 3 — Attendance (day-type grid + late/early modifiers)
```
attendance_uploads
  id serial pk
  uploaded_by_user_id int -> users.id
  file_name text not null
  blob_url text                                          // Vercel Blob raw file
  period_start date
  period_end date
  row_count int, matched_count int, unmatched_count int
  status upload_status not null default 'parsed'
  created_at timestamp default now()

attendance_punches                                       // raw parsed rows (audit / re-collapse)
  id serial pk
  upload_id int -> attendance_uploads.id (on delete cascade)
  code text not null                                     // biometric/emp code as printed
  employee_id int -> employee_profiles.id                // null if unmatched
  punch_at timestamp not null
  raw text

attendance_records                                       // daily truth table, one per employee/day
  id serial pk
  employee_id int -> employee_profiles.id (on delete cascade)
  date date not null
  day_type attendance_day_type not null                  // office/wfh/official-visit/comp-off/
                                                         // paid-leave/unpaid-leave/weekly-off/holiday/absent
  is_late boolean not null default false                 // LC
  late_minutes int not null default 0
  is_early_leave boolean not null default false          // LE
  early_minutes int not null default 0
  first_in time
  last_out time
  worked_minutes int not null default 0
  lop_days numeric not null default '0'                  // 0 / 0.5 / 1 for this day
  source attendance_source not null
  note text
  overridden_by_user_id int -> users.id
  upload_id int -> attendance_uploads.id
  created_at timestamp default now()
  updated_at timestamp default now()
  unique(employee_id, date)
```

### 4.5 Phase 4 — Payroll
```
payroll_runs
  id serial pk
  month int not null                                     // 1-12
  year int not null
  status payroll_run_status not null default 'draft'
  generated_by_user_id int -> users.id
  created_at timestamp default now()
  finalized_at timestamp
  unique(month, year)

payslips
  id serial pk
  run_id int -> payroll_runs.id (on delete cascade)
  employee_id int -> employee_profiles.id
  base_salary numeric not null
  working_days numeric not null
  present_days numeric not null                          // office + wfh + official-visit + comp-off
  paid_leave_days numeric not null default '0'
  lop_days numeric not null default '0'                  // absent + unpaid leave + late-count LOP
  lop_amount numeric not null default '0'
  net_pay numeric not null
  breakdown jsonb                                        // itemized
  created_at timestamp default now()
  unique(run_id, employee_id)
```

## 5. Key flows

### 5.1 Flag a user as employee (HR)
HR opens a user → "Enable employee" → fills profile (code, alt codes, biometric id, DOJ,
salary, shift, weekly-off/WFH days, DOB/PAN/Aadhar/contacts). Creates `employee_profiles`.
Disabling sets status `inactive` (never hard-delete — preserve history).

### 5.2 Apply → approve leave
1. Employee picks type + range (+ half-day) → `leave_requests` (pending); client shows live
   remaining balance; server recomputes `days` (skips weekly-off/holiday).
2. HR queue → approve/reject with note. Approve: balance guard, debit `used`/`unpaid_taken`,
   upsert `attendance_records` (`paid-leave`/`unpaid-leave`). Reject/cancel restores.

### 5.3 Attendance upload (core new mechanism) — parser LOCKED to sample
Sample: `June Month Report.xls` = ZKTeco/eSSL **"Basic Work Duration Report"**, one sheet
`BasicWorkDurationReport`, already collapsed to daily rows. Layout:
- Row 0: month anchors as Excel date serials (col 0 = left segment month, col 8 = right segment
  month). Sample decodes to 2026-05-01 & 2026-06-01 → **cycle 26 May → 25 Jun**.
- Row 1: day headers `"26 T" … "25 Th"`; **one blank spacer column (col 7)** splits the two
  month segments. Map each column → full date via the two month anchors + day number.
- Per employee: a 6-row block — `Emp. Code:`+`Emp. Name:` header, then `Status`, `InTime`,
  `OutTime`, `Total` rows — separated by a blank row. `Emp. Code` = device **enrollment integer**
  (1..20), name sometimes junk (`Card`, `13`, `Id`).
- Cells: `Status ∈ {P, A, WO, ½P, WO½P}`; `InTime`/`OutTime` = `HH:MM` OR a text annotation
  spanning both cells: `WFH`, `Leave`, `Official Visit`, `Holiday`/`Id` (festival), `No Punch-in`,
  `HD`. `Total` = worked duration `H:MM`. The device **already** determines present/absent/
  half/off — we do NOT recompute status, we map it.

Flow:
```
HR selects scanner file
  → upload raw to Vercel Blob (blob_url)
  → pluggable parser (detect format) → normalized DAILY rows:
        { code, name, date, status, inTime?, outTime?, totalMinutes, annotation? }
  → match `code` against employee_profiles.biometric_id (then name as weak fallback); bucket unmatched
  → per (employee, date): map device status+annotation → day_type
        P→office, A→absent, WO→weekly-off, ½P/WO½P→half-day (lop 0.5),
        annotation WFH→wfh, Leave→paid/unpaid-leave, Official Visit→official-visit, Holiday/Id→holiday
     then DERIVE modifiers we care about (device doesn't flag them):
        is_late = inTime > shift.start + grace  → LC
        is_early_leave = outTime < shift.end - early_leave_before  → LE
        lop_days per policy
  → PREVIEW: month grid, LC/LE flags, UNMATCHED enrollment codes (HR maps to employees inline),
     totals (mirrors opsy attendance-verification)
  → HR commits → attendance_uploads(committed) + upsert attendance_records
```
**Pluggable parser:** `lib/dal/hr/parsers/` — `parse(buffer, fileName) -> NormalizedDay[]` with a
format registry. `basic-work-duration.ts` handles this `.xls` report (read via the `xlsx`/SheetJS
lib, which opens BIFF `.xls`). A future raw-punch export gets its own parser that collapses to the
same `NormalizedDay[]`. `attendance_punches` stays for formats that ARE punch-level; for this
already-daily report it's optional. Import never overwrites days already `paid-leave`/`holiday`/
`weekly-off` unless HR forces it. HR can override any cell → `source='manual'`,
`overridden_by_user_id` set. Ports opsy `attendance` route + `attendance-conflicts.ts`.

**Reconciliation reality (3 identifier layers):** device enrollment int (scanner) ≠ `DG###`
(roster) ≠ `TH###` (Theplahouse). HR sets each employee's `biometric_id` once; unmatched rows are
surfaced every upload for manual mapping. This is the crux of onboarding the scanner.

### 5.4 Late & loss-of-pay
Per day: `is_late` when `first_in > shift.start + grace`; `is_early_leave` when
`last_out < shift.end - early_leave_before`. Then per `hr_settings`:
- **late-count:** monthly `floor(lateCount / lates_per_lop_day)` LOP days (applied in payroll).
- **half-day-threshold:** `late_minutes > shift.half_day_after_minutes` → `lop_days=0.5`.
Absent (no punch, not leave/holiday/off) → `lop_days=1` when `absent_is_lop`.

### 5.5 Payroll run
Payroll period follows the **26th→25th cycle** (`hr_settings.cycle_start_day`), matching the
scanner report — e.g. "June" = 26 May → 25 Jun. `payroll_runs.month/year` label the cycle by its
end month. Per cycle: load active employees + cycle `attendance_records` + approved leave (batched,
no N+1). Compute `working_days`, `present_days`, `paid_leave_days`, `lop_days` (absent + unpaid
leave + late-count), `lop_amount = base/working_days × lop_days`, `net_pay`. Write
`payroll_runs` (draft) + `payslips`; HR reviews → finalize (lock); xlsx export. Ports opsy
`salary/generate` + `salary-calculator.ts` + `salary-create.ts` (drop PF/PT/ESI + overtime).

### 5.6 Phase 0 — Workbook importer (`Datagami Attendance 2026.xlsx`)
One-time (re-runnable) importer, HR-triggered, using the existing `xlsx` dep:
- **Employee Data** → upsert `users` (if needed) + `employee_profiles` (codes incl. `DG/TH`
  split, DOB, PAN, Aadhar, phone, email, emergency contacts, status).
- **Leave-26** → seed `leave_types` (Total/accrual) + `leave_balances` (carried_forward,
  accrued, used, unpaid_taken) + parse the free-text leave-date columns into `leave_requests`
  (approved) best-effort, flagging ambiguous ("Jan-Apr") rows for HR review.
- **Monthly sheets (Jan-26…Jul-26)** → per-cell code → `attendance_records` day_type
  (blank=office, WFH, OV=official-visit, CL=comp-off, LC/LE modifiers, Sun=weekly-off,
  Sat=wfh); `source='import'`. This is the pre-fingerprint history; scanner punches fill
  first_in/last_out going forward.

## 6. Surfaces (pages)

`app/(app)/hr/` (gated `canManageHr`) and `app/(app)/me/` (gated on profile). Mirrors opsy
`(auth)/attendance`, `(auth)/leave-requests`, `(auth)/salary`, `(auth)/hr/*`:
- `hr/employees` — roster; enable-employee + profile editor.
- `hr/leave` — approvals queue + all requests + balance ledger (accrual view).
- `hr/attendance` — upload + preview/commit; **month × employee code grid** with LC/LE/day-type
  cells; per-employee calendar; override; workbook import.
- `hr/payroll` — runs; generate/preview/finalize; payslip detail; xlsx export.
- `hr/settings` — leave types, shifts, holidays, late/LOP policy, weekly pattern.
- `me/leave`, `me/attendance`, `me/payslips` — self-service.

Server Component loads via DAL; mutations via `actions.ts` Server Actions (assert authz → DAL);
`loading.tsx` skeletons; sidebar gains "HR" (hr/super-admin) and "Me" (has profile) sections.

## 7. DAL layout
`lib/dal/hr/`: `employees.ts`, `leave.ts`, `attendance.ts`, `payroll.ts`, `config.ts`,
`import.ts`, `parsers/` (registry + `xlsx.ts`/`csv.ts`/`dat.ts`). `"server-only"`. Batch IDs →
one query; `Promise.all` independent reads; `canManageHr`/ownership before every mutation.
Optional `hr_activity_log` later (opsy `activity-log.ts` pattern) for override audit.

## 8. Migrations
One Drizzle migration per phase: edit `schema.ts` + `enums.ts` → `npx drizzle-kit generate` →
`npx tsx scripts/db-migrate.ts` → `vercel-build` on deploy. Idempotent enum create via
`DO $$ ... EXCEPTION WHEN duplicate_object ...`; value adds via `ALTER TYPE ... ADD VALUE IF NOT
EXISTS` (incl. adding `"hr"` to `role`).

## 9. Testing
- Parser per format (fixtures incl. real sample): malformed rows, dup punches, single-punch
  days, unmatched codes, dual DG/TH codes.
- Collapse: LC/LE/half-day/absent boundaries around grace + thresholds.
- Leave: accrual step, carry-forward, unpaid vs paid, half-day, working-day counting.
- Payroll: LOP math (absent, unpaid leave, late-count), per-day rate, mid-month joiner (DOJ).
- Importer: idempotency; workbook code grid → correct day_types; ambiguous leave-date flagging.
- Authz: employee blocked from management; admin/viewer blocked from HR.

## 10. Phase order & exit criteria
0. **Importer** — seed roster + leave ledger + historical months from the workbook.
1. **Foundation** — `hr` role, `employee_profiles`, shifts, holidays, settings, enable-employee UI.
2. **Leave** — types/balances (accrual)/requests, apply + approvals, ledger.
3. **Attendance** — Blob upload, pluggable parser, punch→daily collapse, preview/commit, LC/LE
   detection, override, month grid.
4. **Payroll** — runs/payslips, LOP computation, finalize + xlsx export.

Each phase independently shippable; later phases only read earlier tables. (Phase 0 can run
after Phase 1 tables exist; sequence 1 → 0 → 2 → 3 → 4 in practice.)

## 11. Open items to finalize per phase
- ~~Real scanner sample~~ **DONE** — parser locked to the ZKTeco "Basic Work Duration Report"
  (§5.3). Remaining: get one raw-punch export too, if the device can emit it, for a second parser.
- Populate every active employee's `biometric_id` (device enrollment int) — the join key for imports.
- Confirm working-days basis (calendar-minus-offs vs fixed 26/30) and the 26→25 cycle for payroll.
- Confirm accrual step timing (monthly cron vs lazy top-up) and whether comp-off (`CL`) is a
  leave type with its own accrual/grant rule.
- Decide how much of the workbook's free-text leave dates to auto-import vs leave to HR.
- Map device annotations to leave paid/unpaid (`Leave` token doesn't say which) — likely
  reconciled against approved `leave_requests` rather than trusted from the scanner.

---

## Appendix A — Claude-design UX prompt
Delivered alongside this doc; generates the mockup set (HR + self-service) using trackie's
Tailwind-v4 custom-token design system and the real code vocabulary (WFH/LC/LE/OV/CL, accrual
leave ledger, month × employee grid).
