"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Money } from "@/components/ui/money";
import { fmt } from "@/lib/money/format";
import { fmtDay, todayISO } from "@/lib/dates";
import {
  ACTIVITY_META,
  LEAD_STAGE_META,
  person,
  type LeadDetailRow,
} from "@/lib/board/constants";
import { ACTIVITY_TYPES, type ActivityType, type LeadStage } from "@/lib/db/enums";

export function LeadDetailDialog({
  lead,
  pending,
  canConvert,
  onClose,
  onSetStage,
  onAddFollowup,
  onToggleFollowup,
  onDeleteFollowup,
  onLogActivity,
  onConvert,
}: {
  lead: LeadDetailRow;
  pending: boolean;
  canConvert: boolean;
  onClose: () => void;
  onSetStage: (stage: LeadStage, lostReason?: string | null) => void;
  onAddFollowup: (input: { action: string; dueDate: string | null }) => void;
  onToggleFollowup: (followupId: number, done: boolean) => void;
  onDeleteFollowup: (followupId: number) => void;
  onLogActivity: (input: { type: ActivityType; body: string }) => void;
  onConvert: () => void;
}) {
  const [type, setType] = useState<ActivityType>("note");
  const [body, setBody] = useState("");
  const [fuAction, setFuAction] = useState("");
  const [fuDate, setFuDate] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  function addFollowup() {
    if (!fuAction.trim()) return;
    onAddFollowup({ action: fuAction.trim(), dueDate: fuDate || null });
    setFuAction("");
    setFuDate("");
  }

  function pickStage(stage: LeadStage) {
    if (stage === "lost" && lead.stage !== "lost") {
      const reason = window.prompt("Why was this lead lost? (optional)") ?? "";
      onSetStage("lost", reason);
    } else {
      onSetStage(stage);
    }
  }

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
    onLogActivity({ type, body: text });
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
        aria-labelledby="lead-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="mt-[4vh] flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl outline-none"
      >
        {/* Head */}
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2.5">
              <h2 id="lead-dialog-title" className="text-lg font-bold tracking-tight text-text-primary">
                {lead.prospect}
              </h2>
              {lead.oem && <Chip>{lead.oem}</Chip>}
            </div>
            <p className="text-xs text-text-muted">
              {[lead.city, lead.source].filter(Boolean).join(" · ")}
              {lead.owner && ` · owner ${person(lead.owner).name}`}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {lead.convertedAccountId ? (
              <a
                href={`/accounts/${lead.convertedAccountId}`}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--positive-border)] bg-[var(--positive-subtle)] px-2.5 py-1.5 text-xs font-semibold text-[var(--positive-text)] hover:opacity-90"
              >
                View account →
              </a>
            ) : canConvert ? (
              <button
                onClick={onConvert}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50"
                title="Create an account from this lead, carrying its pricing into a draft invoice"
              >
                {pending ? "Converting…" : "Convert to account"}
              </button>
            ) : null}
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-[30px] w-[30px] place-items-center rounded-lg text-text-muted hover:bg-surface-hover"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* Key facts */}
          <div className="mb-3 grid grid-cols-3 overflow-hidden rounded-[10px] border border-border">
            <Fact label="Est. value">
              <Money value={lead.value} compact className="text-base font-bold" />
            </Fact>
            <Fact label="Est. margin">
              <Money value={lead.margin} compact tone="auto" className="text-base font-bold" />
            </Fact>
            <Fact label="Est. students" last>
              <span className="tabular text-base font-bold text-text-primary">
                {lead.students.toLocaleString("en-IN")}
              </span>
            </Fact>
          </div>
          {/* Pricing + next action */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-border px-3.5 py-2.5 text-[12px]">
            <span className="text-text-muted">
              Price / seat{" "}
              <span className="tabular font-semibold text-text-primary">{fmt(lead.priceToUni)}</span>
            </span>
            <span className="text-text-muted">
              Transfer / seat{" "}
              <span className="tabular font-semibold text-text-primary">{fmt(lead.priceToDatagami)}</span>
            </span>
            <span className="ml-auto text-text-muted">
              Next: <span className="font-semibold text-text-primary">{lead.nextAction ?? "—"}</span>
              {lead.nextDate && <span className="tabular text-text-muted"> · {fmtDay(lead.nextDate)}</span>}
            </span>
          </div>

          {lead.stage === "lost" && (
            <div className="mb-4 rounded-[10px] border border-[var(--negative-border)] bg-[var(--negative-subtle)] px-3.5 py-2.5 text-[12px] text-[var(--negative-text)]">
              <span className="font-bold uppercase tracking-wide">Lost</span>
              {lead.lostReason ? ` · ${lead.lostReason}` : " · no reason recorded"}
            </div>
          )}

          {/* Contact card */}
          <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-surface-sunken px-3.5 py-3">
            <Avatar code={lead.owner} size={38} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-text-primary">{lead.contact.name ?? "—"}</div>
              <div className="truncate text-[11.5px] text-text-muted">
                {[lead.contact.role, lead.contact.email, lead.contact.phone].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>

          {/* Stage picker */}
          <div className="mb-[18px]">
            <Overline>Pipeline stage</Overline>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STAGE_META.map((s) => {
                const active = s.id === lead.stage;
                return (
                  <button
                    key={s.id}
                    onClick={() => pickStage(s.id)}
                    disabled={pending}
                    aria-pressed={active}
                    className="rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
                    style={{
                      borderColor: active ? "var(--primary)" : "var(--border)",
                      background: active ? "var(--primary)" : "var(--surface)",
                      color: active ? "var(--primary-fg)" : "var(--text-secondary)",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Follow-ups */}
          <div className="mb-[18px] rounded-xl border border-border p-3.5">
            <Overline>Follow-ups</Overline>
            <ul className="mb-3 flex flex-col gap-1.5">
              {lead.followups.length === 0 && (
                <li className="py-1 text-xs text-text-muted">No follow-ups scheduled.</li>
              )}
              {lead.followups.map((f) => {
                const overdue = !f.done && f.dueDate && f.dueDate <= todayISO();
                return (
                  <li key={f.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.done}
                      onChange={(e) => onToggleFollowup(f.id, e.target.checked)}
                      disabled={pending}
                      aria-label={f.done ? "Mark not done" : "Mark done"}
                      className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className={`flex-1 truncate text-[13px] ${f.done ? "text-text-muted line-through" : "text-text-primary"}`}>
                      {f.action}
                    </span>
                    {f.dueDate && (
                      <span
                        className="tabular shrink-0 text-[11px] font-semibold"
                        style={{ color: overdue ? "var(--negative-text)" : "var(--text-muted)" }}
                      >
                        {fmtDay(f.dueDate)}{overdue ? " · overdue" : ""}
                      </span>
                    )}
                    <button
                      onClick={() => onDeleteFollowup(f.id)}
                      disabled={pending}
                      aria-label="Delete follow-up"
                      className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-hover hover:text-[var(--negative-text)]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
              <label className="block flex-1">
                <span className="text-[11px] text-text-muted">Add follow-up</span>
                <input
                  value={fuAction}
                  onChange={(e) => setFuAction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addFollowup(); }}
                  placeholder="e.g. Send revised quote"
                  className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-text-muted">Date</span>
                <input
                  type="date"
                  value={fuDate}
                  onChange={(e) => setFuDate(e.target.value)}
                  className="mt-1 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </label>
              <button
                onClick={addFollowup}
                disabled={pending || !fuAction.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Composer */}
          <div className="mb-[18px] rounded-xl border border-border p-3.5">
            <Overline>Log a discussion</Overline>
            <div className="mb-2.5 flex gap-1.5">
              {ACTIVITY_TYPES.map((k) => {
                const m = ACTIVITY_META[k];
                const active = k === type;
                return (
                  <button
                    key={k}
                    onClick={() => setType(k)}
                    aria-pressed={active}
                    className="rounded-[7px] border-[1.5px] px-3 py-1 text-xs font-semibold transition-colors"
                    style={{
                      borderColor: active ? m.color : "var(--border)",
                      background: active ? m.bg : "transparent",
                      color: active ? m.color : "var(--text-muted)",
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <label className="sr-only" htmlFor="lead-note">Discussion note</label>
            <textarea
              id="lead-note"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What was discussed? Decisions, next steps, blockers…"
              className="min-h-[72px] w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <div className="mt-2.5 flex justify-end">
              <button
                onClick={submit}
                disabled={pending || !body.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-fg hover:opacity-90 disabled:opacity-50"
              >
                <PlusIcon /> Log discussion
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold text-text-primary">Discussion history</span>
            <span className="tabular text-xs text-text-muted">{lead.activities.length} entries</span>
          </div>
          <ol className="flex flex-col">
            {lead.activities.map((a, i) => {
              const m = ACTIVITY_META[a.type];
              const lastOne = i === lead.activities.length - 1;
              return (
                <li key={a.id} className="flex gap-3 pb-4">
                  <div className="flex flex-none flex-col items-center">
                    <Avatar code={a.author} size={30} />
                    {!lastOne && <span className="mt-1.5 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className="rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
                        style={{ color: m.color, background: m.bg }}
                      >
                        {m.label}
                      </span>
                      <span className="tabular text-xs text-text-muted">{a.dateLabel}</span>
                    </div>
                    <div className="text-[13px] leading-relaxed text-text-secondary">{a.body}</div>
                  </div>
                </li>
              );
            })}
            {lead.activities.length === 0 && (
              <li className="py-4 text-center text-xs text-text-muted">No discussions logged yet.</li>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`px-3.5 py-3 ${last ? "" : "border-r border-border-subtle"}`}>
      <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Overline({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">{children}</div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--neutral-status-border)] bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--neutral-status-text)]">
      {children}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
