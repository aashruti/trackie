import { statusMeta } from "@/lib/money/format";
import type { Status } from "@/lib/money/types";

const TONE: Record<string, string> = {
  positive: "bg-[var(--positive-subtle)] text-[var(--positive-text)] border-[var(--positive-border)]",
  negative: "bg-[var(--negative-subtle)] text-[var(--negative-text)] border-[var(--negative-border)]",
  pending: "bg-[var(--pending-subtle)] text-[var(--pending-text)] border-[var(--pending-border)]",
  info: "bg-[var(--info-subtle)] text-[var(--info-text)] border-[var(--info-border)]",
  neutral:
    "bg-[var(--neutral-status-subtle)] text-[var(--neutral-status-text)] border-[var(--neutral-status-border)]",
};

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[tone] ?? TONE.neutral}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const [tone, label] = statusMeta(status);
  return <Badge tone={tone}>{label}</Badge>;
}
