"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeliveryMethodRow } from "@/lib/dal/delivery/methods";
import { createMethodAction, setMethodActiveAction, updateMethodAction } from "@/app/(app)/delivery/settings/actions";

const fieldCls =
  "rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-[var(--primary)] focus:outline-none";

export function DeliverySettingsManager({
  methods,
  canManage,
}: {
  methods: DeliveryMethodRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState({ name: "", code: "", description: "" });

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
    run(
      () => createMethodAction({ name: name.trim(), code: code.trim(), description: description.trim() || undefined }),
      () => { setName(""); setCode(""); setDescription(""); },
    );
  }

  function saveEdit(id: number) {
    setBusyId(id);
    run(
      () => updateMethodAction(id, { name: edit.name.trim(), code: edit.code.trim(), description: edit.description.trim() || undefined }),
      () => setEditId(null),
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text-primary">Teaching styles</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          How a program is delivered — e.g. <strong>D2S</strong> Direct to Students, <strong>T3</strong> Teach the
          Teacher. Attach one to each program. Styles in use can be deactivated (hidden from new programs) but not
          deleted, so history stays intact.
        </p>

        {canManage && (
          <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
            <label className="flex w-24 flex-col gap-1 text-xs font-medium text-text-secondary">
              Code
              <input type="text" value={code} maxLength={12} placeholder="D2S" onChange={(e) => setCode(e.target.value.toUpperCase())} className={fieldCls} />
            </label>
            <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium text-text-secondary">
              Name
              <input type="text" value={name} maxLength={120} placeholder="e.g. Direct to Students" onChange={(e) => setName(e.target.value)} className={fieldCls} />
            </label>
            <label className="flex min-w-[200px] flex-[2] flex-col gap-1 text-xs font-medium text-text-secondary">
              Description <span className="font-normal text-text-muted">(optional)</span>
              <input type="text" value={description} maxLength={300} placeholder="Who teaches whom" onChange={(e) => setDescription(e.target.value)} className={fieldCls} />
            </label>
            <button type="submit" disabled={pending}
              className="rounded-md bg-[var(--primary)] px-4 py-1.5 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--primary-hover)] disabled:opacity-50">
              Add style
            </button>
          </form>
        )}
        {error && <p className="mt-3 rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          {methods.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-muted">No teaching styles yet — add the first one above.</p>
          ) : (
            methods.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0">
                {editId === m.id ? (
                  <>
                    <input value={edit.code} maxLength={12} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} className={`${fieldCls} w-20`} aria-label="Code" />
                    <input value={edit.name} maxLength={120} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={`${fieldCls} min-w-[140px] flex-1`} aria-label="Name" />
                    <input value={edit.description} maxLength={300} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={`${fieldCls} min-w-[160px] flex-[2]`} aria-label="Description" placeholder="Description" />
                    <button disabled={pending} onClick={() => saveEdit(m.id)}
                      className="shrink-0 rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-semibold text-[var(--primary-fg)] disabled:opacity-50">
                      {busyId === m.id && pending ? "…" : "Save"}
                    </button>
                    <button disabled={pending} onClick={() => setEditId(null)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold ${m.active ? "border-[var(--primary-border)] bg-[var(--primary-subtle)] text-[var(--primary-text)]" : "border-border bg-surface-sunken text-text-muted"}`}>
                      {m.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium ${m.active ? "text-text-primary" : "text-text-muted"}`}>{m.name}</div>
                      {m.description && <div className="truncate text-xs text-text-muted">{m.description}</div>}
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-xs text-text-muted" title="Programs using this style">
                      {m.programCount} {m.programCount === 1 ? "program" : "programs"}
                    </span>
                    {!m.active && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">Inactive</span>}
                    {canManage && (
                      <>
                        <button disabled={pending} onClick={() => { setEditId(m.id); setEdit({ name: m.name, code: m.code, description: m.description ?? "" }); }}
                          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40">
                          Edit
                        </button>
                        <button disabled={pending}
                          onClick={() => {
                            if (m.active && m.programCount > 0 && !confirm(`Deactivate “${m.name}”? ${m.programCount} program(s) keep it, but new programs can't pick it.`)) return;
                            setBusyId(m.id);
                            run(() => setMethodActiveAction(m.id, !m.active));
                          }}
                          className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${m.active ? "border-[var(--negative-border)] text-[var(--negative-text)] hover:bg-[var(--negative-subtle)]" : "border-border text-text-secondary hover:bg-surface-hover"}`}>
                          {busyId === m.id && pending ? "…" : m.active ? "Deactivate" : "Activate"}
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
    </div>
  );
}
