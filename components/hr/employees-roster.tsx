"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import type { RosterRow, ShiftRow, CandidateUser, EmployeeInput } from "@/lib/dal/hr/employees";
import {
  enableEmployeeAction,
  updateEmployeeAction,
  setEmployeeStatusAction,
} from "@/app/(app)/hr/employees/actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

type DrawerState =
  | { mode: "add" }
  | { mode: "edit"; row: RosterRow }
  | null;

export function EmployeesRoster({
  employees,
  shifts,
  candidates,
}: {
  employees: RosterRow[];
  shifts: ShiftRow[];
  candidates: CandidateUser[];
}) {
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<DrawerState>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.altCodes.some((c) => c.toLowerCase().includes(q)) ||
        (e.biometricId ?? "").toLowerCase().includes(q),
    );
  }, [employees, query]);

  const activeCount = employees.filter((e) => e.status === "active").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-text-primary">Employees</h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            Roster · {employees.length} {employees.length === 1 ? "person" : "people"}
            {activeCount !== employees.length && ` · ${activeCount} active`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or code…"
              className="w-48 bg-transparent text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
          <button
            onClick={() => setDrawer({ mode: "add" })}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3.5 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add person
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3">Roster code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Alt code</th>
              <th className="px-4 py-3 text-right">Bio #</th>
              <th className="px-4 py-3">Shift</th>
              <th className="px-4 py-3 text-right">Monthly salary</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-text-muted">
                  {employees.length === 0
                    ? "No employees yet. Add a person to get started."
                    : "No matches."}
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr
                key={e.employeeId}
                onClick={() => setDrawer({ mode: "edit", row: e })}
                className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-surface-hover"
              >
                <td className="px-4 py-3 font-semibold text-text-primary">{e.employeeCode}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--primary-subtle)] text-[10px] font-bold text-[var(--primary-text)]">
                      {initials(e.name)}
                    </span>
                    <span className="truncate text-text-primary">{e.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-secondary">{e.altCodes.join(", ") || "—"}</td>
                <td className="px-4 py-3 text-right tabular text-text-secondary">{e.biometricId ?? "—"}</td>
                <td className="px-4 py-3 text-text-secondary">{e.shiftName ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Money value={e.monthlySalary} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Badge tone={e.status === "active" ? "positive" : "neutral"}>
                    {e.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer && (
        <ProfileDrawer
          state={drawer}
          shifts={shifts}
          candidates={candidates}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-subtle)]";

function ProfileDrawer({
  state,
  shifts,
  candidates,
  onClose,
}: {
  state: Exclude<DrawerState, null>;
  shifts: ShiftRow[];
  candidates: CandidateUser[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = state.mode === "edit";
  const row = isEdit ? state.row : null;

  const [userId, setUserId] = useState<number | "">(candidates[0]?.id ?? "");
  const [employeeCode, setEmployeeCode] = useState(row?.employeeCode ?? "");
  const [altCodes, setAltCodes] = useState((row?.altCodes ?? []).join(", "));
  const [biometricId, setBiometricId] = useState(row?.biometricId ?? "");
  const [monthlySalary, setMonthlySalary] = useState(String(row?.monthlySalary ?? ""));
  const [shiftId, setShiftId] = useState<number | "">(row?.shiftId ?? "");
  const [dateOfJoining, setDateOfJoining] = useState(row?.dateOfJoining ?? "");
  const [weeklyOffDay, setWeeklyOffDay] = useState(0);
  const [wfhDay, setWfhDay] = useState<number | "">(6);
  const [phone, setPhone] = useState("");
  const [pan, setPan] = useState("");
  const [aadhar, setAadhar] = useState("");

  function submit() {
    setError(null);
    if (!employeeCode.trim()) {
      setError("Roster code is required.");
      return;
    }
    if (!isEdit && userId === "") {
      setError("Pick a user to enable.");
      return;
    }
    const input: EmployeeInput = {
      employeeCode: employeeCode.trim(),
      altCodes: altCodes.split(",").map((s) => s.trim()).filter(Boolean),
      biometricId: biometricId.trim() || null,
      monthlySalary: Number(monthlySalary) || 0,
      shiftId: shiftId === "" ? null : Number(shiftId),
      dateOfJoining: dateOfJoining || null,
      weeklyOffDay: Number(weeklyOffDay),
      wfhDay: wfhDay === "" ? null : Number(wfhDay),
      phone: phone.trim() || null,
      pan: pan.trim() || null,
      aadhar: aadhar.trim() || null,
    };
    startTransition(async () => {
      try {
        const res = isEdit
          ? await updateEmployeeAction(row!.employeeId, input)
          : await enableEmployeeAction(Number(userId), input);
        if (res && !res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function toggleStatus() {
    if (!row) return;
    startTransition(async () => {
      try {
        const res = await setEmployeeStatusAction(
          row.employeeId,
          row.status === "active" ? "inactive" : "active",
        );
        if (res && !res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              {isEdit ? "Edit employee" : "Enable as employee"}
            </div>
            <div className="text-base font-semibold text-text-primary">
              {isEdit ? row!.name : "New employee"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {!isEdit && (
            <Field label="App user" hint="Only users without an employee profile are listed.">
              {candidates.length === 0 ? (
                <p className="text-sm text-text-muted">
                  Every user is already an employee. Create a user first in Admin.
                </p>
              ) : (
                <select
                  value={userId}
                  onChange={(e) => setUserId(Number(e.target.value))}
                  className={inputCls}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.email}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Roster code">
              <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="DG001" className={inputCls} />
            </Field>
            <Field label="Biometric #" hint="Device enrollment number">
              <input value={biometricId} onChange={(e) => setBiometricId(e.target.value)} placeholder="8" className={inputCls} />
            </Field>
          </div>

          <Field label="Alternate codes" hint="Comma-separated, e.g. TH095">
            <input value={altCodes} onChange={(e) => setAltCodes(e.target.value)} placeholder="TH095" className={inputCls} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Monthly salary (₹)">
              <input value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} inputMode="numeric" placeholder="65000" className={`${inputCls} tabular`} />
            </Field>
            <Field label="Shift">
              <select value={shiftId} onChange={(e) => setShiftId(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
                <option value="">—</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Date of joining">
              <input type="date" value={dateOfJoining ?? ""} onChange={(e) => setDateOfJoining(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Weekly off">
              <select value={weeklyOffDay} onChange={(e) => setWeeklyOffDay(Number(e.target.value))} className={inputCls}>
                {DAYS.map((d, i) => (<option key={d} value={i}>{d}</option>))}
              </select>
            </Field>
            <Field label="WFH day">
              <select value={wfhDay} onChange={(e) => setWfhDay(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls}>
                <option value="">None</option>
                {DAYS.map((d, i) => (<option key={d} value={i}>{d}</option>))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="PAN">
              <input value={pan} onChange={(e) => setPan(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Aadhaar">
              <input value={aadhar} onChange={(e) => setAadhar(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Phone">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </Field>
          </div>

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          {isEdit && (
            <button
              onClick={toggleStatus}
              disabled={pending}
              className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {row!.status === "active" ? "Deactivate" : "Activate"}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={pending || (!isEdit && candidates.length === 0)}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {pending ? "Saving…" : isEdit ? "Save changes" : "Enable employee"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
