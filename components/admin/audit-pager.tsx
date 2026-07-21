import Link from "next/link";

const btnCls =
  "inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary";
const disabledCls =
  "inline-flex h-9 cursor-not-allowed items-center rounded-md border border-border px-3 text-sm font-medium text-text-muted opacity-40";

/**
 * Prev/Next only — there is deliberately no "page 7 of 42".
 *
 * `listAuditEntries` reports `hasMore` from a 51-row fetch rather than a
 * `count(*)`, which on an append-only table of 20k+ rows would be a second full
 * scan on every page load. So the honest controls are the two we can actually
 * back with data; inventing a total here would mean paying for it.
 */
export function AuditPager({
  page,
  hasMore,
  shown,
  hiddenStampOnly,
  query,
}: {
  page: number;
  hasMore: boolean;
  /** Entries actually rendered on this page (after the stamp-only fold). */
  shown: number;
  /** Entries this page dropped as attribution-only noise. */
  hiddenStampOnly: number;
  /** The current filters, as a query string without `page`. */
  query: string;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams(query);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border-subtle px-5 py-3">
      <p className="text-xs text-text-muted">
        Page {page} · {shown} {shown === 1 ? "entry" : "entries"} shown
        {hiddenStampOnly > 0 && ` · ${hiddenStampOnly} attribution-only hidden`}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={btnCls}>
            Previous
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            Previous
          </span>
        )}
        {hasMore ? (
          <Link href={href(page + 1)} className={btnCls}>
            Next
          </Link>
        ) : (
          <span className={disabledCls} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </div>
  );
}
