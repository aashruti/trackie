"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Money } from "@/components/ui/money";
import { MoveSelect } from "@/components/team/team-board";
import { LeadDetailDialog } from "./lead-detail-dialog";
import { NewLeadDialog } from "./new-lead-dialog";
import {
  LEAD_STAGE_META,
  PEOPLE,
  leadStats,
  stageSum,
  type LeadActivityRow,
  type LeadDetailRow,
  type LeadFollowupRow,
} from "@/lib/board/constants";
import type { LeadStage, ActivityType } from "@/lib/db/enums";
import { fmtDay, isOverdue } from "@/lib/dates";
import {
  addActivityAction,
  convertLeadAction,
  moveLeadAction,
  addFollowupAction,
  setFollowupDoneAction,
  deleteFollowupAction,
} from "@/app/(app)/leads/actions";

const selectCls =
  "h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

const OEMS = ["IBM", "AAFM"];

type LeadAction =
  | { kind: "stage"; id: number; stage: LeadStage; lostReason?: string | null }
  | { kind: "addFollowup"; id: number; followup: LeadFollowupRow }
  | { kind: "toggleFollowup"; id: number; followupId: number; done: boolean }
  | { kind: "deleteFollowup"; id: number; followupId: number }
  | { kind: "activity"; id: number; activity: LeadActivityRow };

/** Soonest pending dated follow-up → the lead's next-action cache (card/dashboard). */
function nextPending(followups: LeadFollowupRow[]): { action: string | null; date: string | null } {
  const dated = followups
    .filter((f) => !f.done && f.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  return { action: dated[0]?.action ?? null, date: dated[0]?.dueDate ?? null };
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(),
  );
}

export function LeadsBoard({
  leads,
  meCode,
  currentUserId,
  isSuperAdmin,
}: {
  leads: LeadDetailRow[];
  meCode: string;
  currentUserId: number;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [optimisticLeads, applyAction] = useOptimistic(leads, (state, a: LeadAction) =>
    state.map((l) => {
      if (l.id !== a.id) return l;
      if (a.kind === "stage")
        return { ...l, stage: a.stage, lostReason: a.stage === "lost" ? (a.lostReason ?? null) : null };
      if (a.kind === "addFollowup" || a.kind === "toggleFollowup" || a.kind === "deleteFollowup") {
        let followups = l.followups;
        if (a.kind === "addFollowup") followups = [...l.followups, a.followup];
        else if (a.kind === "toggleFollowup")
          followups = l.followups.map((f) => (f.id === a.followupId ? { ...f, done: a.done } : f));
        else followups = l.followups.filter((f) => f.id !== a.followupId);
        const np = nextPending(followups);
        return { ...l, followups, nextAction: np.action, nextDate: np.date };
      }
      return {
        ...l,
        activities: [a.activity, ...l.activities],
        activityCount: l.activityCount + 1,
      };
    }),
  );
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [oem, setOem] = useState("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [addingLead, setAddingLead] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<LeadStage | null>(null);
  const dragId = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return optimisticLeads.filter((l) => {
      if (owner !== "all" && l.owner !== owner) return false;
      if (oem !== "all" && l.oem !== oem) return false;
      if (q) {
        const hay = `${l.prospect} ${l.city ?? ""} ${l.oem ?? ""} ${l.contact.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [optimisticLeads, owner, oem, search]);

  const stats = leadStats(filtered);
  const open = openId != null ? optimisticLeads.find((l) => l.id === openId) ?? null : null;

  function move(id: number, stage: LeadStage, lostReason?: string | null) {
    startTransition(async () => {
      applyAction({ kind: "stage", id, stage, lostReason });
      await moveLeadAction(id, stage, lostReason);
    });
  }

  function addFollowup(id: number, input: { action: string; dueDate: string | null }) {
    startTransition(async () => {
      applyAction({ kind: "addFollowup", id, followup: { id: -Date.now(), action: input.action, dueDate: input.dueDate, done: false } });
      await addFollowupAction(id, input);
    });
  }
  function toggleFollowup(id: number, followupId: number, done: boolean) {
    startTransition(async () => {
      applyAction({ kind: "toggleFollowup", id, followupId, done });
      await setFollowupDoneAction(followupId, done);
    });
  }
  function deleteFollowup(id: number, followupId: number) {
    startTransition(async () => {
      applyAction({ kind: "deleteFollowup", id, followupId });
      await deleteFollowupAction(followupId);
    });
  }

  function convert(id: number) {
    startTransition(async () => {
      try {
        const res = await convertLeadAction(id);
        if (res?.accountId) router.push(`/accounts/${res.accountId}`);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Failed to convert lead");
      }
    });
  }

  function log(id: number, input: { type: ActivityType; body: string }) {
    startTransition(async () => {
      applyAction({
        kind: "activity",
        id,
        activity: {
          id: -Date.now(),
          type: input.type,
          author: meCode,
          body: input.body,
          dateLabel: todayLabel(),
        },
      });
      await addActivityAction(id, input);
    });
  }


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight text-text-primary">Lead management</h2>
            <span className="rounded-full border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary-text)]">
              Pipeline
            </span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            Prospect accounts and the conversations in flight · drag a lead, or use its stage menu,
            to update it
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="ld-search">Search leads</label>
          <input
            id="ld-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads…"
            className="h-9 w-40 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <label className="sr-only" htmlFor="ld-owner">Filter by owner</label>
          <select id="ld-owner" className={selectCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">All owners</option>
            {Object.keys(PEOPLE).map((k) => (
              <option key={k} value={k}>{PEOPLE[k].name}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="ld-oem">Filter by OEM</label>
          <select id="ld-oem" className={selectCls} value={oem} onChange={(e) => setOem(e.target.value)}>
            <option value="all">All OEMs</option>
            {OEMS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <button
            onClick={() => setAddingLead(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:opacity-90"
          >
            <PlusIcon /> Add lead
          </button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="mb-4 flex overflow-hidden rounded-xl border border-border bg-surface">
        <StatCell label="Active leads">
          <span className="tabular text-xl font-extrabold text-text-primary">{stats.activeCount}</span>
        </StatCell>
        <StatCell label="Open pipeline value">
          <Money value={stats.pipelineValue} compact tone="pending" className="text-xl font-extrabold" />
        </StatCell>
        <StatCell label="Won this year">
          <Money value={stats.wonValue} compact tone="positive" className="text-xl font-extrabold" />
        </StatCell>
        <StatCell label="Lost" last>
          <span className="tabular text-xl font-extrabold text-[var(--negative-text)]">{stats.lostCount}</span>
        </StatCell>
      </div>

      {/* Pipeline kanban */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-6">
        <div className="flex h-full items-stretch gap-3.5">
          {LEAD_STAGE_META.map((stage) => {
            const cards = filtered.filter((l) => l.stage === stage.id);
            const over = dragOverStage === stage.id;
            return (
              <section key={stage.id} className="flex w-[280px] shrink-0 flex-col">
                <div className="flex flex-none items-center gap-2 px-1 pb-2.5 pt-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                  <span className="text-[13px] font-bold text-text-primary">{stage.label}</span>
                  <span className="tabular rounded-full bg-surface-sunken px-2 py-px text-xs font-bold text-text-muted">
                    {cards.length}
                  </span>
                  <Money value={stageSum(cards)} compact tone="muted" className="ml-auto text-[11px] font-semibold" />
                </div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverStage !== stage.id) setDragOverStage(stage.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverStage(null);
                    if (dragId.current != null) move(dragId.current, stage.id);
                  }}
                  className="flex min-h-[120px] flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl border-[1.5px] border-dashed p-2.5 transition-colors"
                  style={{
                    background: over ? "var(--primary-subtle)" : "var(--surface-sunken)",
                    borderColor: over ? "var(--primary)" : "var(--border)",
                  }}
                  aria-label={`${stage.label} stage`}
                >
                  {cards.map((l) => (
                    <LeadCard
                      key={l.id}
                      lead={l}
                      onOpen={() => setOpenId(l.id)}
                      onDragStart={() => (dragId.current = l.id)}
                      onDragEnd={() => {
                        dragId.current = null;
                        setDragOverStage(null);
                      }}
                      onMove={(s) => move(l.id, s)}
                    />
                  ))}
                  {cards.length === 0 && (
                    <div className="flex min-h-[80px] flex-1 items-center justify-center text-xs text-text-muted">
                      Drop leads here
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {open && (
        <LeadDetailDialog
          lead={open}
          pending={pending}
          canConvert={isSuperAdmin || (open.stage === "won" && open.createdById === currentUserId)}
          onClose={() => setOpenId(null)}
          onSetStage={(stage, reason) => move(open.id, stage, reason)}
          onAddFollowup={(input) => addFollowup(open.id, input)}
          onToggleFollowup={(fid, done) => toggleFollowup(open.id, fid, done)}
          onDeleteFollowup={(fid) => deleteFollowup(open.id, fid)}
          onLogActivity={(input) => log(open.id, input)}
          onConvert={() => convert(open.id)}
        />
      )}

      {addingLead && <NewLeadDialog defaultOwner={meCode} onClose={() => setAddingLead(false)} />}
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  lead: LeadDetailRow;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stage: LeadStage) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
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
      aria-label={`Open ${lead.prospect}`}
      className="cursor-grab rounded-[10px] border border-border bg-surface p-3 shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] active:cursor-grabbing"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-bold leading-snug text-text-primary">{lead.prospect}</span>
        {lead.oem && <Chip>{lead.oem}</Chip>}
      </div>
      <div className="mb-2.5 text-[11.5px] text-text-muted">{lead.city}</div>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-text-muted">Est. value</span>
        <Money value={lead.value} compact className="text-sm font-bold" />
      </div>
      <div className="mb-2.5 flex items-center gap-1.5 rounded-[7px] bg-surface-sunken px-2.5 py-2">
        <ClockIcon />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-secondary">
          {lead.nextAction ?? "—"}
        </span>
        {lead.nextDate && (
          <span
            className="tabular text-[11px]"
            style={{ color: isOverdue(lead.nextDate) ? "var(--negative-text)" : "var(--text-muted)" }}
          >
            {fmtDay(lead.nextDate)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
          <ChatIcon />
          <span className="tabular">{lead.activityCount}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <MoveSelect
            value={lead.stage}
            ariaLabel={`Move ${lead.prospect} to another stage`}
            options={LEAD_STAGE_META}
            onMove={(v) => onMove(v as LeadStage)}
          />
          <Avatar code={lead.owner} size={26} />
        </div>
      </div>
    </article>
  );
}

function StatCell({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex-1 px-[18px] py-3 ${last ? "" : "border-r border-border-subtle"}`}>
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex-none rounded-full border border-[var(--neutral-status-border)] bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--neutral-status-text)]">
      {children}
    </span>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-none">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
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
