"use client";

import type { OemReport } from "@/lib/dal/oem-report";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
const row = (...vals: unknown[]) => vals.map(cell).join(",");

function buildCsv(r: OemReport, year: string): string {
  const L: string[] = [];
  L.push(row("Trackie — OEM report"));
  L.push(row("OEM", r.isSelf ? `${r.oem} (own product)` : r.oem));
  L.push(row("Academic year", year));
  L.push(row("Accounts", r.accounts.length));
  L.push("");

  L.push(row("TOTALS"));
  L.push(row("Billed", r.totals.billed));
  L.push(row("Received", r.totals.received));
  L.push(row("Outstanding", r.totals.outstanding));
  L.push(row("Payable to OEM", r.totals.payable));
  L.push(row("Paid to OEM", r.totals.paidToOem));
  L.push(row("Outstanding to OEM", r.totals.outstandingToOem));
  L.push(row("Net margin", r.totals.netMargin));
  L.push(row("Net GST payable", r.totals.netGst));
  L.push(row("TDS receivable", r.totals.tdsReceivable));
  L.push(row("TDS payable", r.totals.tdsPayable));
  L.push("");

  L.push(row("ACCOUNTS"));
  L.push(
    row("Account", "Students", "Billed", "Received", "Outstanding", "Payable", "Paid to OEM", "Outstanding to OEM", "Net margin", "Status"),
  );
  for (const a of r.accounts) {
    L.push(
      row(a.name, a.students, a.billed, a.received, a.outstanding, a.payable, a.paidToOem, a.outstandingToOem, a.netMargin, a.status),
    );
  }
  L.push("");

  L.push(row("PAYMENTS"));
  // Tally-style Debit/Credit columns, bank-statement convention: receipts
  // credited, OEM payments debited.
  L.push(row("Account", "Stream", "Direction", "Date", "Debit", "Credit", "Mode", "Reference"));
  if (r.payments.length === 0) L.push(row("(no payments recorded)"));
  for (const p of r.payments) {
    const isCredit = p.direction === "receipt";
    L.push(
      row(
        p.account, p.stream,
        isCredit ? "Receipt (in)" : "OEM payment (out)",
        p.paidOn,
        isCredit ? "" : p.amount,
        isCredit ? p.amount : "",
        p.mode, p.ref ?? "",
      ),
    );
  }
  return L.join("\n");
}

export function OemCsvButton({ report, year }: { report: OemReport; year: string }) {
  function exportCsv() {
    const blob = new Blob([buildCsv(report, year)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = report.oem.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `trackie-oem-${safe}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      onClick={exportCsv}
      className="no-print rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
    >
      Export CSV
    </button>
  );
}
