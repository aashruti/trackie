"use client";

import { useState, useTransition } from "react";
import { computeInvoice } from "@/lib/money/compute";
import { Money } from "@/components/ui/money";
import type { Category, Semester, Status } from "@/lib/money/types";
import { updateInvoiceAction } from "@/app/(app)/accounts/[id]/actions";

const STATUSES: Status[] = ["draft", "raised", "partially-paid", "paid", "overdue"];

interface Props {
  accountId: number;
  invoiceId: number;
  category: Category;
  semester: Semester;
  initial: {
    students: number;
    priceToUni: number;
    priceToDatagami: number;
    gstRate: number;
    tdsRate: number;
    advanceAdj: number;
    status: Status;
  };
  onClose: () => void;
}

function Field({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="mt-1 flex items-center rounded-md border border-border-strong bg-surface px-2 focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="tabular w-full bg-transparent py-1.5 text-sm text-text-primary outline-none"
        />
        {suffix && <span className="text-xs text-text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export function InvoiceEditor({ accountId, invoiceId, category, semester, initial, onClose }: Props) {
  const [students, setStudents] = useState(initial.students);
  const [priceToUni, setPriceToUni] = useState(initial.priceToUni);
  const [priceToDatagami, setPriceToDatagami] = useState(initial.priceToDatagami);
  const [gstPct, setGstPct] = useState(initial.gstRate * 100);
  const [tdsPct, setTdsPct] = useState(initial.tdsRate * 100);
  const [advanceAdj, setAdvanceAdj] = useState(initial.advanceAdj);
  const [status, setStatus] = useState<Status>(initial.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const c = computeInvoice({
    category,
    semester,
    students,
    priceToUni,
    priceToDatagami,
    gstRate: gstPct / 100,
    tdsRate: tdsPct / 100,
    advanceAdj,
  });

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateInvoiceAction(accountId, invoiceId, {
          students,
          priceToUni,
          priceToDatagami,
          gstRate: gstPct / 100,
          tdsRate: tdsPct / 100,
          advanceAdj,
          status,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="rounded-xl border border-[var(--primary-border)] bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Edit invoice</h3>
        <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {category !== "advance" && (
          <Field label="Students" value={students} onChange={setStudents} />
        )}
        <Field label="Price / uni" value={priceToUni} onChange={setPriceToUni} suffix="₹" />
        <Field label="Price / Datagami" value={priceToDatagami} onChange={setPriceToDatagami} suffix="₹" />
        <Field label="GST" value={gstPct} onChange={setGstPct} suffix="%" />
        <Field label="TDS" value={tdsPct} onChange={setTdsPct} suffix="%" />
        <Field label="Advance adj" value={advanceAdj} onChange={setAdvanceAdj} suffix="₹" />
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-sunken px-4 py-3 text-sm">
        <span className="text-text-secondary">Live recompute</span>
        <div className="flex items-center gap-5">
          <span>After-TDS <Money value={c.afterTds} compact /></span>
          <span>Payable <Money value={c.payable} compact tone="info" /></span>
          <span className="font-semibold">Margin <Money value={c.netMargin} compact tone="auto" /></span>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-[var(--negative-text)]">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
