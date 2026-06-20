"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction } from "@/app/(app)/accounts/[id]/actions";

export function DeleteAccountButton({
  accountId,
  accountName,
}: {
  accountId: number;
  accountName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      await deleteAccountAction(accountId);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--negative-border)] px-3 py-1.5 text-sm font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)]"
      >
        Delete account
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-text-primary">Delete account?</h3>
            <p className="mt-2 text-sm text-text-secondary">
              This will permanently delete{" "}
              <span className="font-medium text-text-primary">{accountName}</span> and all
              its invoices, payments, and cohort data. Tasks linked to this account will
              be unlinked (not deleted). This cannot be undone.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={pending}
                className="rounded-md bg-[var(--negative)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
