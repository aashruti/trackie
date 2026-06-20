"use client";

import { useState, useTransition } from "react";
import { computeInvoice } from "@/lib/money/compute";
import { Money } from "@/components/ui/money";
import type { Category, Semester, Status } from "@/lib/money/types";
import { createInvoiceAction } from "@/app/(app)/accounts/[id]/actions";

const INVOICE_STATUSES: { value: Status; label: string }[] = [
  { value: "raised", label: "Raised" },
  { value: "draft", label: "Draft" },
  { value: "partially-paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "advance", label: "Advance bill" },
  { value: "old", label: "Old students" },
  { value: "new", label: "New students" },
];
const SEMESTERS: { value: Semester; label: string }[] = [
  { value: "none", label: "Yearly (no split)" },
  { value: "1", label: "1st semester" },
  { value: "2", label: "2nd semester" },
];

export function AddInvoice({
  accountId,
  yearLabel,
  selfSupplied,
}: {
  accountId: number;
  yearLabel: string;
  selfSupplied: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("new");
  const [semester, setSemester] = useState<Semester>("none");
  const [students, setStudents] = useState(0);
  const [priceToUni, setPriceToUni] = useState(0);
  const [priceToDatagami, setPriceToDatagami] = useState(0);
  const [gstPct, setGstPct] = useState(18);
  const [tdsPct, setTdsPct] = useState(10);
  const [advanceAdj, setAdvanceAdj] = useState(0);
  const [status, setStatus] = useState<Status>("raised");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isAdvance = category === "advance";
  // For an advance, the single "Advance amount" funds both the bill to the uni
  // and the transfer to the OEM (own-product advances have no OEM transfer → 0).
  const effPriceToDatagami = isAdvance ? (selfSupplied ? 0 : priceToUni) : priceToDatagami;
  const c = computeInvoice({
    category,
    semester,
    students: isAdvance ? 1 : students,
    priceToUni,
    priceToDatagami: effPriceToDatagami,
    gstRate: gstPct / 100,
    tdsRate: tdsPct / 100,
    advanceAdj,
    selfSupplied,
  });

  const inputCls =
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  function reset() {
    setStudents(0);
    setPriceToUni(0);
    setPriceToDatagami(0);
    setAdvanceAdj(0);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await createInvoiceAction(accountId, yearLabel, {
          category,
          semester,
          students: isAdvance ? 1 : students,
          priceToUni,
          priceToDatagami: effPriceToDatagami,
          gstRate: gstPct / 100,
          tdsRate: tdsPct / 100,
          advanceAdj: isAdvance ? 0 : advanceAdj,
          status,
        });
        reset();
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add invoice");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
      >
        + Add invoice
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--primary-border)] bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Add invoice · {yearLabel}</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={inputCls}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Semester</span>
          <select value={semester} onChange={(e) => setSemester(e.target.value as Semester)} className={inputCls}>
            {SEMESTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {!isAdvance && (
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Students</span>
            <input type="number" value={students || ""} onChange={(e) => setStudents(parseInt(e.target.value, 10) || 0)} className={`tabular ${inputCls}`} />
          </label>
        )}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{isAdvance ? "Advance amount ₹" : "Price / uni ₹"}</span>
          <input type="number" value={priceToUni || ""} onChange={(e) => setPriceToUni(parseFloat(e.target.value) || 0)} className={`tabular ${inputCls}`} />
        </label>
        {!isAdvance && (
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{selfSupplied ? "Internal cost ₹" : "Price / Datagami ₹"}</span>
            <input type="number" value={priceToDatagami || ""} onChange={(e) => setPriceToDatagami(parseFloat(e.target.value) || 0)} className={`tabular ${inputCls}`} />
          </label>
        )}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">GST %</span>
          <input type="number" value={gstPct} onChange={(e) => setGstPct(parseFloat(e.target.value) || 0)} className={`tabular ${inputCls}`} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">TDS %</span>
          <input type="number" value={tdsPct} onChange={(e) => setTdsPct(parseFloat(e.target.value) || 0)} className={`tabular ${inputCls}`} />
        </label>
        {!isAdvance && !selfSupplied && (
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Advance adj ₹</span>
            <input type="number" value={advanceAdj || ""} onChange={(e) => setAdvanceAdj(parseFloat(e.target.value) || 0)} className={`tabular ${inputCls}`} />
          </label>
        )}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inputCls}>
            {INVOICE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-sunken px-4 py-3 text-sm">
        <span className="text-text-secondary">Preview</span>
        <div className="flex items-center gap-5">
          <span>Billing <Money value={c.billing} compact /></span>
          {!selfSupplied && <span>Payable <Money value={c.payable} compact tone="info" /></span>}
          <span className="font-semibold">Margin <Money value={c.netMargin} compact tone="auto" /></span>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-[var(--negative-text)]">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button onClick={save} disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Adding…" : "Add invoice"}
        </button>
      </div>
    </div>
  );
}
