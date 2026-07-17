import * as XLSX from "xlsx";
import { auth } from "@/lib/auth/config";
import { getReportData } from "@/lib/dal/reports";
import {
  categoryLabels,
  categorySlug,
  parseCategories,
  parseSort,
  selectReport,
} from "@/lib/money/report-view";

/**
 * Filtered Reports export.
 *
 * Calls the SAME getReportData + selectReport the page uses, so (a) the workbook
 * can never disagree with the screen, and (b) the DAL's scopeAccountIds applies
 * identically — a user cannot export accounts they cannot see.
 */
export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  // proxy.ts already redirects the unauthenticated; this is defence in depth.
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const year = url.searchParams.get("year");
  if (!year) return new Response("Bad request: year is required", { status: 400 });

  const types = parseCategories(url.searchParams.get("types"));
  const sort = parseSort(url.searchParams.get("sort"), url.searchParams.get("dir"));
  const data = await getReportData({ id: Number(user.id), roles: user.roles }, year);
  const v = selectReport(data, types, sort);
  const labels = categoryLabels(types);

  // Every sheet restates the year and the filter, so an extracted sheet still
  // says what it is.
  const head = (section: string) => [
    [`Trackie — ${section}`],
    ["Academic year", year],
    ["Bill types", labels],
    [],
  ];

  const wb = XLSX.utils.book_new();
  const add = (name: string, aoa: (string | number)[][], cols: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  add(
    "Margin",
    [
      ...head("Margin & collections"),
      ["Account", "OEM", "Students", "Billed", "Received", "Outstanding", "Net margin"],
      ...v.rows.map((r) => [r.name, r.oem, r.students, r.billed, r.received, r.outstanding, r.netMargin]),
      [],
      ["TOTAL", "", v.totals.students, v.totals.billed, v.totals.received, v.totals.outstanding, v.totals.netMargin],
    ],
    [28, 14, 10, 14, 14, 14, 14],
  );

  add(
    "GST & TDS",
    [
      ...head("GST & TDS — set aside for government (reserves, not profit)"),
      ["Account", "Net GST payable", "TDS receivable", "TDS payable", "Advance TDS cost"],
      ...v.rows.map((r) => [r.name, r.netGst, r.tdsReceivable, r.tdsPayable, r.advanceTdsCost]),
      [],
      ["TOTAL", v.totals.netGst, v.totals.tdsReceivable, v.totals.tdsPayable, v.totals.advanceTdsCost],
    ],
    [28, 16, 16, 16, 16],
  );

  add(
    "OEM settlement",
    [
      ...head("OEM settlement — what we owe and have paid each OEM"),
      ["Account", "OEM", "Payable", "Paid to OEM", "Outstanding to OEM"],
      ...v.rows.map((r) => [r.name, r.oem, r.payable, r.paidToOem, r.outstandingToOem]),
      [],
      ["TOTAL", "", v.totals.payable, v.totals.paidToOem, v.totals.outstandingToOem],
    ],
    [28, 14, 16, 16, 18],
  );

  add(
    "By OEM",
    [
      ...head("Margin by OEM — net to Datagami"),
      ["OEM", "Billed", "Payable", "Net margin"],
      ...v.byOem.map((o) => [o.oem, o.billed, o.payable, o.netMargin]),
    ],
    [22, 16, 16, 16],
  );

  add(
    "Aging",
    [
      ...head("Receivables aging — outstanding by bucket"),
      ["Bucket", "Outstanding"],
      ["Current", v.aging.current],
      ["31–60 days", v.aging.d31_60],
      ["61–90 days", v.aging.d61_90],
      ["90+ days", v.aging.d90plus],
      [],
      ["Total outstanding", v.totals.outstanding],
    ],
    [22, 16],
  );

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Year labels carry an en-dash ("FY26–27"); slug to ASCII for the header.
  const safeYear = year.replace(/[^a-z0-9]+/gi, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trackie-report-${categorySlug(types)}-${safeYear}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
