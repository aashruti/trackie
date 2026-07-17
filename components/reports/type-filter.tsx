"use client";

import {
  CATEGORY_LABEL,
  REPORT_CATEGORIES,
  type ReportCategory,
} from "@/lib/money/report-view";

export function TypeFilter({
  selected,
  onToggle,
}: {
  selected: ReportCategory[];
  onToggle: (c: ReportCategory) => void;
}) {
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-muted">Bill types</span>
      {REPORT_CATEGORIES.map((c) => {
        const on = selected.includes(c);
        // The last selected chip is locked: an empty report is a dead end.
        const locked = on && selected.length === 1;
        return (
          <button
            key={c}
            type="button"
            onClick={() => onToggle(c)}
            aria-pressed={on}
            // aria-disabled, not `disabled`: `disabled` drops the chip out of the
            // tab order, so a keyboard user just finds one chip missing with no
            // way to reach the explanation. The click still fires — toggleCategory
            // already returns a no-op for the last type, and that pure guard, not
            // this attribute, is what keeps the selection non-empty.
            aria-disabled={locked}
            title={locked ? "At least one bill type must stay selected" : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? "border-[var(--primary-text)] bg-[var(--primary-subtle)] text-[var(--primary-text)]"
                : "border-border-strong text-text-secondary hover:bg-surface-hover"
            } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}
