"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addTaskAction } from "@/app/(app)/team/actions";
import { TASK_PRIORITIES, type TaskBoard, type TaskPriority, type TaskStatus } from "@/lib/db/enums";
import { TASK_COLUMNS, type Option, type ProgramOption } from "@/lib/board/constants";
import { Combobox } from "@/components/ui/combobox";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function NewTaskDialog({
  accounts,
  users,
  programs = [],
  board = "team",
  defaultStatus = "backlog",
  onClose,
}: {
  accounts: Option[];
  users: Option[];
  programs?: ProgramOption[];
  board?: TaskBoard;
  defaultStatus?: TaskStatus;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState<string>(""); // "" → Internal
  const [programId, setProgramId] = useState<string>(""); // "" → no program (delivery board)
  const [assigneeId, setAssigneeId] = useState<string>(""); // "" → Unassigned
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
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
    if (!title.trim()) {
      setError("Give the task a title.");
      return;
    }
    startTransition(async () => {
      try {
        await addTaskAction({
          title: title.trim(),
          accountId: accountId ? Number(accountId) : null,
          assigneeId: assigneeId ? Number(assigneeId) : null,
          status,
          priority,
          startDate: startDate || null,
          dueDate: dueDate || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          board,
          programId: programId ? Number(programId) : null,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create task");
      }
    });
  }

  // Picking a program pins the account to the program's account.
  function pickProgram(value: string) {
    setProgramId(value);
    if (value) {
      const program = programs.find((p) => String(p.id) === value);
      if (program) setAccountId(String(program.accountId));
    }
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
        aria-labelledby="new-task-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[6vh] w-full max-w-[460px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 id="new-task-title" className="text-base font-bold tracking-tight text-text-primary">
            New task
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
            <span className="text-[11px] font-medium text-text-muted">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className={fieldCls}
            />
          </label>

          {board === "delivery" && (
            <div>
              <span className="text-[11px] font-medium text-text-muted">Program</span>
              <Combobox
                options={programs.map((p) => ({ id: p.id, name: p.name }))}
                value={programId}
                onChange={pickProgram}
                emptyLabel="No program"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[11px] font-medium text-text-muted">Account</span>
              <Combobox
                options={accounts.map((a) => ({ id: a.id, name: a.name }))}
                value={accountId}
                onChange={(v) => {
                  setAccountId(v);
                  // Changing the account manually detaches a mismatched program.
                  if (programId) {
                    const program = programs.find((p) => String(p.id) === programId);
                    if (program && String(program.accountId) !== v) setProgramId("");
                  }
                }}
                emptyLabel="Internal"
              />
            </div>
            <div>
              <span className="text-[11px] font-medium text-text-muted">Assignee</span>
              <Combobox
                options={users.map((u) => ({ id: u.id, name: u.name }))}
                value={assigneeId}
                onChange={setAssigneeId}
                emptyLabel="Unassigned"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={fieldCls}>
                {TASK_COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={fieldCls}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-text-muted">Due date</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={startDate || undefined} className={fieldCls} />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-medium text-text-muted">Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Comma-separated, e.g. GST, Review" className={fieldCls} />
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
            {pending ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
