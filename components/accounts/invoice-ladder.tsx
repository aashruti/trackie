"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { PaymentForm } from "./payment-form";
import { DeleteBillDialog } from "./delete-bill-dialog";
import { billDeletionPreviewAction } from "@/app/(app)/accounts/[id]/actions";
import type { BillDeletionPreview } from "@/lib/dal/account-admin";
import type { InvoiceComputed, Status } from "@/lib/money/types";
import type { Direction, PaymentEntry } from "@/lib/dal/payments";
import { fmtDay, isOverdue } from "@/lib/dates";
import { fmt } from "@/lib/money/format";
import { CATEGORY_LABEL } from "@/lib/money/report-view";
import { yearOfStudy } from "@/lib/fy";

function title(inv: InvoiceComputed) {
  // inv.category is already typed Category, so CATEGORY_LABEL (total over the
  // enum) never misses — no fallback needed.
  const base = CATEGORY_LABEL[inv.category];
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "Odd" : "Even"} sem`;
}

function Line({
  label,
  value,
  tone,
  strong,
  op,
}: {
  label: string;
  value: number;
  tone?: "default" | "positive" | "negative" | "pending" | "info" | "muted";
  strong?: boolean;
  op?: string;
}) {
  return (
    <div className={`flex items-center justify-between py-1 ${strong ? "font-semibold" : ""}`}>
      <span className="text-xs text-text-secondary">
        {op && <span className="mr-1 text-text-muted">{op}</span>}
        {label}
      </span>
      <Money value={value} tone={tone ?? "default"} className="text-sm" />
    </div>
  );
}

export type LadderInvoice = InvoiceComputed & {
  id: number;
  status: Status;
  cohorts: { enrollmentYear: string; count: number; priceToUni: number | null; priceToDatagami: number | null }[];
  ledger: PaymentEntry[];
  invoiceDate: string | null;
  dueDate: string | null;
};

export function InvoiceLadder({
  inv,
  accountId,
  currentYear,
  canEdit = false,
  isSuperAdmin = false,
  onEdit,
}: {
  inv: LadderInvoice;
  accountId: number;
  currentYear?: string;
  canEdit?: boolean;
  /** Super-admins alone may delete a bill of any status (spec §8). */
  isSuperAdmin?: boolean;
  onEdit?: () => void;
}) {
  const isAdvance = inv.category === "advance";
  const self = inv.selfSupplied === true;
  const [paying, setPaying] = useState<Direction | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<BillDeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Fetch the cascade first, then open — the dialog's whole job is to show
  // what is about to be destroyed, so it never opens without that answer.
  // A failed fetch still opens, in an error state, rather than dead-ending.
  async function openDeleteDialog() {
    setLoadingPreview(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await billDeletionPreviewAction(accountId, inv.id);
      if (res.ok) setPreview(res.preview);
      else setPreviewError(res.error);
    } catch (e) {
      // Transport-level failure (the action itself never throws).
      setPreviewError(
        e instanceof Error ? e.message : "Could not work out what deleting this bill would remove.",
      );
    } finally {
      setLoadingPreview(false);
      setDeleteOpen(true);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title(inv)}</h3>
          <p className="text-xs text-text-muted">
            {inv.students} {inv.students === 1 ? "unit" : "students"} · GST {(inv.gstRate * 100).toFixed(0)}% · TDS {(inv.tdsRate * 100).toFixed(0)}%
          </p>
          {(inv.invoiceDate || inv.dueDate) && (
            <p className="mt-0.5 flex gap-3 text-[11px] text-text-muted">
              {inv.invoiceDate && <span>Raised {fmtDay(inv.invoiceDate)}</span>}
              {inv.dueDate && (
                <span className={isOverdue(inv.dueDate) && inv.status !== "paid" ? "font-semibold text-[var(--negative-text)]" : ""}>
                  Due {fmtDay(inv.dueDate)}{isOverdue(inv.dueDate) && inv.status !== "paid" ? " · overdue" : ""}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <button
                onClick={() => setPaying("receipt")}
                className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-[var(--positive-text)] hover:bg-surface-hover"
              >
                Record receipt
              </button>
              {!self && (
                <button
                  onClick={() => setPaying("oem-payment")}
                  className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-[var(--info-text)] hover:bg-surface-hover"
                >
                  Pay OEM
                </button>
              )}
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover"
                >
                  Edit
                </button>
              )}
            </>
          )}
          {/* Any status, super-admin only (spec §8) — the old draft-only gate
              is gone; the itemised dialog is what makes that safe. */}
          {isSuperAdmin && (
            <button
              onClick={openDeleteDialog}
              disabled={loadingPreview}
              className="rounded-md border border-border-strong bg-surface px-2.5 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-50"
            >
              {loadingPreview ? "Checking…" : "Delete"}
            </button>
          )}
          <StatusBadge status={inv.status} />
        </div>
      </div>

      {inv.category === "old" && inv.cohorts.length > 0 && currentYear && (
        <div className="mb-4 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Batch breakdown
          </div>
          <div className="space-y-1">
            {inv.cohorts.map((c) => {
              const yos = yearOfStudy(c.enrollmentYear, currentYear);
              const ptu = c.priceToUni ?? inv.priceToUni;
              const ptd = c.priceToDatagami ?? inv.priceToDatagami;
              return (
                <div key={c.enrollmentYear} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-xs">
                  <span>
                    {yos ? (
                      <>
                        <span className="font-medium text-text-primary">{yos}</span>
                        <span className="ml-1.5 text-text-muted">· {c.enrollmentYear}</span>
                      </>
                    ) : (
                      <span className="text-text-secondary">{c.enrollmentYear}</span>
                    )}
                  </span>
                  <span className="tabular text-right text-text-secondary">{c.count} stu</span>
                  <span className="tabular text-right text-text-muted">× {fmt(ptu)}</span>
                  <Money value={c.count * ptu} className="text-xs text-right" />
                </div>
              );
            })}
            {inv.cohorts.length > 1 && (
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-t border-border-subtle pt-1.5 text-xs font-semibold">
                <span className="text-text-secondary">Total</span>
                <span className="tabular text-right text-text-muted">{inv.students} stu</span>
                <span />
                <Money value={inv.taxableIn} className="text-xs text-right" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
        {/* Inflow */}
        <div className="border-t border-border-subtle pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Inflow · University → Datagami
          </div>
          <Line label="Taxable" value={inv.taxableIn} />
          {inv.advanceAdj > 0 && (
            <>
              <Line label="Advance prepaid" value={inv.advanceAdj} op="−" tone="info" />
              <Line label="Net taxable" value={inv.billedTaxableIn} strong />
            </>
          )}
          <Line label="GST" value={inv.gstIn} op="+" tone="muted" />
          <Line label="Billing" value={inv.billing} strong />
          <Line label="TDS withheld" value={inv.tdsIn} op="−" tone="muted" />
          <Line label="After TDS" value={inv.afterTds} strong />
          <Line label="Received" value={inv.received} tone="positive" />
          <Line label="Outstanding" value={inv.outstanding} tone="pending" strong />
        </div>

        {/* Outflow */}
        {self ? (
          <div className="border-t border-border-subtle pt-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Outflow · Datagami&apos;s own product
            </div>
            <div className="rounded-lg bg-[var(--positive-subtle)] px-3 py-2 text-xs text-[var(--positive-text)]">
              No external OEM transfer — Datagami is the supplier.
            </div>
            {inv.taxableOut > 0 && <Line label="Internal cost" value={inv.taxableOut} op="−" tone="muted" />}
            <Line label="Payable" value={0} strong tone="muted" />
          </div>
        ) : (
          <div className="border-t border-border-subtle pt-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Outflow · Datagami → OEM
            </div>
            <Line label="Taxable" value={inv.taxableOut} />
            {inv.advanceAdj > 0 && <Line label="Advance adjusted" value={inv.advanceAdj} op="−" tone="info" />}
            <Line label="OEM taxable (net)" value={inv.oemTaxableNet} strong />
            <Line label="GST" value={inv.gstOut} op="+" tone="muted" />
            <Line label="TDS withheld" value={inv.tdsOut} op="−" tone="muted" />
            <Line label="Payable to OEM" value={inv.payable} strong />
            <Line label="Paid to OEM" value={inv.paidToOem} tone="positive" />
            <Line label="Outstanding to OEM" value={inv.outstandingToOem} tone="pending" strong />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
        <span className="text-xs font-semibold text-text-secondary">
          Net margin
          {isAdvance && (
            <span className="ml-1 font-normal text-text-muted">
              (advance TDS fronted: <Money value={inv.advanceTdsCost} className="text-[11px]" />)
            </span>
          )}
        </span>
        <Money value={inv.netMargin} tone="auto" className="text-base font-bold" />
      </div>

      {paying && (
        <PaymentForm
          accountId={accountId}
          invoiceId={inv.id}
          direction={paying}
          onClose={() => setPaying(null)}
        />
      )}

      {deleteOpen && (
        <DeleteBillDialog
          accountId={accountId}
          invoiceId={inv.id}
          billLabel={title(inv)}
          preview={preview}
          loadError={previewError}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {inv.ledger.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Payment ledger
          </div>
          <div className="space-y-1">
            {inv.ledger.map((p) => (
              <div key={p.id} className="flex items-center gap-3 text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 font-medium ${
                    p.direction === "receipt"
                      ? "bg-[var(--positive-subtle)] text-[var(--positive-text)]"
                      : "bg-[var(--info-subtle)] text-[var(--info-text)]"
                  }`}
                >
                  {p.direction === "receipt" ? "Received" : "Paid OEM"}
                </span>
                <span className="text-text-secondary">{p.paidOn}</span>
                <span className="text-text-muted">{p.mode}</span>
                {p.ref && <span className="text-text-muted">· {p.ref}</span>}
                <Money value={p.amount} className="ml-auto font-medium" />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
