"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Money } from "@/components/ui/money";
import type { ProgramPayment } from "@/lib/dal/delivery/po";
import { DEFAULT_GST_RATE, parseMoneyInput } from "@/lib/delivery/po-status";
import { moveToNewPoAction } from "@/app/(app)/delivery/programs/[id]/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Split the selected events (and any ticked payments) into a brand-new PO. */
export function MoveToNewPoDialog({
  sourceId,
  eventIds,
  payments,
  vendors,
  onClose,
}: {
  sourceId: number;
  eventIds: number[];
  payments: ProgramPayment[];
  /** Active vendors only: a new PO can't use a deactivated one. */
  vendors: { id: number; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [poValue, setPoValue] = useState("");
  const [gstRate, setGstRate] = useState(String(DEFAULT_GST_RATE));
  const [paymentIds, setPaymentIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    if (!name.trim()) { setError("Give the new PO a name."); return; }
    const value = parseMoneyInput(poValue);
    if (value !== null && Number.isNaN(value)) { setError("PO value must be a number, for example 1,000,000."); return; }
    if (value !== null && value <= 0) { setError("PO value must be above zero, or left blank."); return; }
    const gst = parseMoneyInput(gstRate);
    if (gst !== null && Number.isNaN(gst)) { setError("GST rate must be a number, for example 18."); return; }
    if (gst !== null && gst > 100) { setError("GST rate must be between 0 and 100."); return; }
    startTransition(async () => {
      const res = await moveToNewPoAction(sourceId, {
        name: name.trim(),
        eventIds,
        paymentIds,
        poNumber: poNumber.trim() || null,
        poDate: poDate || null,
        poValue: value,
        gstRate: gst ?? DEFAULT_GST_RATE,
        vendorId: vendorId ? Number(vendorId) : null,
      });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/delivery/programs/${res.id}`);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-po-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="move-po-title" className="text-base font-bold tracking-tight text-text-primary">
            Move {eventIds.length} event{eventIds.length === 1 ? "" : "s"} to a new PO
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

        <div className="space-y-3 px-5 py-4">
          <p className="rounded-md border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-3 py-2 text-xs text-[var(--pending-text)]">
            This cannot be undone. The source PO keeps its PO number, value, documents and dates as they are, so review
            them after the move.
          </p>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">New PO name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">PO number <span className="font-normal">(optional)</span></span>
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">PO date <span className="font-normal">(optional)</span></span>
              <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">PO value ₹ before GST</span>
              <input value={poValue} onChange={(e) => setPoValue(e.target.value)} inputMode="decimal" className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">GST rate %</span>
              <input value={gstRate} onChange={(e) => setGstRate(e.target.value)} inputMode="decimal" className={fieldCls} />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Vendor <span className="font-normal">(optional)</span></span>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={fieldCls}>
              <option value="">No vendor</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>

          {payments.length > 0 && (
            <fieldset className="rounded-md border border-border p-3">
              <legend className="px-1 text-[11px] font-medium text-text-muted">
                Payments that belong to the new PO <span className="font-normal">(moved with their proofs)</span>
              </legend>
              <ul className="space-y-1.5">
                {payments.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={paymentIds.includes(p.id)}
                        onChange={(e) =>
                          setPaymentIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((i) => i !== p.id)))
                        }
                      />
                      <span className="tabular text-xs text-text-muted">{fmtDate(p.receivedDate)}</span>
                      <Money value={p.amount} className="font-semibold" />
                      {p.reference && <span className="text-xs text-text-muted">Ref {p.reference}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
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
            {pending ? "Moving…" : "Create PO and move events"}
          </button>
        </div>
      </div>
    </div>
  );
}
