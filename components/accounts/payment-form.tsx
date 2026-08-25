"use client";

import { useState, useTransition } from "react";
import {
  recordPaymentAction,
  updatePaymentAction,
} from "@/app/(app)/accounts/[id]/actions";
import { MODES } from "@/lib/db/enums";
import type { Direction, Mode, PaymentEntry } from "@/lib/dal/payments";

export function PaymentForm({
  accountId,
  invoiceId,
  direction,
  payment,
  onClose,
}: {
  accountId: number;
  invoiceId: number;
  direction: Direction;
  payment?: PaymentEntry;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(payment?.amount ?? 0);
  const [paidOn, setPaidOn] = useState(payment?.paidOn ?? "");
  const [mode, setMode] = useState<Mode>(payment?.mode ?? "RTGS");
  const [ref, setRef] = useState(payment?.ref ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isReceipt = direction === "receipt";
  const inputCls =
    "rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  function save() {
    setError(null);
    if (amount <= 0 || !paidOn) {
      setError("Enter an amount and date.");
      return;
    }
    startTransition(async () => {
      try {
        if (payment) {
          const result = await updatePaymentAction(accountId, payment.id, {
            amount,
            paidOn,
            mode,
            ref,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
        } else {
          const result = await recordPaymentAction(accountId, invoiceId, {
            direction,
            amount,
            paidOn,
            mode,
            ref,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
        }
        onClose();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : payment
              ? "Failed to update payment"
              : "Failed to record payment",
        );
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--primary-border)] bg-surface-sunken p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {payment
          ? `Edit ${isReceipt ? "receipt" : "OEM payment"}`
          : isReceipt
            ? "Record receipt · University → Datagami"
            : "Pay OEM · Datagami → OEM"}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] text-text-muted">Amount (₹)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            autoFocus
            value={amount || ""}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            className={`tabular mt-1 block w-36 ${inputCls}`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-muted">Date</span>
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className={`mt-1 block ${inputCls}`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-text-muted">Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={`mt-1 block ${inputCls}`}>
            {MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-[11px] text-text-muted">Reference / UTR</span>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="UTR / cheque no."
            className={`mt-1 block w-full ${inputCls}`}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--negative-text)]">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? "Saving…"
            : payment
              ? "Save changes"
              : isReceipt
                ? "Add receipt"
                : "Add OEM payment"}
        </button>
      </div>
    </div>
  );
}
