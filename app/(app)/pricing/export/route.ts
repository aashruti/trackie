import * as XLSX from "xlsx";
import { auth } from "@/lib/auth/config";
import { canViewFinance } from "@/lib/dal/authz";
import { getPricingMaster } from "@/lib/dal/pricing-master";
import { yearOfStudy } from "@/lib/fy";
import { computeInvoice } from "@/lib/money/compute";
import { statusMeta } from "@/lib/money/format";
import { streamLabel } from "@/lib/money/report-view";
import type { Category, Semester, Status } from "@/lib/money/types";

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user) return new Response("Unauthorized", { status: 401 });
  const actor = { id: Number(user.id), roles: user.roles };
  if (!canViewFinance(actor)) return new Response("Forbidden", { status: 403 });

  const year = new URL(req.url).searchParams.get("year")?.trim();
  if (!year) return new Response("Bad request: year is required", { status: 400 });

  // Reuse the page's DAL so account scoping and student-stream selection match.
  const rows = await getPricingMaster(actor, year);
  const streams: (string | number)[][] = [];
  const batches: (string | number)[][] = [];
  for (const account of rows) {
    for (const invoice of account.invoices) {
      const students = invoice.batches.length
        ? invoice.batches.reduce((sum, batch) => sum + batch.count, 0)
        : invoice.students;
      const computed = computeInvoice({
        ...invoice,
        category: invoice.category as Category,
        semester: invoice.semester as Semester,
        students,
        cohortPricing: invoice.batches,
      });
      const stream = streamLabel(invoice.category, invoice.semester);
      streams.push([
        account.accountName, stream, students, invoice.priceToUni,
        invoice.priceToDatagami, computed.billing, computed.netMargin,
        statusMeta(invoice.status as Status)[1],
      ]);
      for (const batch of invoice.batches) {
        batches.push([
          account.accountName, stream, batch.enrollmentYear,
          yearOfStudy(batch.enrollmentYear, year) ?? "", batch.count,
          batch.priceToUni ?? "", batch.priceToDatagami ?? "",
          batch.priceToUni ?? invoice.priceToUni,
          batch.priceToDatagami ?? invoice.priceToDatagami,
        ]);
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  function addSheet(
    name: string,
    note: string,
    headers: string[],
    data: (string | number)[][],
    widths: number[],
    moneyColumns: number[],
  ) {
    const sheet = XLSX.utils.aoa_to_sheet([
      [`Trackie — Pricing master · ${name}`],
      ["Academic year", year!],
      [note],
      [],
      headers,
      ...data,
    ]);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({
      s: { r: 4, c: 0 }, e: { r: 4 + data.length, c: headers.length - 1 },
    }) };
    for (let r = 5; r < 5 + data.length; r++) {
      for (const c of moneyColumns) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === "n") cell.z = '#,##0.00';
      }
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }

  addSheet(
    "Streams",
    "Saved pricing for all accessible accounts. Amounts in INR; prices are per student.",
    ["Account", "Stream", "Students", "Price / uni", "Price / Datagami", "Billing", "Margin", "Status"],
    streams, [32, 28, 12, 18, 20, 20, 20, 18], [3, 4, 5, 6],
  );
  addSheet(
    "Batches",
    "Amounts in INR. Blank batch prices inherit the stream price; effective prices show the amount used.",
    ["Account", "Stream", "Enrollment year", "Year of study", "Students",
      "Batch price / uni", "Batch price / Datagami", "Effective price / uni", "Effective price / Datagami"],
    batches, [32, 28, 18, 18, 12, 22, 26, 24, 28], [5, 6, 7, 8],
  );

  const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const safeYear = year.replace(/[^a-z0-9]+/gi, "-");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trackie-pricing-master-${safeYear}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
