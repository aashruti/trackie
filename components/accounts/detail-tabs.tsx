"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { InvoiceLadder } from "./invoice-ladder";
import { InvoiceEditor } from "./invoice-editor";
import type { InvoiceComputed, Status } from "@/lib/money/types";

type Inv = InvoiceComputed & {
  id: number;
  status: Status;
  cohorts: { enrollmentYear: string; count: number }[];
};

const CATEGORY_LABEL: Record<string, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};
function label(inv: Inv) {
  const base = CATEGORY_LABEL[inv.category] ?? inv.category;
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "1st" : "2nd"} sem`;
}

const TABS = ["Ladder", "Flow", "Statement", "Students"] as const;

export function DetailTabs({
  invoices,
  oem,
  accountId,
  canEdit = false,
}: {
  invoices: Inv[];
  oem: string;
  accountId: number;
  canEdit?: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Ladder");
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-[var(--primary-subtle)] text-[var(--primary-text)]"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Ladder" && (
        <div className="grid grid-cols-1 gap-4">
          {invoices.map((inv, i) =>
            editingId === inv.id ? (
              <InvoiceEditor
                key={i}
                accountId={accountId}
                invoiceId={inv.id}
                category={inv.category}
                semester={inv.semester}
                initial={{
                  students: inv.students,
                  priceToUni: inv.priceToUni,
                  priceToDatagami: inv.priceToDatagami,
                  gstRate: inv.gstRate,
                  tdsRate: inv.tdsRate,
                  advanceAdj: inv.advanceAdj,
                  status: inv.status,
                }}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <InvoiceLadder
                key={i}
                inv={inv}
                onEdit={canEdit ? () => setEditingId(inv.id) : undefined}
              />
            ),
          )}
        </div>
      )}

      {tab === "Flow" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {invoices.map((inv, i) => (
            <Card key={i} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">{label(inv)}</h3>
                <StatusBadge status={inv.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-center">
                <div className="flex-1">
                  <div className="text-[11px] text-text-muted">University pays in</div>
                  <Money value={inv.afterTds} compact className="text-base font-semibold" />
                </div>
                <span className="text-text-muted">→</span>
                <div className="flex-1">
                  <div className="text-[11px] text-text-muted">Datagami pays OEM</div>
                  <Money value={inv.payable} compact tone="info" className="text-base font-semibold" />
                </div>
                <span className="text-text-muted">→</span>
                <div className="flex-1">
                  <div className="text-[11px] text-text-muted">Margin</div>
                  <Money value={inv.netMargin} compact tone="auto" className="text-base font-bold" />
                </div>
              </div>
              {inv.advanceAdj > 0 && (
                <p className="mt-3 text-[11px] text-text-muted">
                  Advance of <Money value={inv.advanceAdj} className="text-[11px]" /> netted from the OEM transfer.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "Students" && <StudentsView invoices={invoices} />}

      {tab === "Statement" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                  <th className="px-5 py-2.5 font-medium">Line item</th>
                  <th className="px-3 py-2.5 text-right font-medium">Billed</th>
                  <th className="px-3 py-2.5 text-right font-medium">After TDS</th>
                  <th className="px-3 py-2.5 text-right font-medium">Received</th>
                  <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-3 py-2.5 text-right font-medium">Payable {oem}</th>
                  <th className="px-5 py-2.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="px-5 py-3 font-medium text-text-primary">{label(inv)}</td>
                    <td className="px-3 py-3 text-right"><Money value={inv.billing} /></td>
                    <td className="px-3 py-3 text-right"><Money value={inv.afterTds} /></td>
                    <td className="px-3 py-3 text-right"><Money value={inv.received} tone="positive" /></td>
                    <td className="px-3 py-3 text-right"><Money value={inv.outstanding} tone="pending" /></td>
                    <td className="px-3 py-3 text-right"><Money value={inv.payable} tone="info" /></td>
                    <td className="px-5 py-3 text-right"><Money value={inv.netMargin} tone="auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

const COHORT_COLORS = [
  "var(--primary)",
  "var(--info)",
  "var(--positive)",
  "var(--pending)",
  "var(--neutral-status)",
];

function StudentsView({ invoices }: { invoices: Inv[] }) {
  const studentInvoices = invoices.filter((i) => i.category !== "advance");
  const total = studentInvoices.reduce((s, i) => s + i.students, 0);

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Total student count (billed)
          </div>
          <div className="mt-1 text-3xl font-semibold tabular text-text-primary">{total}</div>
        </div>
        <div className="text-right text-xs text-text-muted">
          across {studentInvoices.length} student invoice
          {studentInvoices.length === 1 ? "" : "s"}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {studentInvoices.map((inv, idx) => {
          const cohortTotal = inv.cohorts.reduce((s, c) => s + c.count, 0);
          const max = Math.max(1, ...inv.cohorts.map((c) => c.count));
          return (
            <Card key={idx} className="p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-text-primary">{label(inv)}</h3>
                <span className="tabular text-lg font-semibold text-text-primary">
                  {inv.students}
                </span>
              </div>

              {inv.cohorts.length > 0 ? (
                <div className="space-y-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    By enrollment year
                  </div>
                  {inv.cohorts.map((c, i) => (
                    <div key={c.enrollmentYear} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-text-secondary">
                        {c.enrollmentYear}
                      </span>
                      <div className="relative h-4 flex-1 rounded bg-surface-sunken">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${(c.count / max) * 100}%`,
                            background: COHORT_COLORS[i % COHORT_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="tabular w-10 shrink-0 text-right text-xs font-medium text-text-primary">
                        {c.count}
                      </span>
                    </div>
                  ))}
                  {cohortTotal !== inv.students && (
                    <p className="text-[11px] text-[var(--pending-text)]">
                      Cohorts sum to {cohortTotal}; invoice total {inv.students}.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-text-muted">
                  Current-year intake — no multi-year cohort split.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
