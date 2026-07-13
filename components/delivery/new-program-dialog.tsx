"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgramAction } from "@/app/(app)/delivery/programs/actions";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/db/enums";
import { PROGRAM_STATUS_META } from "./meta";
import { Combobox } from "@/components/ui/combobox";

export type PickerOption = { id: number; name: string };

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function NewProgramDialog({
  accounts,
  oems,
  methods,
  onClose,
}: {
  accounts: PickerOption[];
  oems: { id: number; name: string; isSelf: boolean }[];
  methods: { id: number; name: string; code: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [oemId, setOemId] = useState("");
  const [methodId, setMethodId] = useState("");
  const [status, setStatus] = useState<ProgramStatus>("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [description, setDescription] = useState("");
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

  function submit() {
    setError(null);
    if (!name.trim()) { setError("Give the program a name."); return; }
    if (!accountId) { setError("Pick the account this program runs under."); return; }
    if (!oemId) { setError("Pick the provider (IBM, Datagami, …)."); return; }
    if (!methodId) { setError("Pick a teaching style."); return; }
    startTransition(async () => {
      const res = await createProgramAction({
        name: name.trim(),
        accountId: Number(accountId),
        oemId: Number(oemId),
        deliveryMethodId: Number(methodId),
        status,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        totalBudget: totalBudget === "" ? null : Number(totalBudget),
        description: description.trim() || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      onClose();
      router.push(`/delivery/programs/${res.id}`);
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
        aria-labelledby="new-program-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] w-full max-w-[500px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="new-program-title" className="text-base font-bold tracking-tight text-text-primary">
            New program
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
            <span className="text-[11px] font-medium text-text-muted">Program name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IBM D2S FY26–27"
              className={fieldCls}
            />
          </label>

          <div>
            <span className="text-[11px] font-medium text-text-muted">Account</span>
            <Combobox
              options={accounts}
              value={accountId}
              onChange={setAccountId}
              placeholder="Search accounts…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Provider</span>
              <select value={oemId} onChange={(e) => setOemId(e.target.value)} className={fieldCls}>
                <option value="">Pick provider…</option>
                {oems.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.isSelf ? " (own)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Teaching style</span>
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={fieldCls}>
                <option value="">Pick style…</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as ProgramStatus)} className={fieldCls}>
                {PROGRAM_STATUSES.map((s) => (
                  <option key={s} value={s}>{PROGRAM_STATUS_META[s].label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Program budget ₹ <span className="font-normal">(optional)</span></span>
              <input
                type="number"
                min="0"
                value={totalBudget}
                onChange={(e) => setTotalBudget(e.target.value)}
                placeholder="Overall envelope"
                className={fieldCls}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Description <span className="font-normal">(optional)</span></span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Scope, cohort, anything the team should know"
              className={fieldCls}
            />
          </label>

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
            {pending ? "Creating…" : "Create program"}
          </button>
        </div>
      </div>
    </div>
  );
}
