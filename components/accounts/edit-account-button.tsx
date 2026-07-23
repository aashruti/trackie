"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAccountAction } from "@/app/(app)/accounts/[id]/actions";
import type { OemRow } from "@/lib/dal/account-admin";

/**
 * Edit an account's structural details (name / type / city / OEM). Shown to
 * anyone who can reach the account detail page and edit it (super-admin, or
 * sales on an assigned account); the server action re-checks `canEdit`.
 */
export function EditAccountButton({
  accountId,
  initial,
  oems,
}: {
  accountId: number;
  initial: { name: string; type: string; city: string | null; oemId: number };
  oems: OemRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<"university" | "programme">(
    initial.type === "programme" ? "programme" : "university",
  );
  const [city, setCity] = useState(initial.city ?? "");
  const [oemId, setOemId] = useState(initial.oemId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  function close() {
    // Discard edits — reset to the current (saved) values on close.
    setName(initial.name);
    setType(initial.type === "programme" ? "programme" : "university");
    setCity(initial.city ?? "");
    setOemId(initial.oemId);
    setError(null);
    setOpen(false);
  }

  function save() {
    setError(null);
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    startTransition(async () => {
      const res = await updateAccountAction(accountId, {
        name,
        type,
        city: city.trim() ? city.trim() : null,
        oemId,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="no-print rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover"
      >
        Edit details
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-text-primary">Edit account details</h3>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">Account name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-text-secondary">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as "university" | "programme")}
                  className={inputCls}
                >
                  <option value="university">University</option>
                  <option value="programme">Programme</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-text-secondary">City (optional)</span>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Mumbai, MH"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-text-secondary">OEM</span>
                <select
                  value={oemId}
                  onChange={(e) => setOemId(Number(e.target.value))}
                  className={inputCls}
                >
                  {oems.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.isSelf ? " (own product)" : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-text-muted">
                  Changing to an &ldquo;own product&rdquo; OEM removes the external OEM transfer from billing.
                </span>
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-[var(--negative-text)]">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={close}
                disabled={pending}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
