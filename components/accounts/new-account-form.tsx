"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { createAccountAction } from "@/app/(app)/accounts/new/actions";
import type { OemRow } from "@/lib/dal/account-admin";

export function NewAccountForm({ oems }: { oems: OemRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"university" | "programme">("university");
  const [city, setCity] = useState("");
  const [oemChoice, setOemChoice] = useState<string>(oems[0] ? String(oems[0].id) : "new");
  const [newOemName, setNewOemName] = useState("");
  const [newOemIsSelf, setNewOemIsSelf] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isNewOem = oemChoice === "new";
  const inputCls =
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Account name is required.");
      return;
    }
    startTransition(async () => {
      try {
        await createAccountAction({
          name,
          type,
          city: city || null,
          oemId: isNewOem ? undefined : Number(oemChoice),
          newOemName: isNewOem ? newOemName : undefined,
          newOemIsSelf: isNewOem ? newOemIsSelf : undefined,
        });
        // createAccountAction redirects on success
      } catch (e) {
        // Next's redirect throws a special error — ignore it.
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) return;
        setError(e instanceof Error ? e.message : "Failed to create account");
      }
    });
  }

  return (
    <Card className="max-w-2xl p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-text-secondary">Account name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Acme University" />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as "university" | "programme")} className={inputCls}>
            <option value="university">University</option>
            <option value="programme">Programme</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-text-secondary">City (optional)</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} placeholder="e.g. Mumbai, MH" />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-text-secondary">OEM</span>
          <select value={oemChoice} onChange={(e) => setOemChoice(e.target.value)} className={inputCls}>
            {oems.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.isSelf ? " (own product)" : ""}
              </option>
            ))}
            <option value="new">+ Add new OEM…</option>
          </select>
        </label>

        {isNewOem && (
          <div className="sm:col-span-2 rounded-lg bg-surface-sunken p-4">
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">New OEM name</span>
              <input value={newOemName} onChange={(e) => setNewOemName(e.target.value)} className={inputCls} placeholder="e.g. AAFM, or Datagami" />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={newOemIsSelf} onChange={(e) => setNewOemIsSelf(e.target.checked)} />
              This is Datagami&apos;s own product (no external OEM transfer)
            </label>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--negative-text)]">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={() => router.push("/accounts")} className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button onClick={submit} disabled={pending} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Creating…" : "Create account"}
        </button>
      </div>
    </Card>
  );
}
