/**
 * Reconciliation — engine vs source Excel. One-off build-time validation for
 * user sign-off before seeding.
 *
 *  - Unambiguous figures (afterTds, payable) MUST match the Excel to the rupee.
 *  - netMargin is compared to the Excel's "Net To Datagami"; the difference is
 *    the advance double-count artifact in the Excel and is reported, not hidden.
 *
 * Run: npm run reconcile
 */
import * as XLSX from "xlsx";
import { parseSheet } from "./excel-parse";
import { computeInvoice } from "../lib/money/compute";
import { fmt } from "../lib/money/format";

const XLSX_PATH = "/Users/kunalsharma/Downloads/IBM UNIVERSITY  FULL DETAILS.xlsx";

function rowByLabel(grid: unknown[][], label: string): unknown[] | undefined {
  return grid.find(
    (r) =>
      typeof r?.[0] === "string" &&
      (r[0] as string).trim().toLowerCase().startsWith(label.toLowerCase()),
  );
}
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });

let unambiguousMismatches = 0;
let marginArtifactTotal = 0;
let engineGrandMargin = 0;

for (const sheetName of wb.SheetNames) {
  const parsed = parseSheet(XLSX_PATH, sheetName);
  if (parsed.invoices.length === 0) continue;

  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
  });
  const xAfterTds = rowByLabel(grid, "After Tds Total Amt") ?? [];
  const xPayable = rowByLabel(grid, "Payable To") ?? [];
  const xMargin = rowByLabel(grid, "Net To Datagami") ?? [];

  console.log(`\n=== ${parsed.account.name}  (${parsed.account.oem}) ===`);

  let engineMargin = 0;
  let excelMargin = 0;
  for (const inv of parsed.invoices) {
    const c = computeInvoice(inv);
    engineMargin += c.netMargin;

    const exAfter = n(xAfterTds[inv.sourceCol]);
    const exPay = n(xPayable[inv.sourceCol]);
    const exMar = n(xMargin[inv.sourceCol]);
    excelMargin += exMar;

    const afterOk = exAfter === 0 || near(c.afterTds, exAfter);
    const payOk = exPay === 0 || near(c.payable, exPay);
    if (!afterOk) unambiguousMismatches++;
    if (!payOk) unambiguousMismatches++;

    const flags = [
      afterOk ? "" : ` afterTds≠Excel(${fmt(exAfter)})`,
      payOk ? "" : ` payable≠Excel(${fmt(exPay)})`,
    ].join("");
    console.log(
      `  ${inv.category}/${inv.semester}  ` +
        `afterTds ${fmt(c.afterTds)}  payable ${fmt(c.payable)}  ` +
        `margin ${fmt(c.netMargin)}${flags}`,
    );
  }

  engineGrandMargin += engineMargin;
  const artifact = excelMargin - engineMargin;
  marginArtifactTotal += artifact;
  console.log(
    `  TOTAL  engine margin ${fmt(engineMargin)}   ` +
      `excel "Net To Datagami" ${fmt(excelMargin)}   ` +
      `delta ${fmt(artifact)} (advance/Excel artifact)`,
  );
}

console.log("\n──────────────────────────────────────────────");
console.log(`Engine grand total margin: ${fmt(engineGrandMargin)}`);
console.log(`Excel-vs-engine margin delta (artifact): ${fmt(marginArtifactTotal)}`);
console.log(
  unambiguousMismatches === 0
    ? "✓ All unambiguous figures (afterTds, payable) match the Excel to the rupee."
    : `✗ ${unambiguousMismatches} unambiguous mismatch(es) — investigate before seeding.`,
);
process.exit(0);
