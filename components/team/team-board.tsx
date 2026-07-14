"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskDetailDialog } from "./task-detail-dialog";
import {
  PRIORITY_META,
  STATUS_META,
  BOARD_COLUMNS,
  TASK_COLUMNS,
  teamStats,
  type TaskDetailRow,
  type TaskComment,
  type Option,
  type ProgramOption,
} from "@/lib/board/constants";
import type { TaskStatus, TaskPriority, TaskCommentKind, TaskBoard } from "@/lib/db/enums";
import { fmtDay, isOverdue, todayISO } from "@/lib/dates";
import { moveTaskAction, addTaskCommentAction, updateTaskPriorityAction } from "@/app/(app)/team/actions";

const selectCls =
  "h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

type Action =
  | { kind: "move"; id: number; status: TaskStatus }
  | { kind: "priority"; id: number; priority: TaskPriority }
  | { kind: "comment"; id: number; comment: TaskComment };

export function TeamBoard({
  tasks,
  accounts,
  users,
  programs = [],
  meCode,
  variant = "board",
  board = "team",
  basePath = "/team",
  columns = BOARD_COLUMNS,
  doneWindow = "30",
  backlogCount = 0,
  initialAssignee = "all",
  initialDue = "all",
}: {
  tasks: TaskDetailRow[];
  accounts: Option[];
  users: Option[];
  programs?: ProgramOption[];
  meCode: string;
  variant?: "board" | "backlog";
  /** Which kanban this instance serves — new tasks are created on it. */
  board?: TaskBoard;
  /** Route the board lives on (done-window select round-trips through it). */
  basePath?: string;
  /** Which status columns to render (delivery shows all six, backlog included). */
  columns?: typeof BOARD_COLUMNS;
  doneWindow?: string;
  backlogCount?: number;
  initialAssignee?: string;
  initialDue?: string;
}) {
  const router = useRouter();
  const [optimistic, apply] = useOptimistic(tasks, (state, a: Action) =>
    state.map((t) => {
      if (t.id !== a.id) return t;
      if (a.kind === "move") return { ...t, status: a.status };
      if (a.kind === "priority") return { ...t, priority: a.priority };
      return { ...t, comments: [a.comment, ...t.comments], commentCount: t.commentCount + 1 };
    }),
  );
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState(initialAssignee);
  const [oem, setOem] = useState("all");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [dueToday, setDueToday] = useState(initialDue === "today");
  const [programFilter, setProgramFilter] = useState("all");
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const dragId = useRef<number | null>(null);
  const today = todayISO();
  const isDelivery = board === "delivery";

  const oems = useMemo(
    () => Array.from(new Set(optimistic.map((t) => t.oem).filter((o): o is string => !!o))).sort(),
    [optimistic],
  );
  const boardPrograms = useMemo(
    () => Array.from(new Set(optimistic.map((t) => t.programName).filter((p): p is string => !!p))).sort(),
    [optimistic],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return optimistic.filter((t) => {
      if (assignee !== "all" && String(t.assigneeId) !== assignee) return false;
      if (oem !== "all" && (t.oem ?? "") !== oem) return false;
      if (programFilter !== "all" && (t.programName ?? "") !== programFilter) return false;
      if (dueToday && !(t.status !== "done" && t.dueDate && t.dueDate <= today)) return false;
      if (q) {
        const hay = `${t.title} ${t.accountName ?? ""} ${t.assigneeName ?? ""} ${t.oem ?? ""} ${t.programName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [optimistic, assignee, oem, programFilter, dueToday, search, today]);

  const shownColumns = useMemo(
    () => (statusFilter === "all" ? columns : columns.filter((c) => c.id === statusFilter)),
    [statusFilter, columns],
  );

  const stats = teamStats(filtered);
  const open = openId != null ? optimistic.find((t) => t.id === openId) ?? null : null;
  const isBacklog = variant === "backlog";

  function move(id: number, status: TaskStatus) {
    startTransition(async () => {
      apply({ kind: "move", id, status });
      await moveTaskAction(id, status);
    });
  }
  function setPriority(id: number, priority: TaskPriority) {
    startTransition(async () => {
      apply({ kind: "priority", id, priority });
      await updateTaskPriorityAction(id, priority);
    });
  }
  function comment(id: number, input: { kind: TaskCommentKind; body: string }) {
    startTransition(async () => {
      apply({
        kind: "comment",
        id,
        comment: { id: -Date.now(), kind: input.kind, author: meCode, body: input.body, createdAt: new Date().toISOString() },
      });
      await addTaskCommentAction(id, input);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight text-text-primary">
              {isBacklog ? "Backlog" : isDelivery ? "Delivery board" : "Team board"}
            </h2>
            <span className="rounded-full border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary-text)]">
              {isBacklog ? "Triage" : isDelivery ? "Program delivery" : "Internal delivery"}
            </span>
            {!isDelivery &&
              (!isBacklog ? (
                <Link
                  href="/team/backlog"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover"
                >
                  Backlog
                  <span className="tabular rounded-full bg-surface-sunken px-1.5 text-[11px] font-bold text-text-muted">{backlogCount}</span>
                  →
                </Link>
              ) : (
                <Link
                  href="/team"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover"
                >
                  ← Board
                </Link>
              ))}
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            {isBacklog
              ? "Untriaged work · open items onto the board when ready"
              : isDelivery
                ? "Event and program work · drag a card, click to open it, or use its status menu"
                : "Active delivery · drag a card, click to open it, or use its status menu"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="tb-search">Search tasks</label>
          <input
            id="tb-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="h-9 w-40 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <label className="sr-only" htmlFor="tb-assignee">Filter by assignee</label>
          <select id="tb-assignee" className={selectCls} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="all">All assignees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="tb-oem">Filter by OEM</label>
          <select id="tb-oem" className={selectCls} value={oem} onChange={(e) => setOem(e.target.value)}>
            <option value="all">All OEMs</option>
            {oems.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {isDelivery && (
            <>
              <label className="sr-only" htmlFor="tb-program">Filter by program</label>
              <select id="tb-program" className={selectCls} value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
                <option value="all">All programs</option>
                {boardPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </>
          )}
          {!isBacklog && (
            <>
              <label className="sr-only" htmlFor="tb-status">Focus a status</label>
              <select
                id="tb-status"
                className={selectCls}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "all")}
              >
                <option value="all">All statuses</option>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <label className="sr-only" htmlFor="tb-done">Show completed since</label>
              <select
                id="tb-done"
                className={selectCls}
                value={doneWindow}
                onChange={(e) => startTransition(() => router.push(`${basePath}?done=${e.target.value}`, { scroll: false }))}
                title="How far back to show completed (Done) tasks"
              >
                <option value="30">Show done: 30 days</option>
                <option value="90">Show done: 90 days</option>
                <option value="all">Show done: all</option>
              </select>
            </>
          )}
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            <PlusIcon /> New task
          </button>
        </div>
      </div>

      {!isBacklog && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <Stat value={stats.open} label="active" />
          <Stat value={stats.blocked} label="blocked" dot="var(--negative)" valueColor="var(--negative-text)" />
          <Stat value={stats.done} label="done" dot="var(--positive)" valueColor="var(--positive-text)" />
          {dueToday && (
            <button
              onClick={() => setDueToday(false)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2.5 py-1 text-[12px] font-semibold text-[var(--primary-text)]"
              title="Showing tasks due today or overdue — click to clear"
            >
              Due today / overdue
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {isBacklog ? (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {filtered.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
              Backlog is empty. Use “New task” to add work.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  onOpen={() => setOpenId(t.id)}
                  onMove={(s) => move(t.id, s)}
                  onAddToBoard={() => move(t.id, "open")}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-6">
          <div className="flex h-full items-stretch gap-3.5">
            {shownColumns.map((col) => {
              const cards = filtered.filter((t) => t.status === col.id);
              const over = dragOverCol === col.id;
              return (
                <section key={col.id} className="flex w-[300px] shrink-0 flex-col">
                  <div className="flex flex-none items-center gap-2 px-1 pb-2.5 pt-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-[13px] font-bold text-text-primary">{col.label}</span>
                    <span className="tabular rounded-full bg-surface-sunken px-2 py-px text-xs font-bold text-text-muted">{cards.length}</span>
                  </div>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverCol !== col.id) setDragOverCol(col.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverCol(null);
                      if (dragId.current != null) move(dragId.current, col.id);
                    }}
                    className="flex min-h-[120px] flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl border-[1.5px] border-dashed p-2.5 transition-colors"
                    style={{
                      background: over ? "var(--primary-subtle)" : "var(--surface-sunken)",
                      borderColor: over ? "var(--primary)" : "var(--border)",
                    }}
                    aria-label={`${col.label} column`}
                  >
                    {cards.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onOpen={() => setOpenId(t.id)}
                        onDragStart={() => (dragId.current = t.id)}
                        onDragEnd={() => {
                          dragId.current = null;
                          setDragOverCol(null);
                        }}
                        onMove={(s) => move(t.id, s)}
                      />
                    ))}
                    {cards.length === 0 && (
                      <div className="flex min-h-[80px] flex-1 items-center justify-center text-xs text-text-muted">
                        Drop tasks here
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {adding && (
        <NewTaskDialog
          accounts={accounts}
          users={users}
          programs={programs}
          board={board}
          defaultStatus={isBacklog ? "backlog" : "open"}
          onClose={() => setAdding(false)}
        />
      )}

      {open && (
        <TaskDetailDialog
          task={open}
          pending={pending}
          onClose={() => setOpenId(null)}
          onSetStatus={(s) => move(open.id, s)}
          onSetPriority={(p) => setPriority(open.id, p)}
          onComment={(input) => comment(open.id, input)}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
  onAddToBoard,
}: {
  task: TaskDetailRow;
  onOpen: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onMove: (status: TaskStatus) => void;
  onAddToBoard?: () => void;
}) {
  const p = PRIORITY_META[task.priority];
  const internal = !task.accountId;
  const draggable = !!onDragStart;
  return (
    <article
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart!();
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${task.title}`}
      className={`rounded-[10px] border border-border bg-surface p-3 shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{ borderLeft: `3px solid ${p.color}` }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-[5px] border px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
          style={{ color: p.text, background: p.bg, borderColor: p.border }}
        >
          <span className="h-[5px] w-[5px] rounded-full" style={{ background: p.color }} />
          {p.label}
        </span>
        {task.dueDate && (
          <span
            className="tabular text-[11px]"
            style={{ color: task.status !== "done" && isOverdue(task.dueDate) ? "var(--negative-text)" : "var(--text-muted)" }}
            title={task.startDate ? `${fmtDay(task.startDate)} → ${fmtDay(task.dueDate)}` : `Due ${fmtDay(task.dueDate)}`}
          >
            {fmtDay(task.dueDate)}
          </span>
        )}
      </div>
      <div className="mb-2.5 text-[13.5px] font-semibold leading-snug text-text-primary">{task.title}</div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {internal ? (
          <Chip>Internal</Chip>
        ) : (
          <>
            <span className="text-[11px] font-semibold text-text-secondary">{task.accountName}</span>
            {task.programName ? <Chip>{task.programName}</Chip> : task.oem && <Chip>{task.oem}</Chip>}
          </>
        )}
      </div>

      {onAddToBoard && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToBoard();
          }}
          className="mb-2.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2 py-1.5 text-[12px] font-semibold text-[var(--primary-text)] hover:opacity-90"
        >
          Add to board →
        </button>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <StatusChip value={task.status} onMove={(v) => onMove(v as TaskStatus)} ariaLabel={`Set status of "${task.title}"`} />
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title={`${task.commentCount} comments / worklogs`}>
              <ChatIcon />
              <span className="tabular">{task.commentCount}</span>
            </span>
          )}
        </div>
        {task.assigneeName ? (
          <Avatar name={task.assigneeName} size={26} />
        ) : (
          <span title="Unassigned" className="grid h-[26px] w-[26px] place-items-center rounded-full border border-dashed border-border text-[10px] text-text-muted">—</span>
        )}
      </div>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--neutral-status-border)] bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--neutral-status-text)]">
      {children}
    </span>
  );
}

function Stat({ value, label, dot, valueColor }: { value: number; label: string; dot?: string; valueColor?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      <span className="tabular text-[17px] font-extrabold" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
      <span className="text-text-muted">{label}</span>
    </div>
  );
}

/**
 * Colored status chip that's also the keyboard-accessible, non-drag move control.
 * Sizes to its label (no truncation) and tints by the current status.
 */
function StatusChip({ value, onMove, ariaLabel }: { value: TaskStatus; onMove: (v: string) => void; ariaLabel: string }) {
  const m = STATUS_META[value];
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onMove(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className="cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[var(--ring)]"
      style={{ background: m.bg, color: m.text, borderColor: m.border }}
      title="Change status"
    >
      {TASK_COLUMNS.map((c) => (
        <option key={c.id} value={c.id}>{c.label}</option>
      ))}
    </select>
  );
}

/** Generic un-trimmed move select (used by the leads board for stage). */
export function MoveSelect({
  value,
  options,
  onMove,
  ariaLabel,
}: {
  value: string;
  options: { id: string; label: string }[];
  onMove: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onMove(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      className="cursor-pointer rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary outline-none hover:bg-surface-hover focus:ring-2 focus:ring-[var(--ring)]"
      title="Move"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
