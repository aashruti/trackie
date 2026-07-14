"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import {
  PRIORITY_META,
  STATUS_META,
  TASK_COLUMNS,
  type TaskDetailRow,
} from "@/lib/board/constants";
import { TASK_COMMENT_KINDS, TASK_PRIORITIES, type TaskStatus, type TaskPriority, type TaskCommentKind } from "@/lib/db/enums";
import { fmtDay, fmtDayYear } from "@/lib/dates";

const KIND_LABEL: Record<TaskCommentKind, string> = { worklog: "Worklog", comment: "Comment" };

export function TaskDetailDialog({
  task,
  pending,
  onClose,
  onSetStatus,
  onSetPriority,
  onComment,
}: {
  task: TaskDetailRow;
  pending: boolean;
  onClose: () => void;
  onSetStatus: (status: TaskStatus) => void;
  onSetPriority: (priority: TaskPriority) => void;
  onComment: (input: { kind: TaskCommentKind; body: string }) => void;
}) {
  const [kind, setKind] = useState<TaskCommentKind>("worklog");
  const [body, setBody] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const p = PRIORITY_META[task.priority];
  const s = STATUS_META[task.status];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    onComment({ kind, body: text });
    setBody("");
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
        aria-labelledby="task-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[4vh] flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        {/* Head */}
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h2 id="task-dialog-title" className="text-base font-bold leading-snug tracking-tight text-text-primary">
                {task.title}
              </h2>
            </div>
            <p className="text-xs text-text-muted">
              {task.accountName ?? "Internal"}
              {task.programName ? ` · ${task.programName}` : task.oem ? ` · ${task.oem}` : ""}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: s.bg, color: s.text, borderColor: s.border }}
          >
            {s.label}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Facts */}
          <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-[10px] border border-border">
            <Fact label="Assignee">
              {task.assigneeName ? (
                <span className="flex items-center gap-1.5">
                  <Avatar name={task.assigneeName} size={20} />
                  <span className="truncate text-[13px] font-semibold text-text-primary">{task.assigneeName}</span>
                </span>
              ) : (
                <span className="text-[13px] text-text-muted">Unassigned</span>
              )}
            </Fact>
            <Fact label="Priority">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: p.text }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                {p.label}
              </span>
            </Fact>
            <Fact label="Dates" last>
              <span className="tabular text-[13px] font-semibold text-text-primary">
                {task.startDate || task.dueDate ? `${fmtDay(task.startDate) || "—"} → ${fmtDay(task.dueDate) || "—"}` : "—"}
              </span>
            </Fact>
          </div>

          {/* Status picker (lifecycle) */}
          <div className="mb-[18px]">
            <Overline>Status</Overline>
            <div className="flex flex-wrap gap-1.5">
              {TASK_COLUMNS.map((c) => {
                const active = c.id === task.status;
                const m = STATUS_META[c.id];
                return (
                  <button
                    key={c.id}
                    onClick={() => onSetStatus(c.id)}
                    disabled={pending}
                    aria-pressed={active}
                    className="rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
                    style={{
                      borderColor: active ? m.text : "var(--border)",
                      background: active ? m.bg : "var(--surface)",
                      color: active ? m.text : "var(--text-secondary)",
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority picker */}
          <div className="mb-[18px]">
            <Overline>Priority</Overline>
            <div className="flex flex-wrap gap-1.5">
              {TASK_PRIORITIES.map((pr) => {
                const active = pr === task.priority;
                const m = PRIORITY_META[pr];
                return (
                  <button
                    key={pr}
                    onClick={() => onSetPriority(pr)}
                    disabled={pending}
                    aria-pressed={active}
                    className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
                    style={{
                      borderColor: active ? m.color : "var(--border)",
                      background: active ? m.bg : "var(--surface)",
                      color: active ? m.text : "var(--text-secondary)",
                    }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Composer */}
          <div className="mb-[18px] rounded-xl border border-border p-3.5">
            <Overline>Log work / comment</Overline>
            <div className="mb-2.5 flex gap-1.5">
              {TASK_COMMENT_KINDS.map((k) => {
                const active = k === kind;
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    aria-pressed={active}
                    className="rounded-[7px] border-[1.5px] px-3 py-1 text-xs font-semibold transition-colors"
                    style={{
                      borderColor: active ? "var(--primary)" : "var(--border)",
                      background: active ? "var(--primary-subtle)" : "transparent",
                      color: active ? "var(--primary-text)" : "var(--text-muted)",
                    }}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <label className="sr-only" htmlFor="task-comment">Note</label>
            <textarea
              id="task-comment"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={kind === "worklog" ? "What did you work on?" : "Add a comment…"}
              className="min-h-[64px] w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <div className="mt-2.5 flex justify-end">
              <button
                onClick={submit}
                disabled={pending || !body.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
              >
                Log
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold text-text-primary">Activity</span>
            <span className="tabular text-xs text-text-muted">{task.comments.length} entries</span>
          </div>
          <ol className="flex flex-col">
            {task.comments.map((c, i) => {
              const last = i === task.comments.length - 1;
              return (
                <li key={c.id} className="flex gap-3 pb-4">
                  <div className="flex flex-none flex-col items-center">
                    <Avatar name={c.author} size={28} />
                    {!last && <span className="mt-1.5 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className="rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
                        style={
                          c.kind === "worklog"
                            ? { color: "var(--info-text)", background: "var(--info-subtle)" }
                            : { color: "var(--text-secondary)", background: "var(--surface-sunken)" }
                        }
                      >
                        {KIND_LABEL[c.kind]}
                      </span>
                      <span className="tabular text-xs text-text-muted">{fmtDayYear(c.createdAt.slice(0, 10))}</span>
                    </div>
                    <div className="text-[13px] leading-relaxed text-text-secondary">{c.body}</div>
                  </div>
                </li>
              );
            })}
            {task.comments.length === 0 && (
              <li className="py-4 text-center text-xs text-text-muted">No worklog or comments yet.</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`px-3 py-2.5 ${last ? "" : "border-r border-border-subtle"}`}>
      <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Overline({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">{children}</div>;
}
