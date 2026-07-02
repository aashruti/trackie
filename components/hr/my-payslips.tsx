import type { MyPayslip } from "@/lib/dal/hr/payroll";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const iso = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

export function MyPayslipsView({ slips }: { slips: MyPayslip[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">My payslips</h2>
        <p className="mt-0.5 text-sm text-text-secondary">Finalized monthly payslips. Draft runs stay hidden until HR locks them.</p>
      </div>

      {slips.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center text-sm text-text-muted">No payslips yet.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {slips.map((s) => (
            <div key={s.runId} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{MONTHS[s.month - 1]} {s.year}</div>
                  <div className="text-[11px] text-text-muted">{iso(s.cycleStart)} – {iso(s.cycleEnd)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Net pay</div>
                  <div className="text-lg font-semibold tabular text-[var(--positive-text)]">{inr(s.netPay)}</div>
                </div>
              </div>
              <dl className="mt-3 space-y-1 border-t border-border-subtle pt-3 text-sm">
                <Row k="Gross salary" v={inr(s.baseSalary)} />
                <Row k="Per day (÷30)" v={inr(s.perDay)} />
                <Row k="Days worked" v={`${s.daysWorked} / 30`} />
                <Row k="Earned" v={inr(s.earnedGross)} />
                {s.lopDays > 0 && (
                  <Row k="Loss of pay" v={`${s.lopDays} day${s.lopDays === 1 ? "" : "s"} · − ${inr(s.lopAmount)}`} tone="text-[var(--negative-text)]" />
                )}
                {s.insurance > 0 && <Row k="Insurance" v={`− ${inr(s.insurance)}`} tone="text-[var(--negative-text)]" />}
                {s.professionalTax > 0 && <Row k="Professional tax" v={`− ${inr(s.professionalTax)}`} tone="text-[var(--negative-text)]" />}
                {s.tds > 0 && <Row k="TDS" v={`− ${inr(s.tds)}`} tone="text-[var(--negative-text)]" />}
                {s.additions > 0 && <Row k="Additions" v={`+ ${inr(s.additions)}`} tone="text-[var(--positive-text)]" />}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-text-secondary">{k}</dt>
      <dd className={`tabular ${tone ?? "text-text-primary"}`}>{v}</dd>
    </div>
  );
}
