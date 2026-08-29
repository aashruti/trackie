import { fmt } from "@/lib/money/format";

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
 * Always renders the full figure — abbreviating to Cr/L was misleading at
 * scale (₹12,71,68,487 showed as "₹13Cr"). Callers that are tight on width
 * shrink the type instead, via `className`.
 */
export function Money({
  value,
  tone = "default",
  className = "",
}: {
  value: number | null | undefined;
  tone?: Tone;
  className?: string;
}) {
  const resolved: Exclude<Tone, "auto"> =
    tone === "auto" ? ((value ?? 0) < 0 ? "negative" : "default") : tone;
  return (
    <span className={`tabular ${className}`} style={{ color: TONE_VAR[resolved] }}>
      {fmt(value)}
    </span>
  );
}
