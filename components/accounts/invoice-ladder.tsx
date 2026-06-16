import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import type { InvoiceComputed, Status } from "@/lib/money/types";

const CATEGORY_LABEL: Record<string, string> = {
  advance: "Advance bill",
  old: "Old students",
  new: "New students",
};

function title(inv: InvoiceComputed) {
  const base = CATEGORY_LABEL[inv.category] ?? inv.category;
  return inv.semester === "none" ? base : `${base} · ${inv.semester === "1" ? "1st" : "2nd"} sem`;
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

export function InvoiceLadder({ inv }: { inv: InvoiceComputed & { status: Status } }) {
  const isAdvance = inv.category === "advance";
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title(inv)}</h3>
          <p className="text-xs text-text-muted">
            {inv.students} {inv.students === 1 ? "unit" : "students"} · GST {(inv.gstRate * 100).toFixed(0)}% · TDS {(inv.tdsRate * 100).toFixed(0)}%
          </p>
        </div>
        <StatusBadge status={inv.status} />
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
        {/* Inflow */}
        <div className="border-t border-border-subtle pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Inflow · University → Datagami
          </div>
          <Line label="Taxable" value={inv.taxableIn} />
          <Line label="GST" value={inv.gstIn} op="+" tone="muted" />
          <Line label="Billing" value={inv.billing} strong />
          <Line label="TDS withheld" value={inv.tdsIn} op="−" tone="muted" />
          <Line label="After TDS" value={inv.afterTds} strong />
          <Line label="Received" value={inv.received} tone="positive" />
          <Line label="Outstanding" value={inv.outstanding} tone="pending" strong />
        </div>

        {/* Outflow */}
        <div className="border-t border-border-subtle pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Outflow · Datagami → OEM
          </div>
          <Line label="Taxable" value={inv.taxableOut} />
          {inv.advanceAdj > 0 && (
            <Line label="Advance adjusted" value={inv.advanceAdj} op="−" tone="info" />
          )}
          <Line label="OEM taxable (net)" value={inv.oemTaxableNet} strong />
          <Line label="GST" value={inv.gstOut} op="+" tone="muted" />
          <Line label="TDS withheld" value={inv.tdsOut} op="−" tone="muted" />
          <Line label="Payable to OEM" value={inv.payable} strong />
        </div>
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
    </Card>
  );
}
