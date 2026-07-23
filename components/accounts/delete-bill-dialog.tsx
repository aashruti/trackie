"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Money } from "@/components/ui/money";
import { deleteBillAction } from "@/app/(app)/accounts/[id]/actions";
import type { BillDeletionPreview } from "@/lib/dal/account-admin";
import { fmtDay } from "@/lib/dates";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Confirmation for the super-admin bill delete (spec §8). The preview is
 * fetched by the caller and passed in, so the whole cascade — every payment
 * entry, the per-direction totals, the cohort rows — is itemised *before* the
 * destructive button is offered. This can destroy a fully-paid bill, so the
 * list is the point of the dialog, not decoration.
 */
export function DeleteBillDialog({
  accountId,
  invoiceId,
  billLabel,
  preview,
  loadError,
  onClose,
}: {
  accountId: number;
  invoiceId: number;
  billLabel: string;
  preview: BillDeletionPreview | null;
  loadError: string | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, deleting]);

  const payments = preview?.payments ?? [];

  function confirm() {
    setError(null);
    startDelete(async () => {
      try {
        // Confirm against exactly what this dialog showed — the payments listed
        // below and the cohort-row count. The DAL refuses if the bill has
        // gained or lost a payment or cohort since the preview, so a delete
        // approved here can't quietly destroy a different set than was shown.
        const res = await deleteBillAction(
          accountId,
          invoiceId,
          payments.map((p) => p.id),
          preview?.cohortCount ?? 0,
        );
        // Stay open on failure — silently closing would read as success.
        if (res.ok) onClose();
        else setError(res.error);
      } catch (e) {
        // Transport-level failure (the action itself never throws).
        setError(e instanceof Error ? e.message : "Could not delete this bill.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      onClick={() => { if (!deleting) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-bill-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] flex max-h-[84vh] w-full max-w-[520px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
          <div>
            <h2 id="delete-bill-title" className="text-base font-bold tracking-tight text-text-primary">
              Delete {billLabel}?
            </h2>
            {/* The label is only category + semester, and nothing stops an
                account from having two bills that share it — so name the
                invoice's own amount and date, which do tell them apart. */}
            {preview && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
                <span>Billed</span>
                <Money value={preview.billedAmount} className="font-semibold text-text-secondary" />
                <span>·</span>
                <span>
                  {preview.invoiceDate ? `raised ${fmtDay(preview.invoiceDate)}` : "no invoice date"}
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={deleting}
            aria-label="Close"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          {loadError ? (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {loadError}
            </p>
          ) : preview ? (
            <>
              <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--negative-text)]">
                Deleting this bill permanently deletes it and everything below —{" "}
                <span className="font-bold">{plural(payments.length, "payment entry", "payment entries")}</span>{" "}
                (listed) and <span className="font-bold">{plural(preview.cohortCount, "cohort row", "cohort rows")}</span>.{" "}
                <span className="font-bold">This cannot be undone.</span>
              </p>

              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                  Payments that will be deleted
                </div>
                {payments.length === 0 ? (
                  <p className="rounded-md border border-border bg-surface-sunken px-3 py-3 text-center text-xs text-text-muted">
                    No payments have been recorded against this bill — nothing to unwind.
                  </p>
                ) : (
                  <div className="rounded-md border border-border px-3 py-2.5">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-text-muted">
                          <th className="pb-1 text-left font-medium">Particulars</th>
                          <th className="pb-1 pl-3 text-left font-medium">Date</th>
                          <th className="pb-1 pl-3 text-left font-medium">Mode</th>
                          <th className="pb-1 pl-3 text-right font-medium">Debit</th>
                          <th className="pb-1 pl-3 text-right font-medium">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => {
                          const isCredit = p.direction === "receipt";
                          return (
                            <tr key={p.id} className="border-t border-border-subtle/60">
                              <td className="py-1 pr-3">
                                <span
                                  className={
                                    isCredit
                                      ? "text-[var(--positive-text)]"
                                      : "text-[var(--info-text)]"
                                  }
                                >
                                  {isCredit ? "Received" : "Paid OEM"}
                                </span>
                              </td>
                              <td className="py-1 pl-3 text-text-secondary">{fmtDay(p.paidOn)}</td>
                              <td className="py-1 pl-3 text-text-muted">
                                {p.mode}
                                {p.ref ? ` · ${p.ref}` : ""}
                              </td>
                              <td className="py-1 pl-3 text-right">
                                {!isCredit && <Money value={p.amount} className="font-medium" />}
                              </td>
                              <td className="py-1 pl-3 text-right">
                                {isCredit && <Money value={p.amount} className="font-medium" />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-1 rounded-md bg-surface-sunken px-3.5 py-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">Receipts reversed</span>
                  <Money value={preview.receiptsTotal} className="font-semibold" />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">OEM payments reversed</span>
                  <Money value={preview.oemPaymentsTotal} className="font-semibold" />
                </div>
                <div className="flex items-center justify-between border-t border-border-subtle pt-1.5 text-xs">
                  <span className="text-text-secondary">Cohort rows deleted</span>
                  <span className="tabular font-semibold text-text-primary">{preview.cohortCount}</span>
                </div>
              </div>
            </>
          ) : null}

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            Keep this bill
          </button>
          {!loadError && (
            <button
              onClick={confirm}
              disabled={deleting || !preview}
              className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-4 py-1.5 text-sm font-semibold text-[var(--negative-text)] hover:opacity-80 disabled:opacity-50"
            >
              {deleting
                ? "Deleting…"
                : payments.length > 0
                  ? `Delete bill and ${plural(payments.length, "payment", "payments")}`
                  : "Delete this bill permanently"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
