import { fmt, fmtCompact, fmtExact } from "@/lib/money/format";

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
 *
 * The displayed text is always rounded (compact → ₹1.6L, full → whole rupees),
 * so the exact figure is carried in the native `title` tooltip. Pass
 * `title={false}` for the rare spot where a hover hint is unwanted.
 */
export function Money({
  value,
  compact = false,
  tone = "default",
  className = "",
  title = true,
}: {
  value: number | null | undefined;
  compact?: boolean;
  tone?: Tone;
  className?: string;
  title?: boolean;
}) {
  const text = compact ? fmtCompact(value) : fmt(value);
  const exact = fmtExact(value);
  // Only worth a tooltip when it actually reveals something the label hides.
  const showTitle = title && value != null && !isNaN(value) && exact !== text;
  const resolved: Exclude<Tone, "auto"> =
    tone === "auto" ? ((value ?? 0) < 0 ? "negative" : "default") : tone;
  return (
    <span
      className={`tabular ${showTitle ? "cursor-help" : ""} ${className}`}
      style={{ color: TONE_VAR[resolved] }}
      title={showTitle ? exact : undefined}
    >
      {text}
    </span>
  );
}
