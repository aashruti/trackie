"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fmt } from "@/lib/money/format";
import { StatusBadge } from "@/components/ui/badge";
import { InvoiceLadder } from "./invoice-ladder";
import { InvoiceEditor } from "./invoice-editor";
import { CohortEditor } from "./cohort-editor";
import type { InvoiceComputed, Status } from "@/lib/money/types";
import { CATEGORY_LABEL } from "@/lib/money/report-view";

import type { PaymentEntry } from "@/lib/dal/payments";

type Inv = InvoiceComputed & {
  id: number;
  status: Status;
  cohorts: { enrollmentYear: string; count: number; priceToUni: number | null; priceToDatagami: number | null }[];
  ledger: PaymentEntry[];
  invoiceDate: string | null;
  dueDate: string | null;
};

function label(inv: Inv) {
  // inv.category is already typed Category, so CATEGORY_LABEL (total over the
  // enum) never misses — no fallback needed.
  const base = CATEGORY_LABEL[inv.category];
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "1st" : "2nd"} sem`;
}

const TABS = ["Ladder", "Flow", "Statement", "Students"] as const;

export function DetailTabs({
  invoices,
  oem,
  accountId,
  currentYear,
  canEdit = false,
}: {
  invoices: Inv[];
  oem: string;
  accountId: number;
  currentYear: string;
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
                  invoiceDate: inv.invoiceDate,
                  dueDate: inv.dueDate,
                  status: inv.status,
                }}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <InvoiceLadder
                key={i}
                inv={inv}
                accountId={accountId}
                currentYear={currentYear}
                canEdit={canEdit}
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

      {tab === "Students" && (
        <StudentsView
          invoices={invoices}
          currentYear={currentYear}
          accountId={accountId}
          canEdit={canEdit}
        />
      )}

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

/** Academic-year start, e.g. "FY26–27" → 2026, "2024-25" → 2024. */
function startYear(label: string): number | null {
  const m = label.match(/(\d{4})|(?:FY)?(\d{2})\D/);
  if (m?.[1]) return parseInt(m[1], 10);
  if (m?.[2]) return 2000 + parseInt(m[2], 10);
  return null;
}

/** Ordinal year of study for an enrollment cohort within the current academic year. */
function yearOfStudy(enrollmentYear: string, currentYear: string): string | null {
  const enroll = startYear(enrollmentYear);
  const cur = startYear(currentYear);
  if (enroll == null || cur == null) return null;
  const n = cur - enroll + 1;
  if (n < 1) return null;
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][n] ?? `${n}th`;
  return `${ord} year`;
}

function StudentsView({
  invoices,
  currentYear,
  accountId,
  canEdit,
}: {
  invoices: Inv[];
  currentYear: string;
  accountId: number;
  canEdit: boolean;
}) {
  const studentInvoices = invoices.filter((i) => i.category !== "advance");
  const total = studentInvoices.reduce((s, i) => s + i.students, 0);
  const [editingId, setEditingId] = useState<number | null>(null);

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
                <div className="flex items-center gap-3">
                  {canEdit && inv.category === "old" && editingId !== inv.id && (
                    <button
                      onClick={() => setEditingId(inv.id)}
                      className="rounded-md border border-border-strong bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary hover:bg-surface-hover"
                    >
                      Edit cohorts
                    </button>
                  )}
                  <span className="tabular text-lg font-semibold text-text-primary">
                    {inv.students}
                  </span>
                </div>
              </div>

              {editingId === inv.id ? (
                <CohortEditor
                  accountId={accountId}
                  invoiceId={inv.id}
                  initial={inv.cohorts.map((c) => ({
                    enrollmentYear: c.enrollmentYear,
                    count: c.count,
                    priceToUni: c.priceToUni,
                    priceToDatagami: c.priceToDatagami,
                  }))}
                  onClose={() => setEditingId(null)}
                />
              ) : inv.cohorts.length > 0 ? (
                <div className="space-y-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    By enrollment year
                  </div>
                  {inv.cohorts.map((c, i) => {
                    const yos = yearOfStudy(c.enrollmentYear, currentYear);
                    return (
                    <div key={c.enrollmentYear} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-xs text-text-secondary">
                        {yos ? (
                          <>
                            <span className="font-medium text-text-primary">{yos}</span>{" "}
                            <span className="text-text-muted">· {c.enrollmentYear}</span>
                          </>
                        ) : (
                          c.enrollmentYear
                        )}
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
                      {(c.priceToUni != null || c.priceToDatagami != null) && (
                        <span className="tabular w-28 shrink-0 text-right text-[11px] text-text-muted">
                          {c.priceToUni != null && <>@{fmt(c.priceToUni)}</>}
                          {c.priceToDatagami != null && (
                            <span className="text-text-muted"> ▸ {fmt(c.priceToDatagami)}</span>
                          )}
                        </span>
                      )}
                      <span className="tabular w-10 shrink-0 text-right text-xs font-medium text-text-primary">
                        {c.count}
                      </span>
                    </div>
                    );
                  })}
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
