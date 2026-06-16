import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import type { PortfolioRow } from "@/lib/dal/portfolio";

export function AccountsTable({ rows }: { rows: PortfolioRow[] }) {
  return (
    <Card>
      <CardHeader
        title="All accounts"
        subtitle={`${rows.length} accounts`}
        action={
          <Link
            href="/accounts"
            className="text-xs font-medium text-[var(--primary-text)] hover:underline"
          >
            View all
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
              <th className="px-5 py-2.5 font-medium">Account</th>
              <th className="px-3 py-2.5 font-medium">OEM</th>
              <th className="px-3 py-2.5 text-right font-medium">Billed</th>
              <th className="px-3 py-2.5 text-right font-medium">Received</th>
              <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
              <th className="px-3 py-2.5 text-right font-medium">Net margin</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border-subtle last:border-0 hover:bg-surface-hover"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/accounts/${r.id}`}
                    className="font-medium text-text-primary hover:text-[var(--primary-text)]"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-3 text-text-secondary">{r.oem}</td>
                <td className="px-3 py-3 text-right">
                  <Money value={r.billed} compact />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money value={r.received} compact tone="positive" />
                </td>
                <td className="px-3 py-3 text-right">
                  <Money value={r.outstanding} compact tone="pending" />
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="inline-flex items-center gap-1.5">
                    {r.hasNegative && (
                      <span className="rounded bg-[var(--negative-subtle)] px-1 text-[10px] font-semibold text-[var(--negative-text)]">
                        loss
                      </span>
                    )}
                    <Money value={r.netMargin} compact tone="auto" />
                  </span>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
