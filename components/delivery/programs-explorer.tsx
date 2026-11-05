"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import type { ProgramListRow } from "@/lib/dal/delivery/programs";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/db/enums";
import type { PaymentStatus } from "@/lib/delivery/po-status";
import { PAYMENT_STATUS_META, PROGRAM_STATUS_META } from "./meta";
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
  const [payStatus, setPayStatus] = useState<"all" | PaymentStatus>("all");
  const [vendor, setVendor] = useState("all");
  const [adding, setAdding] = useState(false);

  const accountNames = useMemo(
    () => Array.from(new Set(programs.map((p) => p.accountName))).sort(),
    [programs],
  );
  const methodCodes = useMemo(
    () => Array.from(new Set(programs.map((p) => p.methodCode))).sort(),
    [programs],
  );

  const vendorNames = useMemo(
    () =>
      Array.from(
        new Set(programs.map((p) => p.vendor?.trim() ?? "").filter((v) => v !== "")),
      ).sort(),
    [programs],
  );
  const payStatuses = useMemo(() => {
    const present = new Set(programs.map((p) => p.po.status));
    return (Object.keys(PAYMENT_STATUS_META) as PaymentStatus[]).filter((s) => present.has(s));
  }, [programs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter((p) => {
      if (account !== "all" && p.accountName !== account) return false;
      if (method !== "all" && p.methodCode !== method) return false;
      if (status !== "all" && p.status !== status) return false;
      if (payStatus !== "all" && p.po.status !== payStatus) return false;
      if (vendor !== "all" && (p.vendor?.trim() ?? "") !== vendor) return false;
      if (q) {
        const hay = `${p.name} ${p.accountName} ${p.oemName} ${p.methodName} ${p.methodCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [programs, search, account, method, status, payStatus, vendor]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      active: filtered.filter((p) => p.status === "active").length,
      allocated: filtered.reduce((s, p) => s + p.allocated, 0),
      spent: filtered.reduce((s, p) => s + p.spent, 0),
      due: filtered.reduce((s, p) => s + (p.po.due ?? 0), 0),
      received: filtered.reduce((s, p) => s + p.po.settled, 0),
      outstanding: filtered.reduce((s, p) => s + (p.po.due === null ? 0 : p.po.outstanding), 0),
    }),
    [filtered],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">POs</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            What the delivery team is running per account — teaching style, provider, events and budgets.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            + New PO
          </button>
        )}
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <span><span className="tabular text-[17px] font-extrabold">{totals.count}</span> <span className="text-text-muted">POs</span></span>
        <span><span className="tabular text-[17px] font-extrabold" style={{ color: "var(--positive-text)" }}>{totals.active}</span> <span className="text-text-muted">active</span></span>
        <span className="text-text-muted">Allocated <Money value={totals.allocated} className="text-[15px] font-bold" /></span>
        <span className="text-text-muted">Spent <Money value={totals.spent} className="text-[15px] font-bold" tone={totals.spent > totals.allocated ? "negative" : "default"} /></span>
        <span className="text-text-muted">Amount due <Money value={totals.due} className="text-[15px] font-bold" /></span>
        <span className="text-text-muted">Received <Money value={totals.received} className="text-[15px] font-bold" /></span>
        <span className="text-text-muted">Outstanding <Money value={totals.outstanding} className="text-[15px] font-bold" /></span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="pg-search">Search POs</label>
        <input
          id="pg-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search POs…"
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
        <select className={selectCls} value={payStatus} onChange={(e) => setPayStatus(e.target.value as "all" | PaymentStatus)} aria-label="Filter by payment status">
          <option value="all">All payment statuses</option>
          {payStatuses.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_META[s].label}</option>)}
        </select>
        <select className={selectCls} value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Filter by vendor">
          <option value="all">All vendors</option>
          {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[1400px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2.5 font-semibold">PO</th>
              <th className="px-4 py-2.5 font-semibold">Account</th>
              <th className="px-4 py-2.5 font-semibold">Style</th>
              <th className="px-4 py-2.5 font-semibold">Provider</th>
              <th className="px-4 py-2.5 font-semibold">Period</th>
              <th className="px-4 py-2.5 text-right font-semibold">Events</th>
              <th className="px-4 py-2.5 text-right font-semibold">Budget · Spent</th>
              <th className="px-4 py-2.5 font-semibold">PO number</th>
              <th className="px-4 py-2.5 font-semibold">Vendor</th>
              <th className="px-4 py-2.5 font-semibold">Payment</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-sm text-text-muted">
                  {programs.length === 0 ? "No programs yet — create the first one." : "No programs match the filters."}
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const meta = PROGRAM_STATUS_META[p.status];
                const over = p.spent > p.allocated;
                const payMeta = PAYMENT_STATUS_META[p.po.status];
                const vendorName = p.vendor?.trim() ?? "";
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
                      <Money value={p.allocated} />
                      <span className="mx-1 text-text-muted">·</span>
                      <Money value={p.spent} tone={over ? "negative" : "default"} />
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{p.poNumber?.trim() || "—"}</td>
                    <td className="px-4 py-3 text-text-secondary">{vendorName || "—"}</td>
                    <td className="px-4 py-3">
                      {p.po.due === null && p.po.settled === 0 ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="whitespace-nowrap">
                            <Money value={p.po.settled} />
                            {p.po.due !== null && (
                              <>
                                <span className="mx-1 text-text-muted">/</span>
                                <Money value={p.po.due} />
                              </>
                            )}
                          </span>
                          <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: payMeta.bg, color: payMeta.text, borderColor: payMeta.border }}>
                            {payMeta.label}
                          </span>
                        </div>
                      )}
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
