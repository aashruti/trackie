"use client";

import { useState } from "react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import type { GroupRow } from "@/lib/dal/groups";
import { NewGroupDialog } from "./new-group-dialog";

/**
 * The grouped view: one row per account group with cumulative sales + delivery
 * numbers and the group-net verdict. Individual account views are unchanged —
 * this is purely an additional lens.
 */
export function GroupsExplorer({
  groups,
  ungrouped,
  year,
}: {
  groups: GroupRow[];
  ungrouped: { id: number; name: string }[];
  year: string;
}) {
  const [adding, setAdding] = useState(false);
  const groupedAccounts = groups.reduce((s, g) => s + g.memberCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">Grouped view</h1>
            <Link href="/accounts" className="text-sm text-text-secondary hover:text-text-primary">
              ← Individual accounts
            </Link>
          </div>
          <p className="mt-0.5 text-sm text-text-secondary">
            Accounts grouped by university — cumulative sales ({year}) and delivery (all time) numbers,
            and whether the institution as a whole is profitable.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
        >
          + New group
        </button>
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
        <span><span className="tabular text-[17px] font-extrabold">{groups.length}</span> <span className="text-text-muted">groups</span></span>
        <span><span className="tabular text-[17px] font-extrabold">{groupedAccounts}</span> <span className="text-text-muted">grouped accounts</span></span>
        <span><span className="tabular text-[17px] font-extrabold">{ungrouped.length}</span> <span className="text-text-muted">ungrouped</span></span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2.5 font-semibold">Group</th>
              <th className="px-4 py-2.5 text-right font-semibold">Accounts</th>
              <th className="px-4 py-2.5 text-right font-semibold">Billed</th>
              <th className="px-4 py-2.5 text-right font-semibold">Received</th>
              <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
              <th className="px-4 py-2.5 text-right font-semibold">Sales margin</th>
              <th className="px-4 py-2.5 text-right font-semibold">Delivery alloc · spent</th>
              <th className="px-4 py-2.5 text-right font-semibold">Delivery result</th>
              <th className="px-4 py-2.5 text-right font-semibold">Group net</th>
              <th className="px-4 py-2.5 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-text-muted">
                  No groups yet — create one to see cumulative university-level numbers.
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <tr key={g.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    <Link href={`/accounts/groups/${g.id}`} className="font-semibold text-text-primary hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{g.memberCount}</td>
                  <td className="px-4 py-3 text-right"><Money value={g.sales.billing} compact /></td>
                  <td className="px-4 py-3 text-right"><Money value={g.sales.received} compact tone="positive" /></td>
                  <td className="px-4 py-3 text-right"><Money value={g.sales.outstanding} compact tone="pending" /></td>
                  <td className="px-4 py-3 text-right"><Money value={g.sales.netMargin} compact tone="auto" /></td>
                  <td className="px-4 py-3 text-right text-xs text-text-secondary">
                    <Money value={g.delivery.allocated} compact /> · <Money value={g.delivery.spent} compact tone={g.delivery.spent > g.delivery.allocated ? "negative" : "default"} />
                  </td>
                  <td className="px-4 py-3 text-right"><Money value={g.delivery.result} compact tone="auto" /></td>
                  <td className="px-4 py-3 text-right font-semibold"><Money value={g.groupNet} compact tone="auto" /></td>
                  <td className="px-4 py-3">
                    <ProfitBadge net={g.groupNet} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        Group net = sales net margin ({year}) + delivery result (allocated − spent, all time).
      </p>

      {adding && <NewGroupDialog ungrouped={ungrouped} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function ProfitBadge({ net }: { net: number }) {
  const profitable = net >= 0;
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
      style={
        profitable
          ? { background: "var(--positive-subtle)", color: "var(--positive-text)", borderColor: "var(--positive-border)" }
          : { background: "var(--negative-subtle)", color: "var(--negative-text)", borderColor: "var(--negative-border)" }
      }
    >
      {profitable ? "Profitable" : "Loss-making"}
    </span>
  );
}
