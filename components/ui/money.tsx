import { fmt, fmtCompact } from "@/lib/money/format";

type Tone = "auto" | "default" | "positive" | "negative" | "pending" | "info" | "muted";

const TONE_VAR: Record<Exclude<Tone, "auto">, string> = {
  default: "var(--text-primary)",
  positive: "var(--positive-text)",
  negative: "var(--negative-text)",
  pending: "var(--pending-text)",
  info: "var(--info-text)",
  muted: "var(--text-muted)",
};

/**
 * Tabular rupee figure. `tone="auto"` colours by sign (negative → red).
 */
export function Money({
  value,
  compact = false,
  tone = "default",
  className = "",
}: {
  value: number | null | undefined;
  compact?: boolean;
  tone?: Tone;
  className?: string;
}) {
  const text = compact ? fmtCompact(value) : fmt(value);
  const resolved: Exclude<Tone, "auto"> =
    tone === "auto" ? ((value ?? 0) < 0 ? "negative" : "default") : tone;
  return (
    <span className={`tabular ${className}`} style={{ color: TONE_VAR[resolved] }}>
      {text}
    </span>
  );
}
