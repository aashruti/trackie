"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Prev/next month navigator. Writes `?month=YYYY-MM` on the current path so the
 * server component re-renders for the chosen month. By default "Next" is
 * disabled once the shown month reaches the current one (no future attendance
 * to view); pass `allowFuture` for forward-planning views like the delivery
 * calendar.
 */
export function MonthSwitcher({
  year,
  month,
  allowFuture = false,
}: {
  year: number;
  month: number;
  allowFuture?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth() + 1;
  const atCurrent = !allowFuture && (year > cy || (year === cy && month >= cm));

  function go(delta: number) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    const sp = new URLSearchParams(params.toString());
    sp.set("month", `${y}-${String(m).padStart(2, "0")}`);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      <IconBtn label="Previous month" onClick={() => go(-1)} d="M15 6l-6 6 6 6" />
      <span className="min-w-[92px] px-1 text-center text-sm font-semibold tabular text-text-primary">
        {MONTHS[month - 1]} {year}
      </span>
      <IconBtn label="Next month" onClick={() => go(1)} d="M9 6l6 6-6 6" disabled={atCurrent} />
    </div>
  );
}

function IconBtn({ label, onClick, d, disabled }: { label: string; onClick: () => void; d: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
