"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

export interface Column<T> {
  key: keyof T;
  label: string;
  money?: boolean;
  tone?: "default" | "positive" | "negative" | "pending" | "info" | "auto";
  align?: "left" | "right";
}

export function ReportTable<T extends object>({
  title,
  subtitle,
  columns,
  rows,
  totals,
  sort,
  onSort,
}: {
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  rows: T[];
  totals?: Partial<Record<keyof T, number>> & { label?: string };
  sort?: { key: keyof T; dir: "asc" | "desc" };
  onSort?: (k: keyof T) => void;
}) {
  return (
    <Card className="print-card">
      <CardHeader title={title} subtitle={subtitle} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs text-text-muted">
              {columns.map((c) => {
                const right = c.align === "right" || c.money;
                const active = sort?.key === c.key;
                const arrow = active ? (sort!.dir === "asc" ? " ↑" : " ↓") : "";
                // aria-sort only makes sense on a sortable column, and only when a
                // sort is actually wired up (onSort present) — a table with no
                // onSort has nothing for a screen reader to announce here.
                const ariaSort = onSort
                  ? active
                    ? sort!.dir === "asc"
                      ? ("ascending" as const)
                      : ("descending" as const)
                    : ("none" as const)
                  : undefined;
                return (
                  <th
                    key={String(c.key)}
                    aria-sort={ariaSort}
                    className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}
                  >
                    {onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`select-none hover:text-text-primary ${active ? "text-text-primary" : ""}`}
                      >
                        {c.label}
                        {arrow}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                {columns.map((c) => (
                  <td
                    key={String(c.key)}
                    className={`px-4 py-2.5 ${c.align === "right" || c.money ? "text-right" : "text-left"} ${c.key === columns[0].key ? "font-medium text-text-primary" : "text-text-secondary"}`}
                  >
                    {c.money ? (
                      <Money value={r[c.key] as number} compact tone={c.tone ?? "default"} />
                    ) : (
                      String(r[c.key] ?? "")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t border-border-strong bg-surface-sunken font-semibold">
                {columns.map((c, i) => (
                  <td
                    key={String(c.key)}
                    className={`px-4 py-2.5 ${c.align === "right" || c.money ? "text-right" : "text-left"} text-text-primary`}
                  >
                    {i === 0
                      ? (totals.label ?? "Total")
                      : c.money && totals[c.key] != null
                        ? <Money value={totals[c.key] as number} compact tone={c.tone ?? "default"} />
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
