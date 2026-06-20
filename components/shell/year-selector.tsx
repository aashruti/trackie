"use client";

import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { setYearAction } from "@/app/(app)/actions";

export function YearSelector({
  years,
  current,
}: {
  years: string[];
  current: string;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="relative">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <select
        value={current}
        disabled={pending}
        onChange={(e) =>
          startTransition(() => setYearAction(e.target.value, pathname))
        }
        aria-label="Academic year"
        className="h-9 rounded-md border border-border-strong bg-surface pl-8 pr-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
