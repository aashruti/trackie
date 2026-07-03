import * as XLSX from "xlsx";
import { auth } from "@/lib/auth/config";
import { canManageHr } from "@/lib/dal/authz";
import { previewPayroll, getRunForCycle } from "@/lib/dal/hr/payroll";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user;
  const actor = user ? { id: Number(user.id), role: user.role } : null;
  if (!actor || !canManageHr(actor)) return new Response("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Response("Bad request", { status: 400 });
  }

  // Prefer the persisted run; fall back to the live preview if none was generated.
  const saved = await getRunForCycle(actor, year, month);
  const lines = saved ? saved.lines : (await previewPayroll(actor, year, month)).lines;
  const totals = saved
    ? saved.totals
    : lines.reduce((t, l) => ({ base: t.base + l.baseSalary, lop: t.lop + l.lopAmount, net: t.net + l.netPay }), { base: 0, lop: 0, net: 0 });

  const header = ["Code", "Employee", "Gross", "Basic", "HRA", "Other", "Per day", "Days worked", "Earned", "LOP days", "Insurance", "Prof. tax", "TDS", "Additions", "Net pay"];
  const body = lines.map((l) => [l.employeeCode, l.name, l.baseSalary, l.basic, l.hra, l.otherAllowance, l.perDay, l.daysWorked, l.earnedGross, l.lopDays, l.insurance, l.professionalTax, l.tds, l.additions, l.netPay]);
  const totalRow = ["", "TOTAL", totals.base, "", "", "", "", "", "", "", "", "", "", "", totals.net];
  const status = saved ? saved.run.status : "preview";

  const ws = XLSX.utils.aoa_to_sheet([
    [`Payroll — ${MONTHS[month - 1]} ${year} (${status})`],
    [],
    header,
    ...body,
    [],
    totalRow,
  ]);
  ws["!cols"] = [{ wch: 8 }, { wch: 22 }, ...Array(13).fill({ wch: 11 })];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${MONTHS[month - 1]} ${year}`);
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="payroll-${year}-${String(month).padStart(2, "0")}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
