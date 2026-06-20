/**
 * Trackie logo — a gold "tracked value" mark (an upward node-path) + wordmark.
 * Harmonizes with Datagami's gold brand without copying the infinity mark.
 */
export function TrackieMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      {/* rising tracked path with nodes */}
      <path
        d="M7 22 L13 16 L19 19 L25 9"
        stroke="var(--primary-fg)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="22" r="2.4" fill="var(--primary-fg)" />
      <circle cx="13" cy="16" r="2.4" fill="var(--primary-fg)" />
      <circle cx="19" cy="19" r="2.4" fill="var(--primary-fg)" />
      <circle cx="25" cy="9" r="2.4" fill="var(--primary-fg)" />
    </svg>
  );
}

export function TrackieLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <TrackieMark />
      <span className="text-lg font-bold tracking-tight text-text-primary">Trackie</span>
      <span className="rounded-md border border-[var(--primary-border)] bg-[var(--primary-subtle)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--primary-text)]">
        Datagami
      </span>
    </div>
  );
}
