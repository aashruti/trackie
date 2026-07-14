"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Money } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import type { GroupDetail } from "@/lib/dal/groups";
import type { Status } from "@/lib/money/types";
import { ProfitBadge } from "./groups-explorer";
import {
  addAccountsAction,
  deleteGroupAction,
  removeAccountAction,
  renameGroupAction,
} from "@/app/(app)/accounts/groups/actions";

export function GroupDetailView({
  detail,
  ungrouped,
  year,
}: {
  detail: GroupDetail;
  ungrouped: { id: number; name: string }[];
  year: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(detail.name);
  const [addId, setAddId] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return; }
      onOk?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => renameGroupAction(detail.id, name.trim()), () => setRenaming(false));
            }}
            className="flex items-center gap-2"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-lg font-semibold text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
              aria-label="Group name"
            />
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => { setRenaming(false); setName(detail.name); }} className="rounded-md border border-border-strong px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover">
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">{detail.name}</h1>
            <ProfitBadge net={detail.groupNet} />
            <button
              onClick={() => setRenaming(true)}
              disabled={pending}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
            >
              Rename
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete the group “${detail.name}”? Its ${detail.memberCount} account(s) stay intact — they just become ungrouped.`)) {
                  run(() => deleteGroupAction(detail.id), () => router.push("/accounts/groups"));
                }
              }}
              disabled={pending}
              className="rounded-md border border-[var(--negative-border)] px-2 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-40"
            >
              Delete group
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
          {error}
        </p>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Sales margin · ${year}`} value={detail.sales.netMargin} />
        <Kpi label="Delivery allocated · all time" value={detail.delivery.allocated} />
        <Kpi label="Delivery spent · all time" value={detail.delivery.spent} negative={detail.delivery.spent > detail.delivery.allocated} />
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Group net</div>
          <div className="mt-1 text-xl font-bold"><Money value={detail.groupNet} tone="auto" /></div>
          <div className="mt-0.5 text-[11px] text-text-muted">sales margin + delivery result (<Money value={detail.delivery.result} compact tone="auto" />)</div>
        </div>
      </div>

      {/* Members */}
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Member accounts <span className="tabular text-text-muted">({detail.memberCount})</span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="w-56">
              <Combobox
                options={ungrouped}
                value={addId}
                onChange={setAddId}
                placeholder="Add an account…"
              />
            </div>
            <button
              onClick={() => {
                if (!addId) { setError("Pick an account to add."); return; }
                run(() => addAccountsAction(detail.id, [Number(addId)]), () => setAddId(""));
              }}
              disabled={pending || !addId}
              className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2 font-semibold">Account</th>
              <th className="px-4 py-2 font-semibold">Type · OEM</th>
              <th className="px-4 py-2 text-right font-semibold">Billed</th>
              <th className="px-4 py-2 text-right font-semibold">Sales margin</th>
              <th className="px-4 py-2 text-right font-semibold">Delivery spent</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => (
              <tr key={m.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                <td className="px-4 py-2.5">
                  <Link href={`/accounts/${m.id}`} className="font-medium text-text-primary hover:underline">
                    {m.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary">{m.type} · {m.oem}</td>
                <td className="px-4 py-2.5 text-right"><Money value={m.billing} compact /></td>
                <td className="px-4 py-2.5 text-right"><Money value={m.netMargin} compact tone="auto" /></td>
                <td className="px-4 py-2.5 text-right"><Money value={m.deliverySpent} compact /></td>
                <td className="px-4 py-2.5"><StatusBadge status={m.status as Status} /></td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => {
                      if (confirm(`Remove “${m.name}” from the group? The account itself is untouched.`)) {
                        run(() => removeAccountAction(detail.id, m.id));
                      }
                    }}
                    disabled={pending}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-[var(--negative-subtle)] hover:text-[var(--negative-text)] disabled:opacity-40"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-text-muted">
        Sales figures are for {year}; delivery figures are all-time. Individual account pages are unchanged —
        this view only adds the cumulative lens.
      </p>
    </div>
  );
}

function Kpi({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold">
        <Money value={value} tone={negative ? "negative" : "default"} />
      </div>
    </div>
  );
}
