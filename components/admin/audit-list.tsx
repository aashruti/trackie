import { Badge } from "@/components/ui/badge";
import { redactedColumnsFor } from "@/lib/audit-view";
import type { AuditEntry, AuditOp, FieldChange } from "@/lib/dal/audit-log";

/** `["aadhar", "pan"]` → `aadhar or pan`, each in code face. */
function joinColumns(cols: readonly string[]) {
  return cols.map((c, i) => (
    <span key={c}>
      {i > 0 && (i === cols.length - 1 ? " or " : ", ")}
      <span className="font-mono">{c}</span>
    </span>
  ));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const OP_TONE: Record<AuditOp, string> = {
  INSERT: "positive",
  UPDATE: "info",
  DELETE: "negative",
};

/** "18 Jun 2026, 14:32:05" — server-rendered, so no locale/hydration drift. */
function fmtAt(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getDate()} ${MON[at.getMonth()]} ${at.getFullYear()}, ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
}

/**
 * How an actor is named — and, more importantly, how it is NOT named.
 *
 * Three genuinely different states, none of which may be smoothed into another:
 * a NULL actor is a system/script write; a resolved name is a known user; an id
 * without a name is a user who has since been deleted, whose id outlives them
 * (audit_log.actor_id deliberately carries no FK). Never invent a name.
 */
function actorLabel(entry: AuditEntry): { text: string; muted: boolean } {
  if (entry.actorId === null) return { text: "System", muted: true };
  if (entry.actorName) return { text: entry.actorName, muted: false };
  return { text: `User #${entry.actorId} (deleted)`, muted: true };
}

/**
 * Render one jsonb value as the log actually stores it.
 *
 * Deliberately NOT pretty-printed into prose: this is a forensic view, and a
 * "friendly" rendering is a lossy one. Objects and arrays go through
 * JSON.stringify so nested structure survives; the empty string and null are
 * shown as themselves rather than as blank space, because "" and NULL and
 * "column absent" are three different facts an auditor needs to tell apart.
 */
function renderValue(value: unknown, present: boolean) {
  if (!present) {
    return <span className="text-text-muted italic">absent</span>;
  }
  if (value === null) {
    return <span className="text-text-muted italic">null</span>;
  }
  if (value === "") {
    return <span className="text-text-muted italic">empty string</span>;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <span className="break-all">{text}</span>;
}

function ValueCell({ change, side }: { change: FieldChange; side: "before" | "after" }) {
  const raw = side === "before" ? change.before : change.after;
  // `undefined` is the DAL's marker for "this key was not in that row image" —
  // an INSERT has no before-image, a DELETE no after-image, and a migration can
  // add or drop a column mid-history.
  return (
    <div className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-text-primary">
      {renderValue(raw, raw !== undefined)}
    </div>
  );
}

function Diff({ entry }: { entry: AuditEntry }) {
  const changes = entry.changedFields;
  if (changes.length === 0) {
    // Two identical row images. Stated honestly rather than overclaimed: with
    // migration 0017 in place a redacted change still bumps the version (that
    // is what `isRedactedOnly` keys off), so an empty diff usually means the
    // write genuinely moved nothing. Either way it is never folded away.
    if (entry.op === "UPDATE") {
      // The stripped-columns caveat is only worth stating — and only TRUE — on a
      // table that actually owns one. On the other ~38 audited tables there is
      // nothing for audit_row() to strip, so raising it would invent a doubt.
      const stripped = redactedColumnsFor(entry.tableName);
      return (
        <p className="border-t border-border-subtle bg-surface-sunken px-5 py-4 text-sm text-text-secondary">
          The two stored row images are identical, so no column that this log can show was changed.
          That is usually a write that set a row to the values it already held.
          {stripped.length > 0 && (
            <>
              {" "}
              Note that {joinColumns(stripped)} {stripped.length === 1 ? "is" : "are"} stripped from
              both images before storage and so can never appear here.
            </>
          )}
        </p>
      );
    }
    return (
      <p className="px-5 py-4 text-sm text-text-secondary">
        No field differences recorded for this entry.
      </p>
    );
  }

  // A change confined to attribution columns, yet stamped by the database as a
  // real edit. Lead with an explanation, because the diff below (updated_at,
  // version) does not carry one — but WHICH explanation depends on the table,
  // and only `users` / `employee_profiles` own a column the trigger can strip.
  // Naming password_hash/aadhar/pan on an invoice would assert a credential
  // change on a row that has never held a credential.
  const redacted = redactedColumnsFor(entry.tableName);
  const redactedNotice = entry.isRedactedOnly ? (
    <p className="border-t border-border-subtle bg-surface-sunken px-5 pt-4 text-sm text-text-secondary">
      Every column visible here is attribution, but the database bumped{" "}
      <span className="font-mono">version</span> — which since migration 0017 happens only when a
      real column changed. On <span className="font-mono">{entry.tableName}</span> that column is
      therefore one the trigger redacts: {joinColumns(redacted)}. Its value is not recoverable from
      this log; the fact that it changed, when, and by whom, is.
    </p>
  ) : entry.isPreGuardStamp ? (
    <p className="border-t border-border-subtle bg-surface-sunken px-5 pt-4 text-sm text-text-secondary">
      Every column visible here is attribution: the database moved{" "}
      <span className="font-mono">version</span> without recording a change to any other column.
      Nothing was hidden — <span className="font-mono">{entry.tableName}</span> has no column the
      trigger redacts. This is the signature of the pre-0017{" "}
      <span className="font-mono">stamp_row()</span>, which bumped{" "}
      <span className="font-mono">version</span> and <span className="font-mono">updated_at</span> on
      every update, including ones that touched only attribution. Since migration 0017 added the
      guard, this shape is no longer produced.
    </p>
  ) : null;

  const showBefore = entry.op !== "INSERT";
  const showAfter = entry.op !== "DELETE";

  return (
    <>
      {redactedNotice}
      <div
        className={`bg-surface-sunken px-5 py-4 ${redactedNotice ? "" : "border-t border-border-subtle"}`}
      >
      <div className="mb-2 flex gap-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        <div className="w-48 shrink-0">Column</div>
        {showBefore && <div className="min-w-0 flex-1">{entry.op === "DELETE" ? "Erased value" : "Before"}</div>}
        {showBefore && showAfter && <div className="w-4 shrink-0" aria-hidden />}
        {showAfter && <div className="min-w-0 flex-1">{entry.op === "INSERT" ? "New value" : "After"}</div>}
      </div>
      <div className="space-y-1.5">
        {changes.map((c) => (
          <div key={c.key} className="flex gap-3 border-b border-border-subtle pb-1.5 last:border-0 last:pb-0">
            <div className="w-48 shrink-0 font-mono text-xs font-semibold text-[var(--primary-text)]">
              {c.key}
            </div>
            {showBefore && <ValueCell change={c} side="before" />}
            {showBefore && showAfter && (
              <div className="w-4 shrink-0 text-center text-xs text-text-muted" aria-hidden>
                →
              </div>
            )}
            {showAfter && <ValueCell change={c} side="after" />}
          </div>
        ))}
      </div>
      </div>
    </>
  );
}

function Row({ entry }: { entry: AuditEntry }) {
  const actor = actorLabel(entry);
  return (
    <details className="group border-b border-border-subtle last:border-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface-hover">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-text-muted transition-transform group-open:rotate-90"
          aria-hidden
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="w-44 shrink-0 tabular text-xs text-text-secondary">{fmtAt(entry.at)}</span>
        <span className="w-16 shrink-0">
          <Badge tone={OP_TONE[entry.op]}>{entry.op}</Badge>
        </span>
        <span className="w-52 shrink-0 truncate font-mono text-xs text-text-primary">
          {entry.tableName}
        </span>
        <span className="w-24 shrink-0 truncate font-mono text-xs text-text-secondary">
          {/* NULL for composite-PK tables (user_roles, user_accounts, …). */}
          {entry.rowId ?? <span className="text-text-muted italic">—</span>}
        </span>
        <span className={`min-w-0 flex-1 truncate ${actor.muted ? "text-text-muted" : "text-text-primary"}`}>
          {actor.text}
        </span>
        {entry.isStampOnly && (
          <span className="shrink-0 rounded-full bg-[var(--neutral-status-subtle)] px-2 py-0.5 text-[10px] font-medium text-text-muted">
            attribution only
          </span>
        )}
        {entry.isRedactedOnly && (
          // Loud, not muted: this is the highest-signal row shape in the log —
          // "someone changed a credential or a regulated identifier here".
          <span className="shrink-0 rounded-full border border-[var(--pending-border)] bg-[var(--pending-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--pending-text)]">
            redacted change
          </span>
        )}
        <span className="shrink-0 tabular text-[11px] text-text-muted">
          {entry.changedFields.length} {entry.changedFields.length === 1 ? "field" : "fields"}
        </span>
      </summary>
      <Diff entry={entry} />
    </details>
  );
}

export function AuditList({
  entries,
  hiddenStampOnly = 0,
}: {
  entries: AuditEntry[];
  /**
   * How many entries this page dropped as stamp-only phantoms. Needed here and
   * not only in the pager: "nothing matched" and "everything that matched was
   * folded away" are different facts, and the page used to assert the first
   * while the pager simultaneously reported the second.
   */
  hiddenStampOnly?: number;
}) {
  if (entries.length === 0) {
    // A whole page CAN fold to nothing, so "no entries match these filters"
    // would be false there and this branch has to exist. The counts move every
    // time the fold rule narrows, so no filter is cited as a standing example:
    // `?table=payments&op=UPDATE` matched 6 rows and folded 6 of 6 under the
    // shape-only rule, but folds 3 of 6 now that a `{updated_by}` row whose
    // after-image is NULL is recognised as an ON DELETE SET NULL side effect
    // rather than a pre-delete stamp. Every row still folded here is a genuine
    // pre-delete stamp, which is what the copy below says.
    if (hiddenStampOnly > 0) {
      return (
        <p className="px-5 py-10 text-center text-sm text-text-secondary">
          All {hiddenStampOnly} {hiddenStampOnly === 1 ? "entry" : "entries"} on this page{" "}
          {hiddenStampOnly === 1 ? "was" : "were"} folded away as attribution-only stamps (the
          phantom update written just before a delete). Use{" "}
          <span className="font-medium text-text-primary">Show attribution-only changes</span> above
          to see them.
        </p>
      );
    }
    return (
      <p className="px-5 py-10 text-center text-sm text-text-secondary">
        No audit entries match these filters.
      </p>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        <span className="w-[14px] shrink-0" aria-hidden />
        <span className="w-44 shrink-0">When</span>
        <span className="w-16 shrink-0">Op</span>
        <span className="w-52 shrink-0">Table</span>
        <span className="w-24 shrink-0">Row id</span>
        <span className="min-w-0 flex-1">Actor</span>
      </div>
      {entries.map((e) => (
        <Row key={e.id} entry={e} />
      ))}
    </div>
  );
}
