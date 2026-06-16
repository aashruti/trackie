import * as XLSX from "xlsx";
import type { Category, Semester, Status } from "../lib/money/types";

export interface ParsedCohort {
  enrollmentYear: string;
  count: number;
}

export interface ParsedInvoice {
  category: Category;
  semester: Semester;
  students: number;
  priceToUni: number;
  priceToDatagami: number;
  gstRate: number;
  tdsRate: number;
  advanceAdj: number;
  invoiceDate: string | null;
  status: Status;
  cohorts: ParsedCohort[];
}

export interface ParsedSheet {
  account: { name: string; oem: string; type: "university" | "programme" };
  invoices: ParsedInvoice[];
}

type Grid = unknown[][];

function rowByLabel(grid: Grid, label: string): unknown[] | undefined {
  return grid.find(
    (r) =>
      typeof r?.[0] === "string" &&
      (r[0] as string).trim().toLowerCase().startsWith(label.toLowerCase()),
  );
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function toISODate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Parse one university/programme sheet into account meta + a list of invoices
 * (one per category × semester column-group), with cohorts and advance netting.
 *
 * Verified sheet layout (consistent across all 21 tabs):
 *  - Row 1: account name.
 *  - Row 2: column headers ("Advance Bill", "Old Stu Number", "New Stu Number").
 *  - Row 3: sub-headers ("1st Sem"/"2nd Sem") when semester-split.
 *  - Cols B/C of "Total Taxable Amt" = priceToUni / priceToDatagami.
 *  - Per category-column: "Total Students" = students; "Total Taxable Amt" of an
 *    advance column = the advance amount.
 *  - Cohort rows: labels matching /^20\d\d-\d\d/ — per-column value = that cohort.
 *  - Advance attaches to the student column whose "Trf Amt To <OEM>" was reduced.
 */
export function parseSheet(path: string, sheetName: string): ParsedSheet {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });

  const rawName = String(grid[0]?.[0] ?? sheetName).trim();
  const type: "university" | "programme" = /programme|prog/i.test(rawName)
    ? "programme"
    : "university";

  const hdr = (grid[1] ?? []).map((c) => String(c ?? "").trim());
  const sub = (grid[2] ?? []).map((c) => String(c ?? "").trim());

  const trfLabelRow = grid.find(
    (r) => typeof r?.[0] === "string" && /trf amt to/i.test(r[0] as string),
  );
  const oem = trfLabelRow
    ? String(trfLabelRow[0]).replace(/trf amt to/i, "").trim()
    : "IBM";

  const totalTaxable = rowByLabel(grid, "Total Taxable Amt") ?? [];
  const totalStudents = rowByLabel(grid, "Total Students") ?? [];
  const trfAmt = rowByLabel(grid, "Trf Amt To") ?? [];
  const invoiceDateRow = rowByLabel(grid, "Invoice date") ?? [];
  const cohortRows = grid.filter(
    (r) => typeof r?.[0] === "string" && /^20\d\d-\d\d/.test((r[0] as string).trim()),
  );

  const priceToUni = num(totalTaxable[1]);
  const priceToDatagami = num(totalTaxable[2]);

  const invoices: ParsedInvoice[] = [];

  for (let col = 3; col < hdr.length; col++) {
    const head = hdr[col];
    if (!head) continue;

    let category: Category | null = null;
    if (/advance/i.test(head)) category = "advance";
    else if (/old stu/i.test(head)) category = "old";
    else if (/new stu/i.test(head)) category = "new";
    if (!category) continue;

    const semester: Semester = /1st/i.test(sub[col])
      ? "1"
      : /2nd/i.test(sub[col])
        ? "2"
        : "none";

    const invoiceDate = toISODate(invoiceDateRow[col]);

    if (category === "advance") {
      const advAmount = num(totalTaxable[col]);
      if (advAmount <= 0) continue; // some sheets have no advance
      invoices.push({
        category,
        semester,
        students: 1,
        priceToUni: advAmount,
        priceToDatagami: advAmount,
        gstRate: 0.18,
        tdsRate: 0.1,
        advanceAdj: 0,
        invoiceDate,
        status: "raised",
        cohorts: [],
      });
      continue;
    }

    const students = num(totalStudents[col]);
    if (students <= 0) continue;

    // Advance attaches to the student column whose OEM transfer was reduced.
    const expectedOut = students * priceToDatagami;
    const actualOut = num(trfAmt[col]);
    const advanceAdj =
      actualOut > 0 && actualOut < expectedOut ? expectedOut - actualOut : 0;

    const cohorts: ParsedCohort[] =
      category === "old"
        ? cohortRows
            .map((r) => ({
              enrollmentYear: String(r[0]).trim(),
              count: num(r[col]),
            }))
            .filter((c) => c.count > 0)
        : [];

    invoices.push({
      category,
      semester,
      students,
      priceToUni,
      priceToDatagami,
      gstRate: 0.18,
      tdsRate: 0.1,
      advanceAdj,
      invoiceDate,
      status: "raised",
      cohorts,
    });
  }

  return { account: { name: rawName, oem, type }, invoices };
}
