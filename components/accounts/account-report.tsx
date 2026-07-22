"use client";

import type { AccountDetail } from "@/lib/dal/account-detail";
import { CATEGORY_LABEL, type ReportCategory } from "@/lib/money/report-view";

// category is always Category-typed at every call site below, so
// CATEGORY_LABEL (total over the enum) never misses — no fallback needed.
function streamLabel(category: ReportCategory, semester: string) {
  const base = CATEGORY_LABEL[category];
  return semester === "none" ? base : `${base} (${semester === "1" ? "Odd" : "Even"} sem)`;
}

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
const row = (...vals: unknown[]) => vals.map(cell).join(",");

function buildCsv(detail: AccountDetail, year: string): string {
  const L: string[] = [];
  L.push(row("Trackie — Account report"));
  L.push(row("Account", detail.name));
  L.push(row("OEM", detail.selfSupplied ? "Datagami (own product)" : detail.oem));
  L.push(row("Type", detail.type));
  L.push(row("Academic year", year));
  L.push(row("Status", detail.status));
  L.push(row("Total students", detail.totalStudents));
  L.push("");

  L.push(row("TOTALS"));
  L.push(row("Billed", detail.totals.billed));
  L.push(row("Received", detail.totals.received));
  L.push(row("Outstanding", detail.totals.outstanding));
  L.push(row("Payable to OEM", detail.totals.payable));
  L.push(row("Paid to OEM", detail.totals.paidToOem));
  L.push(row("Outstanding to OEM", detail.totals.outstandingToOem));
  L.push(row("Net margin", detail.totals.netMargin));
  L.push(row("Net GST payable (set aside)", detail.reserves.netGst));
  L.push(row("TDS receivable", detail.reserves.tdsReceivable));
  L.push(row("TDS payable", detail.reserves.tdsPayable));
  L.push(row("Advance TDS cost", detail.reserves.advanceTdsCost));
  L.push("");

  L.push(row("INVOICES"));
  L.push(
    row(
      "Stream", "Students", "Price to uni", "Price to Datagami", "GST %", "TDS %",
      "Taxable (full)", "Advance prepaid", "Billing", "After TDS", "Received", "Outstanding",
      "Payable to OEM", "Paid to OEM", "Outstanding to OEM", "Net margin", "Status",
    ),
  );
  for (const i of detail.invoices) {
    L.push(
      row(
        streamLabel(i.category, i.semester), i.students, i.priceToUni, i.priceToDatagami,
        Math.round(i.gstRate * 100), Math.round(i.tdsRate * 100),
        i.taxableIn, i.advanceAdj, i.billing, i.afterTds, i.received, i.outstanding,
        i.payable, i.paidToOem, i.outstandingToOem, i.netMargin, i.status,
      ),
    );
  }
  L.push("");

  L.push(row("PAYMENTS"));
  L.push(row("Stream", "Direction", "Date", "Amount", "Mode", "Reference"));
  let anyPayment = false;
  for (const i of detail.invoices) {
    for (const p of i.ledger) {
      anyPayment = true;
      L.push(
        row(
          streamLabel(i.category, i.semester),
          p.direction === "receipt" ? "Receipt (in)" : "OEM payment (out)",
          p.paidOn, p.amount, p.mode, p.ref ?? "",
        ),
      );
    }
  }
  if (!anyPayment) L.push(row("(no payments recorded)"));
  L.push("");

  const cohortInvoices = detail.invoices.filter((i) => i.cohorts.length > 0);
  if (cohortInvoices.length) {
    L.push(row("COHORTS (old-student enrollment-year distribution)"));
    L.push(row("Stream", "Enrollment year", "Count"));
    for (const i of cohortInvoices) {
      for (const c of i.cohorts) {
        L.push(row(streamLabel(i.category, i.semester), c.enrollmentYear, c.count));
      }
    }
  }

  return L.join("\n");
}

export function AccountReportButton({
  detail,
  year,
}: {
  detail: AccountDetail;
  year: string;
}) {
  function exportReport() {
    const csv = buildCsv(detail, year);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = detail.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = `trackie-${safe}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={exportReport}
      className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
    >
      Export report
    </button>
  );
}
