"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Money } from "@/components/ui/money";
import { MonthSwitcher } from "@/components/hr/month-switcher";
import type { ProgramCalendar, ProgramDetail, ProgramEvent } from "@/lib/dal/delivery/programs";
import type { Option } from "@/lib/board/constants";
import {
  DELIVERY_ACTIVITY_TYPES,
  DELIVERY_EVENT_STATUSES,
  type DeliveryActivityType,
  type DeliveryEventStatus,
} from "@/lib/db/enums";
import { ACTIVITY_TYPE_META, EVENT_STATUS_META } from "./meta";
import { ProgramCalendarView } from "./program-calendar";
import {
  addActivityAction,
  createEventAction,
  deleteActivityAction,
  deleteEventAction,
  setEventStatusAction,
  updateEventAction,
} from "@/app/(app)/delivery/programs/[id]/actions";

const fieldCls =
  "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ProgramDetailView({
  detail,
  calendar,
  calYear,
  calMonth,
  tab,
  users,
  canManage,
}: {
  detail: ProgramDetail;
  calendar: ProgramCalendar;
  calYear: number;
  calMonth: number;
  tab: "events" | "calendar";
  users: Option[];
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setTab(next: "events" | "calendar") {
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", next);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }

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
    <div className="space-y-4">
      {/* Tabs */}
      <div className="no-print flex items-center gap-1 border-b border-border">
        {(["events", "calendar"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-[var(--primary)] text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            }`}
          >
            {t === "events" ? `Events (${detail.events.length})` : "Calendar"}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-sm text-[var(--negative-text)]">
          {error}
        </p>
      )}

      {tab === "calendar" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MonthSwitcher year={calYear} month={calMonth} allowFuture />
            <p className="text-xs text-text-muted">
              {calendar.summary.events} event{calendar.summary.events === 1 ? "" : "s"} ·{" "}
              {calendar.summary.activities} activit{calendar.summary.activities === 1 ? "y" : "ies"} · cost{" "}
              <Money value={calendar.summary.cost} compact />
            </p>
          </div>
          <ProgramCalendarView days={calendar.days} cells={calendar.cells} />
        </div>
      ) : (
        <EventsPanel detail={detail} users={users} canManage={canManage} pending={pending} run={run} />
      )}
    </div>
  );
}

// ── Events tab ────────────────────────────────────────────────────────────────

function EventsPanel({
  detail,
  users,
  canManage,
  pending,
  run,
}: {
  detail: ProgramDetail;
  users: Option[];
  canManage: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => void;
}) {
  const [addingEvent, setAddingEvent] = useState(false);

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          {addingEvent ? (
            <EventForm
              users={users}
              pending={pending}
              onCancel={() => setAddingEvent(false)}
              onSubmit={(values) =>
                run(() => createEventAction({ ...values, programId: detail.id }), () => setAddingEvent(false))
              }
            />
          ) : (
            <button
              onClick={() => setAddingEvent(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
            >
              + Add event
            </button>
          )}
        </div>
      )}

      {detail.events.length === 0 && !addingEvent ? (
        <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
          No events yet{canManage ? " — add the first one." : "."}
        </div>
      ) : (
        detail.events.map((event) => (
          <EventCard key={event.id} programId={detail.id} event={event} users={users} canManage={canManage} pending={pending} run={run} />
        ))
      )}
    </div>
  );
}

function EventCard({
  programId,
  event,
  users,
  canManage,
  pending,
  run,
}: {
  programId: number;
  event: ProgramEvent;
  users: Option[];
  canManage: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const meta = EVENT_STATUS_META[event.status];
  const over = event.spent > event.budget;
  const pct = event.budget > 0 ? Math.min(100, Math.round((event.spent / event.budget) * 100)) : event.spent > 0 ? 100 : 0;

  if (editing) {
    return (
      <EventForm
        users={users}
        pending={pending}
        initial={event}
        onCancel={() => setEditing(false)}
        onSubmit={(values) => run(() => updateEventAction(programId, event.id, values), () => setEditing(false))}
      />
    );
  }

  return (
    <article className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-text-primary">{event.title}</h3>
            {canManage ? (
              <select
                aria-label={`Status of ${event.title}`}
                value={event.status}
                disabled={pending}
                onChange={(e) => run(() => setEventStatusAction(programId, event.id, e.target.value as DeliveryEventStatus))}
                className="cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-[var(--ring)]"
                style={{ background: meta.bg, color: meta.text, borderColor: meta.border }}
              >
                {DELIVERY_EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{EVENT_STATUS_META[s].label}</option>
                ))}
              </select>
            ) : (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ background: meta.bg, color: meta.text, borderColor: meta.border }}>
                {meta.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {fmtDate(event.startDate)}
            {event.endDate ? ` → ${fmtDate(event.endDate)}` : ""}
            {event.venue ? ` · ${event.venue}` : ""}
            {event.ownerName ? ` · ${event.ownerName}` : ""}
          </p>
          {event.description && <p className="mt-1.5 max-w-3xl text-sm text-text-secondary">{event.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage && (
            <>
              <button
                onClick={() => setEditing(true)}
                disabled={pending}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete “${event.title}” and its ${event.activities.length} logged activit${event.activities.length === 1 ? "y" : "ies"}?`)) {
                    run(() => deleteEventAction(programId, event.id));
                  }
                }}
                disabled={pending}
                className="rounded-md border border-[var(--negative-border)] px-2 py-1 text-xs font-medium text-[var(--negative-text)] hover:bg-[var(--negative-subtle)] disabled:opacity-40"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Budget bar */}
      <div className="border-t border-border-subtle px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-text-muted">
            Budget <Money value={event.budget} compact className="font-semibold" /> · Spent{" "}
            <Money value={event.spent} compact tone={over ? "negative" : "default"} className="font-semibold" />
          </span>
          {over ? (
            <span className="font-semibold text-[var(--negative-text)]">
              Over budget by <Money value={event.spent - event.budget} compact />
            </span>
          ) : (
            <span className="text-text-muted">
              <Money value={event.budget - event.spent} compact /> remaining
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: over ? "var(--negative)" : "var(--primary)" }}
          />
        </div>
      </div>

      {/* Activity log */}
      <div className="border-t border-border-subtle px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold text-text-secondary hover:text-text-primary"
          aria-expanded={expanded}
        >
          <span>
            Activity log · {event.activities.length} entr{event.activities.length === 1 ? "y" : "ies"}
          </span>
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && (
          <div className="mt-3 space-y-3">
            {canManage && (
              <ActivityComposer
                pending={pending}
                onSubmit={(values) => run(() => addActivityAction(programId, { ...values, eventId: event.id }))}
              />
            )}
            {event.activities.length === 0 ? (
              <p className="py-2 text-center text-xs text-text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {event.activities.map((a) => {
                  const t = ACTIVITY_TYPE_META[a.type];
                  return (
                    <li key={a.id} className="flex flex-wrap items-start gap-2.5 rounded-lg border border-border-subtle bg-surface-sunken/50 px-3 py-2">
                      <span className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: t.text, background: t.bg }}>
                        {t.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-text-primary">{a.title}</div>
                        {a.body && <div className="mt-0.5 whitespace-pre-wrap text-xs text-text-secondary">{a.body}</div>}
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                          <span className="tabular">{fmtDate(a.activityDate)}</span>
                          <span className="inline-flex items-center gap-1">
                            <Avatar name={a.author} size={16} /> {a.author}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {a.cost > 0 && <Money value={a.cost} compact className="text-[13px] font-semibold" />}
                        {canManage && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete “${a.title}”${a.cost > 0 ? ` (₹${a.cost.toLocaleString("en-IN")} of spend)` : ""}?`)) {
                                run(() => deleteActivityAction(programId, a.id));
                              }
                            }}
                            disabled={pending}
                            aria-label={`Delete ${a.title}`}
                            className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-[var(--negative-subtle)] hover:text-[var(--negative-text)] disabled:opacity-40"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────

type EventFormValues = {
  title: string;
  description?: string;
  venue?: string;
  startDate: string;
  endDate?: string;
  budget?: number;
  ownerUserId?: number | null;
};

function EventForm({
  users,
  pending,
  initial,
  onSubmit,
  onCancel,
}: {
  users: Option[];
  pending: boolean;
  initial?: ProgramEvent;
  onSubmit: (values: EventFormValues) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [budget, setBudget] = useState(initial ? String(initial.budget) : "");
  const [ownerUserId, setOwnerUserId] = useState(initial?.ownerUserId ? String(initial.ownerUserId) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!title.trim()) { setLocalError("Give the event a title."); return; }
    if (!startDate) { setLocalError("Pick a start date."); return; }
    onSubmit({
      title: title.trim(),
      venue: venue.trim() || undefined,
      startDate,
      endDate: endDate || undefined,
      budget: budget === "" ? 0 : Number(budget),
      ownerUserId: ownerUserId ? Number(ownerUserId) : null,
      description: description.trim() || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-[var(--primary-border)] bg-surface p-4">
      <h3 className="text-sm font-semibold text-text-primary">{initial ? "Edit event" : "New event"}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-medium text-text-muted">Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kickoff workshop" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Venue</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Where it happens" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Owner</span>
          <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={fieldCls}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">End date <span className="font-normal">(blank = single day)</span></span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-text-muted">Allocated budget ₹</span>
          <input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" className={fieldCls} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[11px] font-medium text-text-muted">Description <span className="font-normal">(optional)</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={fieldCls} />
        </label>
      </div>
      {localError && (
        <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">{localError}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          {pending ? "Saving…" : initial ? "Save event" : "Add event"}
        </button>
      </div>
    </form>
  );
}

function ActivityComposer({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (values: { type: DeliveryActivityType; title: string; body?: string; activityDate: string; cost?: number }) => void;
}) {
  const [type, setType] = useState<DeliveryActivityType>("session");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [activityDate, setActivityDate] = useState(todayIso());
  const [cost, setCost] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!title.trim()) { setLocalError("Describe the activity in a short title."); return; }
    if (!activityDate) { setLocalError("Pick the activity date."); return; }
    onSubmit({
      type,
      title: title.trim(),
      body: body.trim() || undefined,
      activityDate,
      cost: cost === "" ? 0 : Number(cost),
    });
    setTitle("");
    setBody("");
    setCost("");
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as DeliveryActivityType)} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]">
            {DELIVERY_ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>{ACTIVITY_TYPE_META[t].label}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-medium text-text-muted">
          What was done
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Day 1 sessions delivered to 120 students" className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
          Date
          <input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)} className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]" />
        </label>
        <label className="flex w-28 flex-col gap-1 text-[11px] font-medium text-text-muted">
          Cost ₹
          <input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50">
          Log it
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Details (optional) — participants, outcomes, vendor, anything the annual report should show"
        className="w-full rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
      {localError && (
        <p className="rounded-md border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3 py-2 text-xs text-[var(--negative-text)]">{localError}</p>
      )}
    </form>
  );
}
