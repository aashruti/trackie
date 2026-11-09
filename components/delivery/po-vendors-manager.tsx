"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAppDialog } from "@/components/ui/app-dialog";
import type { PoVendorRow } from "@/lib/dal/delivery/po-vendors";
import { createPoVendorAction, renamePoVendorAction, setPoVendorActiveAction } from "@/app/(app)/delivery/vendors/actions";

const fieldCls =
  "rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[var(--primary)] focus:outline-none";

/** Managed PO vendor list: add, rename, deactivate/reactivate. Never deleted. */
export function PoVendorsManager({ vendors, canManage }: { vendors: PoVendorRow[]; canManage: boolean }) {
  const router = useRouter();
  const { confirmAction } = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return; }
      onOk?.();
      router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(() => createPoVendorAction(name.trim()), () => setName(""));
  }

  function saveEdit(id: number) {
    setBusyId(id);
    run(() => renamePoVendorAction(id, editName.trim()), () => setEditId(null));
  }

  return (
    <section className="max-w-2xl rounded-xl border border-border bg-surface p-5">
      <p className="text-xs text-text-muted">
        Who issued the PO and is billed, for example a reseller. Any vendor can go with any provider. Vendors in use
        can be deactivated (hidden from new POs) but not deleted, so history stays intact.
      </p>

      {canManage && (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
            Name
            <input type="text" value={name} maxLength={160} placeholder="e.g. Acme Resellers Pvt Ltd" onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </label>
          <button type="submit" disabled={pending}
            className="rounded-md bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
            Add vendor
          </button>
        </form>
      )}
      {error && <p className="mt-3 rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>}

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        {vendors.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">No vendors yet{canManage ? ", add the first one above" : ""}.</p>
        ) : (
          vendors.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0">
              {editId === v.id ? (
                <>
                  <input value={editName} maxLength={160} onChange={(e) => setEditName(e.target.value)} className={`${fieldCls} min-w-[180px] flex-1`} aria-label="Vendor name" />
                  <button disabled={pending} onClick={() => saveEdit(v.id)}
                    className="shrink-0 rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-fg)] disabled:opacity-50">
                    {busyId === v.id && pending ? "…" : "Save"}
                  </button>
                  <button disabled={pending} onClick={() => setEditId(null)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className={`min-w-0 flex-1 text-sm font-medium ${v.active ? "text-text-primary" : "text-text-muted"}`}>{v.name}</div>
                  <span className="shrink-0 rounded-full bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-xs text-text-muted" title="POs using this vendor">
                    {v.poCount} {v.poCount === 1 ? "PO" : "POs"}
                  </span>
                  {!v.active && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">Inactive</span>}
                  {canManage && (
                    <>
                      <button disabled={pending} onClick={() => { setEditId(v.id); setEditName(v.name); }}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40">
                        Rename
                      </button>
                      <button disabled={pending}
                        onClick={async () => {
                          if (v.active && v.poCount > 0) {
                            const confirmed = await confirmAction({
                              title: `Deactivate “${v.name}”?`,
                              description: `${v.poCount} PO(s) will keep this vendor, but new POs will not be able to select it.`,
                              confirmLabel: "Deactivate",
                              tone: "danger",
                            });
                            if (!confirmed) return;
                          }
                          setBusyId(v.id);
                          run(() => setPoVendorActiveAction(v.id, !v.active));
                        }}
                        className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${v.active ? "border-[var(--negative-border)] text-[var(--negative-text)] hover:bg-[var(--negative-subtle)]" : "border-border text-text-secondary hover:bg-surface-hover"}`}>
                        {busyId === v.id && pending ? "…" : v.active ? "Deactivate" : "Activate"}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
