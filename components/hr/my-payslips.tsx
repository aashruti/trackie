import type { MyPayslip } from "@/lib/dal/hr/payroll";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function MyPayslipsView({ slips }: { slips: MyPayslip[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">My payslips</h2>
        <p className="mt-0.5 text-sm text-text-secondary">Finalized monthly salary statements.</p>
      </div>

      {slips.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No payslips yet.</div>
      ) : (
        <div className="space-y-5">
          {slips.map((s) => <Payslip key={s.runId} slip={s} />)}
        </div>
      )}
    </div>
  );
}

function Payslip({ slip: s }: { slip: MyPayslip }) {
  const deductions = s.lopAmount + s.insurance + s.professionalTax + s.tds;
  const earnings = s.baseSalary + s.additions;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <header className="border-b border-border bg-surface-sunken px-5 py-4 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">Datagami HR</div>
        <h3 className="mt-1 text-lg font-semibold text-text-primary">Pay Slip for {MONTHS[s.month - 1]} {s.year}</h3>
        <p className="mt-0.5 text-xs text-text-muted">Salary period {iso(s.cycleStart)} to {iso(s.cycleEnd)}</p>
      </header>

      <div className="grid border-b border-border md:grid-cols-2">
        <section className="space-y-1.5 px-5 py-4 md:border-r md:border-border">
          <SectionTitle>Employee details</SectionTitle>
          <Detail label="Name" value={s.employeeName} />
          <Detail label="Employee code" value={s.employeeCode} />
          <Detail label="Designation" value={s.designation ?? "—"} />
          <Detail label="Date of joining" value={s.dateOfJoining ? iso(s.dateOfJoining) : "—"} />
        </section>
        <section className="space-y-1.5 px-5 py-4">
          <SectionTitle>Attendance details</SectionTitle>
          <Detail label="Payable days" value={`${s.daysWorked} / 30`} />
          <Detail label="Present days" value={String(s.presentDays)} />
          <Detail label="Paid leave days" value={String(s.paidLeaveDays)} />
          <Detail label="Loss of pay days" value={String(s.lopDays)} tone={s.lopDays ? "text-[var(--negative-text)]" : undefined} />
        </section>
      </div>

      <div className="grid md:grid-cols-2">
        <SalaryTable
          title="Earnings"
          rows={[
            ["Basic (40% of Gross)", s.basic],
            ["HRA (40% of Basic)", s.hra],
            ["Other Allowance (remainder)", s.otherAllowance],
            ...(s.additions ? [["Additions", s.additions] as [string, number]] : []),
          ]}
          totalLabel="Total earnings"
          total={earnings}
          className="md:border-r md:border-border"
        />
        <SalaryTable
          title="Deductions"
          rows={[
            ["Insurance", s.insurance],
            ["Professional Tax", s.professionalTax],
            ["Tax Deduction", s.tds],
            ...(s.lopAmount ? [["Loss of Pay", s.lopAmount] as [string, number]] : []),
          ]}
          totalLabel="Total deductions"
          total={deductions}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-sunken px-5 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Earned after LOP</div>
          <div className="text-sm font-medium text-text-secondary">{inr(s.earnedGross)}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Net pay</div>
          <div className="text-xl font-semibold tabular text-[var(--positive-text)]">{inr(s.netPay)}</div>
        </div>
        <p className="w-full border-t border-border-subtle pt-3 text-center text-[11px] text-text-muted">
          This is a computer-generated payslip and does not require a signature.
        </p>
      </footer>
    </article>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-primary">{children}</h4>;
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={`font-medium ${tone ?? "text-text-primary"}`}>{value}</span>
    </div>
  );
}

function SalaryTable({
  title,
  rows,
  totalLabel,
  total,
  className,
}: {
  title: string;
  rows: [string, number][];
  totalLabel: string;
  total: number;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="border-b border-border bg-surface-sunken px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-primary">{title}</div>
      <div className="px-5 py-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span className="tabular text-text-primary">{inr(value)}</span>
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-sm font-semibold">
          <span className="text-text-primary">{totalLabel}</span>
          <span className="tabular text-text-primary">{inr(total)}</span>
        </div>
      </div>
    </section>
  );
}
