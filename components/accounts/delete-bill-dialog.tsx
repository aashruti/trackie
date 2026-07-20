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

  function confirm() {
    setError(null);
    startDelete(async () => {
      try {
        await deleteBillAction(accountId, invoiceId);
        onClose();
      } catch (e) {
        // Stay open on failure — silently closing would read as success.
        setError(e instanceof Error ? e.message : "Could not delete this bill.");
      }
    });
  }

  const payments = preview?.payments ?? [];

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
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="delete-bill-title" className="text-base font-bold tracking-tight text-text-primary">
            Delete {billLabel}?
          </h2>
          <button
            onClick={onClose}
            disabled={deleting}
            aria-label="Close"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-muted hover:bg-surface-hover disabled:opacity-50"
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
                  <div className="space-y-1 rounded-md border border-border px-3 py-2.5">
                    {payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 text-xs">
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
                            p.direction === "receipt"
                              ? "bg-[var(--positive-subtle)] text-[var(--positive-text)]"
                              : "bg-[var(--info-subtle)] text-[var(--info-text)]"
                          }`}
                        >
                          {p.direction === "receipt" ? "Received" : "Paid OEM"}
                        </span>
                        <span className="text-text-secondary">{fmtDay(p.paidOn)}</span>
                        <span className="truncate text-text-muted">
                          {p.mode}
                          {p.ref && ` · ${p.ref}`}
                        </span>
                        <Money value={p.amount} className="ml-auto shrink-0 font-medium" />
                      </div>
                    ))}
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
