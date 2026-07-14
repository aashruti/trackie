"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProgramDetail } from "@/lib/dal/delivery/programs";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/lib/db/enums";
import { PROGRAM_STATUS_META } from "./meta";
import { setProgramStatusAction, updateProgramAction } from "@/app/(app)/delivery/programs/[id]/actions";
import { deleteProgramAction } from "@/app/(app)/delivery/programs/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

/**
 * Program lifecycle controls in the detail header: status pill picker, Edit
 * (name/provider/style/dates/budget/description — the account is fixed) and
 * Delete. Only rendered for canManageDelivery users; read-only visitors get
 * the static status chip instead.
 */
export function ProgramControls({
  program,
  methods,
  oems,
}: {
  program: Pick<
    ProgramDetail,
    "id" | "name" | "status" | "oemId" | "deliveryMethodId" | "accountId" | "startDate" | "endDate" | "totalBudget" | "description"
  >;
  methods: { id: number; name: string; code: string }[];
  oems: { id: number; name: string; isSelf: boolean }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const meta = PROGRAM_STATUS_META[program.status];

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
    <>
      <select
        aria-label="Program status"
        value={program.status}
        disabled={pending}
        onChange={(e) => run(() => setProgramStatusAction(program.id, e.target.value as ProgramStatus))}
        className="cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[var(--ring)]"
        style={{ background: meta.bg, color: meta.text, borderColor: meta.border }}
        title="Change program status"
      >
        {PROGRAM_STATUSES.map((s) => (
          <option key={s} value={s}>{PROGRAM_STATUS_META[s].label}</option>
        ))}
      </select>
      <button
        onClick={() => setEditing(true)}
        disabled={pending}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
      >
        Edit
      </button>
      <button
        onClick={() => {
          if (confirm(`Delete “${program.name}” with ALL its events and activity history? This can't be undone.`)) {
            run(() => deleteProgramAction(program.id), () => router.push("/delivery/programs"));
          }
        }}
        disabled={pending}
        className="rounded-md border border-[var(--negative-border)] px-2 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-40"
      >
        Delete
      </button>
      {error && (
        <span className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-2 py-1 text-xs text-[var(--negative-text)]">
          {error}
        </span>
      )}
      {editing && (
        <EditProgramDialog
          program={program}
          methods={methods}
          oems={oems}
          pending={pending}
          onSave={(input) => run(() => updateProgramAction(program.id, input), () => setEditing(false))}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function EditProgramDialog({
  program,
  methods,
  oems,
  pending,
  onSave,
  onClose,
}: {
  program: Pick<
    ProgramDetail,
    "id" | "name" | "status" | "oemId" | "deliveryMethodId" | "accountId" | "startDate" | "endDate" | "totalBudget" | "description"
  >;
  methods: { id: number; name: string; code: string }[];
  oems: { id: number; name: string; isSelf: boolean }[];
  pending: boolean;
  onSave: (input: {
    accountId: number;
    oemId: number;
    deliveryMethodId: number;
    name: string;
    description?: string;
    status?: ProgramStatus;
    startDate?: string;
    endDate?: string;
    totalBudget?: number | null;
  }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(program.name);
  const [oemId, setOemId] = useState(String(program.oemId));
  const [methodId, setMethodId] = useState(String(program.deliveryMethodId));
  const [startDate, setStartDate] = useState(program.startDate ?? "");
  const [endDate, setEndDate] = useState(program.endDate ?? "");
  const [totalBudget, setTotalBudget] = useState(program.totalBudget === null ? "" : String(program.totalBudget));
  const [description, setDescription] = useState(program.description ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
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
    setLocalError(null);
    if (!name.trim()) { setLocalError("Give the program a name."); return; }
    onSave({
      accountId: program.accountId,
      oemId: Number(oemId),
      deliveryMethodId: Number(methodId),
      name: name.trim(),
      status: program.status,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      totalBudget: totalBudget === "" ? null : Number(totalBudget),
      description: description.trim() || undefined,
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
        aria-labelledby="edit-program-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] w-full max-w-[500px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="edit-program-title" className="text-base font-bold tracking-tight text-text-primary">
            Edit program
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
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Provider</span>
              <select value={oemId} onChange={(e) => setOemId(e.target.value)} className={fieldCls}>
                {oems.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.isSelf ? " (own)" : ""}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Teaching style</span>
              <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={fieldCls}>
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
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Program budget ₹ <span className="font-normal">(optional)</span></span>
            <input type="number" min="0" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} className={fieldCls} />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Description <span className="font-normal">(optional)</span></span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={fieldCls} />
          </label>

          {localError && (
            <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">
              {localError}
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
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
