"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { statusMeta } from "@/lib/money/format";
import type { Status } from "@/lib/money/types";

export interface AccountRow {
  id: number;
  name: string;
  oem: string;
  billing: number;
  received: number;
  outstanding: number;
  netMargin: number;
  hasNegative: boolean;
  status: Status;
}

const PAGE_SIZE = 10;
const STATUSES: Status[] = ["raised", "partially-paid", "paid", "overdue"];

function toCsv(rows: AccountRow[]): string {
  const head = ["Account", "OEM", "Billed", "Received", "Outstanding", "Net margin", "Status"];
  const body = rows.map((r) =>
    [r.name, r.oem, r.billing, r.received, r.outstanding, r.netMargin, r.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}

export function AccountsExplorer({ rows, canCreate = false }: { rows: AccountRow[]; canCreate?: boolean }) {
  const [query, setQuery] = useState("");
  const [oem, setOem] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const oems = useMemo(() => [...new Set(rows.map((r) => r.oem))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || r.name.toLowerCase().includes(q)) &&
        (oem === "all" || r.oem === oem) &&
        (status === "all" || r.status === status),
    );
  }, [rows, query, oem, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trackie-accounts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectCls =
    "rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search accounts…"
          className={`${selectCls} min-w-[220px] flex-1`}
          aria-label="Search accounts"
        />
        <select
          value={oem}
          onChange={(e) => {
            setOem(e.target.value);
            setPage(1);
          }}
          className={selectCls}
          aria-label="Filter by OEM"
        >
          <option value="all">All OEMs</option>
          {oems.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className={selectCls}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusMeta(s)[1]}
            </option>
          ))}
        </select>
        <button
          onClick={exportCsv}
          className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover"
        >
          Export CSV
        </button>
        {canCreate ? (
          <Link
            href="/accounts/new"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            Add account
          </Link>
        ) : (
          <button
            disabled
            className="cursor-not-allowed rounded-md bg-[var(--primary-subtle)] px-3 py-2 text-sm font-medium text-text-muted"
            title="Super Admin only"
          >
            Add account
          </button>
        )}
      </div>

      <Card>
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
              {pageRows.map((r) => (
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
                    <Money value={r.billing} compact />
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
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-text-muted">
                    No accounts match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3 text-xs text-text-secondary">
          <span>
            {filtered.length === 0
              ? "0 results"
              : `${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current <= 1}
              className="rounded-md border border-border-strong px-2.5 py-1 font-medium disabled:opacity-40 enabled:hover:bg-surface-hover"
            >
              Prev
            </button>
            <span>
              Page {current} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={current >= pageCount}
              className="rounded-md border border-border-strong px-2.5 py-1 font-medium disabled:opacity-40 enabled:hover:bg-surface-hover"
            >
              Next
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
