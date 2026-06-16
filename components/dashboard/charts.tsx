import { Card, CardHeader } from "@/components/ui/card";
import { fmtCompact } from "@/lib/money/format";
import type { Portfolio } from "@/lib/dal/portfolio";

/** Horizontal bar row. width is a 0–100 percentage. */
function Bar({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: number;
  pct: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 shrink-0 truncate text-xs text-text-secondary" title={label}>
        {label}
      </div>
      <div className="relative h-5 flex-1 rounded bg-surface-sunken">
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }}
        />
      </div>
      <div className="tabular w-16 shrink-0 text-right text-xs font-medium text-text-primary">
        {fmtCompact(value)}
      </div>
    </div>
  );
}

export function MarginByOemChart({ data }: { data: Portfolio["marginByOem"] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.margin)));
  return (
    <Card>
      <CardHeader title="Margin by OEM" subtitle="net to Datagami" />
      <div className="px-5 py-4">
        {data.map((d) => (
          <Bar
            key={d.oem}
            label={d.oem}
            value={d.margin}
            pct={(Math.abs(d.margin) / max) * 100}
            color={d.margin < 0 ? "var(--negative)" : "var(--primary)"}
          />
        ))}
      </div>
    </Card>
  );
}

export function TopAccountsChart({ rows }: { rows: Portfolio["rows"] }) {
  const top = [...rows].sort((a, b) => b.billed - a.billed).slice(0, 6);
  const max = Math.max(1, ...top.map((r) => r.billed));
  return (
    <Card>
      <CardHeader title="Top accounts" subtitle="by total billed" />
      <div className="px-5 py-4">
        {top.map((r) => (
          <Bar
            key={r.id}
            label={r.name}
            value={r.billed}
            pct={(r.billed / max) * 100}
            color="var(--info)"
          />
        ))}
      </div>
    </Card>
  );
}

export function AgingChart({ aging }: { aging: Portfolio["aging"] }) {
  const segs = [
    { label: "Current", value: aging.current, color: "var(--info)" },
    { label: "31–60 days", value: aging.d31_60, color: "var(--pending)" },
    { label: "61–90 days", value: aging.d61_90, color: "var(--pending)" },
    { label: "90+ days", value: aging.d90plus, color: "var(--negative)" },
  ];
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <Card>
      <CardHeader title="Receivables aging" subtitle="outstanding by bucket" />
      <div className="px-5 py-4">
        <div className="flex h-6 w-full overflow-hidden rounded">
          {segs.map(
            (s) =>
              s.value > 0 && (
                <div
                  key={s.label}
                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                  title={`${s.label}: ${fmtCompact(s.value)}`}
                />
              ),
          )}
        </div>
        <div className="mt-3 space-y-1">
          {segs.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="text-text-secondary">{s.label}</span>
              <span className="tabular ml-auto font-medium text-text-primary">
                {fmtCompact(s.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
