"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { InvoiceLadder } from "./invoice-ladder";
import type { InvoiceComputed, Status } from "@/lib/money/types";

type Inv = InvoiceComputed & { status: Status };

const CATEGORY_LABEL: Record<string, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};
function label(inv: Inv) {
  const base = CATEGORY_LABEL[inv.category] ?? inv.category;
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "1st" : "2nd"} sem`;
}

const TABS = ["Ladder", "Flow", "Statement"] as const;

export function DetailTabs({ invoices, oem }: { invoices: Inv[]; oem: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Ladder");

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
          {invoices.map((inv, i) => (
            <InvoiceLadder key={i} inv={inv} />
          ))}
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
