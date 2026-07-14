"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import type { ProgramListRow } from "@/lib/dal/delivery/programs";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/db/enums";
import { PROGRAM_STATUS_META } from "./meta";
import { NewProgramDialog, type PickerOption } from "./new-program-dialog";

const selectCls =
  "h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function ProgramsExplorer({
  programs,
  methods,
  accounts,
  oems,
  canManage,
}: {
  programs: ProgramListRow[];
  methods: { id: number; name: string; code: string }[];
  accounts: PickerOption[];
  oems: { id: number; name: string; isSelf: boolean }[];
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("all");
  const [method, setMethod] = useState("all");
  const [status, setStatus] = useState<"all" | ProgramStatus>("all");
  const [adding, setAdding] = useState(false);

  const accountNames = useMemo(
    () => Array.from(new Set(programs.map((p) => p.accountName))).sort(),
    [programs],
  );
  const methodCodes = useMemo(
    () => Array.from(new Set(programs.map((p) => p.methodCode))).sort(),
    [programs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter((p) => {
      if (account !== "all" && p.accountName !== account) return false;
      if (method !== "all" && p.methodCode !== method) return false;
      if (status !== "all" && p.status !== status) return false;
      if (q) {
        const hay = `${p.name} ${p.accountName} ${p.oemName} ${p.methodName} ${p.methodCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [programs, search, account, method, status]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      active: filtered.filter((p) => p.status === "active").length,
      allocated: filtered.reduce((s, p) => s + p.allocated, 0),
      spent: filtered.reduce((s, p) => s + p.spent, 0),
    }),
    [filtered],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">Programs</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            What the delivery team is running per account — teaching style, provider, events and budgets.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            + New program
          </button>
        )}
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <span><span className="tabular text-[17px] font-extrabold">{totals.count}</span> <span className="text-text-muted">programs</span></span>
        <span><span className="tabular text-[17px] font-extrabold" style={{ color: "var(--positive-text)" }}>{totals.active}</span> <span className="text-text-muted">active</span></span>
        <span className="text-text-muted">Allocated <Money value={totals.allocated} className="text-[15px] font-bold" /></span>
        <span className="text-text-muted">Spent <Money value={totals.spent} className="text-[15px] font-bold" tone={totals.spent > totals.allocated ? "negative" : "default"} /></span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="pg-search">Search programs</label>
        <input
          id="pg-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search programs…"
          className="h-9 w-48 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <select className={selectCls} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Filter by account">
          <option value="all">All accounts</option>
          {accountNames.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Filter by teaching style">
          <option value="all">All styles</option>
          {methodCodes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as "all" | ProgramStatus)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {PROGRAM_STATUSES.map((s) => <option key={s} value={s}>{PROGRAM_STATUS_META[s].label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2.5 font-semibold">Program</th>
              <th className="px-4 py-2.5 font-semibold">Account</th>
              <th className="px-4 py-2.5 font-semibold">Style</th>
              <th className="px-4 py-2.5 font-semibold">Provider</th>
              <th className="px-4 py-2.5 font-semibold">Period</th>
              <th className="px-4 py-2.5 text-right font-semibold">Events</th>
              <th className="px-4 py-2.5 text-right font-semibold">Budget · Spent</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-text-muted">
                  {programs.length === 0 ? "No programs yet — create the first one." : "No programs match the filters."}
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const meta = PROGRAM_STATUS_META[p.status];
                const over = p.spent > p.allocated;
                return (
                  <tr key={p.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3">
                      <Link href={`/delivery/programs/${p.id}`} className="font-semibold text-text-primary hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{p.accountName}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--primary-text)]" title={p.methodName}>
                        {p.methodCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {p.oemName}
                      {p.selfSupplied && <span className="ml-1.5 text-[11px] text-text-muted">(own)</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {p.startDate || p.endDate ? `${fmtShort(p.startDate)} → ${fmtShort(p.endDate)}` : "—"}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{p.eventCount}</td>
                    <td className="px-4 py-3 text-right">
                      <Money value={p.allocated} compact />
                      <span className="mx-1 text-text-muted">·</span>
                      <Money value={p.spent} compact tone={over ? "negative" : "default"} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: meta.bg, color: meta.text, borderColor: meta.border }}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <NewProgramDialog
          accounts={accounts}
          oems={oems}
          methods={methods}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function fmtShort(iso: string | null): string {
  if (!iso) return "…";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}
