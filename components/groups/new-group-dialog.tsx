"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/app/(app)/accounts/groups/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

/** Name the group and tick the (ungrouped) accounts that belong to it. */
export function NewGroupDialog({
  ungrouped,
  onClose,
}: {
  ungrouped: { id: number; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = filter.trim()
    ? ungrouped.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase()))
    : ungrouped;

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function submit() {
    setError(null);
    if (!name.trim()) { setError("Give the group a name (usually the university's name)."); return; }
    if (selected.size === 0) { setError("Tick at least one account."); return; }
    startTransition(async () => {
      const res = await createGroupAction(name.trim(), [...selected]);
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.push(`/accounts/groups/${res.id}`);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-group-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] w-full max-w-[460px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="new-group-title" className="text-base font-bold tracking-tight text-text-primary">
            New account group
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-muted hover:bg-surface-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Group name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. the university's name"
              className={fieldCls}
            />
          </label>

          <div>
            <span className="text-[11px] font-medium text-text-muted">
              Accounts to group <span className="font-normal">({selected.size} selected)</span>
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter accounts…"
              className={fieldCls}
            />
            <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
              {visible.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-text-muted">
                  {ungrouped.length === 0 ? "Every account is already grouped." : "No accounts match."}
                </p>
              ) : (
                visible.map((a) => (
                  <label key={a.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-text-primary hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                      className="h-4 w-4 accent-[var(--primary)]"
                    />
                    {a.name}
                  </label>
                ))
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
