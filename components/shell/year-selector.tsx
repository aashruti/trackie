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
    <select
      value={current}
      disabled={pending}
      onChange={(e) =>
        startTransition(() => setYearAction(e.target.value, pathname))
      }
      aria-label="Academic year"
      className="rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-[var(--ring)]"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
