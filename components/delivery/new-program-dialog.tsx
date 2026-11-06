"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgramAction } from "@/app/(app)/delivery/programs/actions";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/db/enums";
import { PROGRAM_STATUS_META } from "./meta";
import { Combobox } from "@/components/ui/combobox";
import { DEFAULT_GST_RATE, parseMoneyInput } from "@/lib/delivery/po-status";

export type PickerOption = { id: number; name: string };

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function NewProgramDialog({
  accounts,
  oems,
  methods,
  vendors,
  onClose,
}: {
  accounts: PickerOption[];
  oems: { id: number; name: string; isSelf: boolean }[];
  methods: { id: number; name: string; code: string }[];
  /** Active vendors only. */
  vendors: PickerOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [oemId, setOemId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [status, setStatus] = useState<ProgramStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [description, setDescription] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [poValue, setPoValue] = useState("");
  const [gstRate, setGstRate] = useState(String(DEFAULT_GST_RATE));
  const [vendorId, setVendorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The PO name input autofocuses; only fall back to the panel if nothing inside it has focus.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    if (!name.trim()) { setError("Give the PO a name."); return; }
    if (!accountId) { setError("Pick the account this PO runs under."); return; }
    if (!oemId) { setError("Pick the provider (IBM, Datagami, …)."); return; }
    if (!methodId) { setError("Pick a teaching style."); return; }
    const value = parseMoneyInput(poValue);
    if (value !== null && Number.isNaN(value)) { setError("PO value must be a number, for example 1,000,000."); return; }
    if (value !== null && value <= 0) { setError("PO value must be above zero, or left blank."); return; }
    const gst = parseMoneyInput(gstRate);
    if (gst !== null && Number.isNaN(gst)) { setError("GST rate must be a number, for example 18."); return; }
    if (gst !== null && gst > 100) { setError("GST rate must be between 0 and 100."); return; }
    startTransition(async () => {
      const res = await createProgramAction({
        name: name.trim(),
        accountId: Number(accountId),
        oemId: Number(oemId),
        deliveryMethodId: Number(methodId),
        status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        totalBudget: totalBudget === "" ? null : Number(totalBudget),
        description: description.trim() || undefined,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        poValue: value,
        // Blank means the default; a typed 0 stays 0.
        gstRate: gst ?? DEFAULT_GST_RATE,
        vendorId: vendorId ? Number(vendorId) : null,
      });
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.push(`/delivery/programs/${res.id}`);
    });
  }

  return (
    // Full-height panel sliding in from the right; the POs list stays visible (dimmed) beside it.
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-program-title"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[880px] flex-col border-l border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="new-program-title" className="text-base font-bold tracking-tight text-text-primary">
            New PO
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-muted hover:bg-surface-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-medium text-text-muted">PO name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. IBM D2S FY26–27"
                className={fieldCls}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as ProgramStatus)} className={fieldCls}>
                {PROGRAM_STATUSES.map((s) => (
                  <option key={s} value={s}>{PROGRAM_STATUS_META[s].label}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="text-[11px] font-medium text-text-muted">Account</span>
              <Combobox
                options={accounts}
                value={accountId}
                onChange={setAccountId}
                placeholder="Search accounts…"
              />
            </div>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Provider</span>
              <select value={oemId} onChange={(e) => setOemId(e.target.value)} className={fieldCls}>
                <option value="">Pick provider…</option>
                {oems.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.isSelf ? " (own)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Teaching style</span>
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={fieldCls}>
                <option value="">Pick style…</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Budget envelope ₹ <span className="font-normal">(optional)</span></span>
              <input
                type="number"
                min="0"
                value={totalBudget}
                onChange={(e) => setTotalBudget(e.target.value)}
                placeholder="Overall envelope"
                className={fieldCls}
              />
            </label>
          </div>

          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-[11px] font-medium text-text-muted">
              Purchase order <span className="font-normal">(optional, can be added later)</span>
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">PO number</span>
                <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={80} className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">PO date</span>
                <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">Vendor</span>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={fieldCls}>
                  <option value="">No vendor</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">PO value ₹ before GST</span>
                <input value={poValue} onChange={(e) => setPoValue(e.target.value)} inputMode="decimal" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-text-muted">GST rate % <span className="font-normal">(blank = {DEFAULT_GST_RATE})</span></span>
                <input value={gstRate} onChange={(e) => setGstRate(e.target.value)} inputMode="decimal" className={fieldCls} />
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Description <span className="font-normal">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Scope, cohort, anything the team should know"
              className={fieldCls}
            />
          </label>

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}
