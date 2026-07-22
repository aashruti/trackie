"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AUDIT_ACTOR_NONE } from "@/lib/audit-view";
// Type-only — erased at compile time, so the `server-only` DAL (and the DB
// driver behind it) never reaches the browser bundle. The runtime sentinel
// above deliberately comes from the client-safe module instead.
import type { AuditFilterOptions } from "@/lib/dal/audit-log";

const controlCls =
  "h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]";

const labelCls = "text-[11px] font-medium uppercase tracking-wider text-text-muted";

/**
 * The audit feed's filter bar. Every control writes the URL rather than local
 * state, so a filtered view is linkable, survives a refresh and the back button,
 * and — the reason it matters here — is read straight off `searchParams` by the
 * server component. There is no client-side fetching of audit rows at all.
 *
 * Changing any filter resets to page 1: staying on page 7 while narrowing the
 * result set to 12 rows would land the reader on a blank page.
 */
export function AuditFilters({
  options,
  showStampOnly,
}: {
  options: AuditFilterOptions;
  showStampOnly: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    sp.delete("page");
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const hasAny = ["table", "actor", "op", "from", "to"].some((k) => params.get(k));

  // Clearing the FILTERS must not silently reset the stamp toggle — that is a
  // view preference about how the feed is rendered, not a narrowing of it.
  function clearFilters() {
    const sp = new URLSearchParams();
    if (showStampOnly) sp.set("stamps", "1");
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor="au-table">
          Table
        </label>
        <select
          id="au-table"
          className={controlCls}
          value={params.get("table") ?? ""}
          onChange={(e) => set("table", e.target.value)}
        >
          <option value="">All tables</option>
          {options.tableNames.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor="au-actor">
          Actor
        </label>
        <select
          id="au-actor"
          className={controlCls}
          value={params.get("actor") ?? ""}
          onChange={(e) => set("actor", e.target.value)}
        >
          <option value="">All actors</option>
          {/* Not one of `options.actors`: the actor-less rows have no id and no
              name to enumerate, but they are ~40% of the log, so the choice has
              to exist on its own. */}
          <option value={AUDIT_ACTOR_NONE}>System / unknown (no actor)</option>
          {options.actors.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name ?? `User #${a.id} (deleted)`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor="au-op">
          Operation
        </label>
        <select
          id="au-op"
          className={controlCls}
          value={params.get("op") ?? ""}
          onChange={(e) => set("op", e.target.value)}
        >
          <option value="">All operations</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor="au-from">
          From
        </label>
        <input
          id="au-from"
          type="date"
          className={controlCls}
          value={params.get("from") ?? ""}
          onChange={(e) => set("from", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls} htmlFor="au-to">
          To
        </label>
        <input
          id="au-to"
          type="date"
          className={controlCls}
          value={params.get("to") ?? ""}
          onChange={(e) => set("to", e.target.value)}
        />
      </div>

      <label className="flex h-9 items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--primary)]"
          checked={showStampOnly}
          onChange={(e) => set("stamps", e.target.checked ? "1" : "")}
        />
        Show attribution-only changes
      </label>

      {hasAny && (
        <button
          type="button"
          onClick={clearFilters}
          className="h-9 rounded-md border border-border px-3 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
