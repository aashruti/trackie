"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { computeInvoice } from "@/lib/money/compute";
import type { Category, Semester, Status } from "@/lib/money/types";
import { yearOfStudy } from "@/lib/fy";
import { streamLabel } from "@/lib/money/report-view";
import { savePricingAction, type PricingEdit } from "@/app/(app)/pricing/actions";
import type { PricingAccountRow, PricingBatch, PricingInvoiceRow } from "@/lib/dal/pricing-master";

/** Sparse per-invoice edits; display = edit ?? server value. Cleared on save. */
interface InvoiceEdits {
  students?: number;
  priceToUni?: number;
  priceToDatagami?: number;
  batches?: PricingBatch[]; // whole list, replaced when any batch cell changes
}

const cellCls =
  "tabular w-24 rounded-md border bg-surface px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]";
const cleanCls = "border-border-strong";
const dirtyCls = "border-[var(--primary-border)] bg-[var(--primary-subtle)]";
// Colour-coded stream chips: green = fresh intake, blue = returning batches.
const STREAM_CHIP: Record<string, string> = {
  new: "bg-[var(--positive-subtle)] text-[var(--positive-text)]",
  old: "bg-[var(--info-subtle)] text-[var(--info-text)]",
};

export function PricingMaster({
  rows,
  currentYear,
}: {
  rows: PricingAccountRow[];
  currentYear: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<number, InvoiceEdits>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function patch(invoiceId: number, p: Partial<InvoiceEdits>) {
    setSavedMsg(null);
    setEdits((prev) => ({ ...prev, [invoiceId]: { ...prev[invoiceId], ...p } }));
  }
  function patchBatch(inv: PricingInvoiceRow, index: number, p: Partial<PricingBatch>) {
    setSavedMsg(null);
    setEdits((prev) => {
      const current = prev[inv.invoiceId]?.batches ?? inv.batches.map((b) => ({ ...b }));
      const batches = current.map((b, i) => (i === index ? { ...b, ...p } : b));
      return { ...prev, [inv.invoiceId]: { ...prev[inv.invoiceId], batches } };
    });
  }

  /** Merged view of an invoice with its pending edits applied. */
  function merged(inv: PricingInvoiceRow) {
    const e = edits[inv.invoiceId];
    const batches = e?.batches ?? inv.batches;
    const students = batches.length
      ? batches.reduce((a, b) => a + b.count, 0)
      : (e?.students ?? inv.students);
    return {
      students,
      priceToUni: e?.priceToUni ?? inv.priceToUni,
      priceToDatagami: e?.priceToDatagami ?? inv.priceToDatagami,
      batches,
    };
  }

  /** Diff → payload of actually-changed invoices (the save wire format). */
  const payload = useMemo<PricingEdit[]>(() => {
    const out: PricingEdit[] = [];
    for (const acc of rows) {
      if (!acc.editable) continue;
      for (const inv of acc.invoices) {
        const e = edits[inv.invoiceId];
        if (!e) continue;
        const entry: PricingEdit = { accountId: acc.accountId, invoiceId: inv.invoiceId };
        const scalar: NonNullable<PricingEdit["invoice"]> = {};
        if (e.students != null && e.students !== inv.students && inv.batches.length === 0)
          scalar.students = e.students;
        if (e.priceToUni != null && e.priceToUni !== inv.priceToUni) scalar.priceToUni = e.priceToUni;
        if (e.priceToDatagami != null && e.priceToDatagami !== inv.priceToDatagami)
          scalar.priceToDatagami = e.priceToDatagami;
        if (Object.keys(scalar).length) entry.invoice = scalar;
        if (e.batches && JSON.stringify(e.batches) !== JSON.stringify(inv.batches)) {
          entry.cohorts = e.batches.map((b) => ({
            enrollmentYear: b.enrollmentYear,
            count: b.count,
            priceToUni: b.priceToUni,
            priceToDatagami: b.priceToDatagami,
          }));
        }
        if (entry.invoice || entry.cohorts) out.push(entry);
      }
    }
    return out;
  }, [rows, edits]);

  const filtered = useMemo(
    () => rows.filter((r) => r.accountName.toLowerCase().includes(q.trim().toLowerCase())),
    [rows, q],
  );
  const totalStreams = useMemo(() => rows.reduce((a, r) => a + r.invoices.length, 0), [rows]);

  function save() {
    setError(null);
    setSavedMsg(null);
    if (!payload.length) return;
    startTransition(async () => {
      try {
        const res = await savePricingAction(payload);
        if (res.ok) {
          setEdits({});
          setSavedMsg(`Saved ${res.saved} invoice${res.saved === 1 ? "" : "s"}`);
          router.refresh();
        } else {
          setError(res.error);
        }
      } catch (e) {
        // Transport/auth failures throw rather than returning {ok:false}.
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter accounts…"
          className="w-64 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
          aria-label="Filter accounts"
        />
        <div className="text-xs text-text-muted">
          {rows.length} accounts · {totalStreams} streams
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface-sunken">
              <tr className="text-left text-xs text-text-muted">
                <th className="px-5 py-2.5 font-medium">Stream / batch</th>
                <th className="px-3 py-2.5 text-right font-medium">Students</th>
                <th className="px-3 py-2.5 text-right font-medium">Price / uni</th>
                <th className="px-3 py-2.5 text-right font-medium">Price / Datagami</th>
                <th className="px-3 py-2.5 text-right font-medium">Billing</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="px-5 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => (
                <Fragment key={acc.accountId}>
                  {/* Account group header — streams render beneath it. */}
                  <tr className="border-b border-border-subtle bg-surface-sunken">
                    <td colSpan={7} className="px-5 py-2 text-sm font-semibold text-text-primary">
                      {acc.accountName}
                      {!acc.editable && (
                        <span className="ml-2 text-xs font-normal text-text-muted">read-only</span>
                      )}
                    </td>
                  </tr>
                  {acc.invoices.map((inv) => {
                    const d = merged(inv);
                    const computed = computeInvoice({
                      category: inv.category as Category,
                      semester: inv.semester as Semester,
                      students: d.students,
                      priceToUni: d.priceToUni,
                      priceToDatagami: d.priceToDatagami,
                      gstRate: inv.gstRate,
                      tdsRate: inv.tdsRate,
                      advanceAdj: inv.advanceAdj,
                      cohortPricing: d.batches.length
                        ? d.batches.map((b) => ({
                            count: b.count,
                            priceToUni: b.priceToUni,
                            priceToDatagami: b.priceToDatagami,
                          }))
                        : undefined,
                    });
                    const canType = acc.editable;
                    const scalarStudents = d.batches.length === 0;
                    const e = edits[inv.invoiceId];
                    return (
                      <Fragment key={inv.invoiceId}>
                        <tr className="border-b border-border-subtle align-top last:border-0">
                          <td className="px-5 py-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                STREAM_CHIP[inv.category] ?? "text-text-secondary"
                              }`}
                            >
                              {streamLabel(inv.category, inv.semester)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {scalarStudents ? (
                              canType ? (
                                <input
                                  type="number" min={0}
                                  value={e?.students ?? inv.students}
                                  onChange={(ev) =>
                                    patch(inv.invoiceId, {
                                      students: Math.max(0, parseInt(ev.target.value, 10) || 0),
                                    })
                                  }
                                  aria-label={`${acc.accountName} ${streamLabel(inv.category, inv.semester)} students`}
                                  className={`${cellCls} w-20 ${
                                    e?.students != null && e.students !== inv.students
                                      ? dirtyCls
                                      : cleanCls
                                  }`}
                                />
                              ) : (
                                <span className="tabular">{inv.students}</span>
                              )
                            ) : (
                              <span className="tabular text-text-secondary">Σ {d.students}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canType ? (
                              <input
                                type="number" min={0}
                                value={e?.priceToUni ?? inv.priceToUni}
                                onChange={(ev) =>
                                  patch(inv.invoiceId, {
                                    priceToUni: Math.max(0, parseFloat(ev.target.value) || 0),
                                  })
                                }
                                aria-label={`${acc.accountName} ${streamLabel(inv.category, inv.semester)} price to uni`}
                                className={`${cellCls} ${
                                  e?.priceToUni != null && e.priceToUni !== inv.priceToUni
                                    ? dirtyCls
                                    : cleanCls
                                }`}
                              />
                            ) : (
                              <span className="tabular">{inv.priceToUni}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canType ? (
                              <input
                                type="number" min={0}
                                value={e?.priceToDatagami ?? inv.priceToDatagami}
                                onChange={(ev) =>
                                  patch(inv.invoiceId, {
                                    priceToDatagami: Math.max(0, parseFloat(ev.target.value) || 0),
                                  })
                                }
                                aria-label={`${acc.accountName} ${streamLabel(inv.category, inv.semester)} price to Datagami`}
                                className={`${cellCls} ${
                                  e?.priceToDatagami != null &&
                                  e.priceToDatagami !== inv.priceToDatagami
                                    ? dirtyCls
                                    : cleanCls
                                }`}
                              />
                            ) : (
                              <span className="tabular">{inv.priceToDatagami}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={computed.billing} compact />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={computed.netMargin} compact tone="auto" />
                          </td>
                          <td className="px-5 py-2 text-right">
                            <StatusBadge status={inv.status as Status} />
                          </td>
                        </tr>
                        {d.batches.map((b, bi) => {
                          const yos = yearOfStudy(b.enrollmentYear, currentYear);
                          const orig = inv.batches[bi];
                          return (
                            <tr
                              key={`${inv.invoiceId}:${b.enrollmentYear}`}
                              className="border-b border-border-subtle bg-surface-sunken/50 align-top last:border-0"
                            >
                              <td className="py-1.5 pl-8 pr-3 text-xs text-text-secondary">
                                {yos ? (
                                  <>
                                    <span className="font-medium text-text-primary">{yos}</span>{" "}
                                    <span className="text-text-muted">· {b.enrollmentYear}</span>
                                  </>
                                ) : (
                                  b.enrollmentYear
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number" min={0}
                                    value={b.count}
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        count: Math.max(0, parseInt(ev.target.value, 10) || 0),
                                      })
                                    }
                                    aria-label={`${acc.accountName} batch ${b.enrollmentYear} count`}
                                    className={`${cellCls} w-20 ${
                                      orig && b.count !== orig.count ? dirtyCls : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.count}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number" min={0}
                                    value={b.priceToUni ?? ""}
                                    placeholder="invoice"
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        priceToUni:
                                          ev.target.value === ""
                                            ? null
                                            : Math.max(0, parseFloat(ev.target.value) || 0),
                                      })
                                    }
                                    aria-label={`${acc.accountName} batch ${b.enrollmentYear} price to uni`}
                                    className={`${cellCls} ${
                                      orig && b.priceToUni !== orig.priceToUni ? dirtyCls : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.priceToUni ?? "—"}</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {canType ? (
                                  <input
                                    type="number" min={0}
                                    value={b.priceToDatagami ?? ""}
                                    placeholder="invoice"
                                    onChange={(ev) =>
                                      patchBatch(inv, bi, {
                                        priceToDatagami:
                                          ev.target.value === ""
                                            ? null
                                            : Math.max(0, parseFloat(ev.target.value) || 0),
                                      })
                                    }
                                    aria-label={`${acc.accountName} batch ${b.enrollmentYear} price to Datagami`}
                                    className={`${cellCls} ${
                                      orig && b.priceToDatagami !== orig.priceToDatagami
                                        ? dirtyCls
                                        : cleanCls
                                    }`}
                                  />
                                ) : (
                                  <span className="tabular">{b.priceToDatagami ?? "—"}</span>
                                )}
                              </td>
                              <td colSpan={3} />
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-border bg-surface p-3 shadow-sm">
        <div className="text-sm">
          {error ? (
            <span className="text-[var(--negative-text)]">{error}</span>
          ) : savedMsg ? (
            <span className="text-[var(--positive-text)]">{savedMsg}</span>
          ) : payload.length ? (
            <span className="text-text-secondary">
              {payload.length} invoice{payload.length === 1 ? "" : "s"} with unsaved changes
            </span>
          ) : (
            <span className="text-text-muted">No unsaved changes</span>
          )}
        </div>
        <button
          onClick={save}
          disabled={pending || payload.length === 0}
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? "Saving…"
            : payload.length
              ? `Save ${payload.length} change${payload.length === 1 ? "" : "s"}`
              : "Save changes"}
        </button>
      </div>
    </div>
  );
}
