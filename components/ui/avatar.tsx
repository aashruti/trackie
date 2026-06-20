import { person, initials, userColor } from "@/lib/board/constants";

/**
 * Roster/user avatar — a coloured initials chip.
 *  - `code`: a leads-roster key (RK/PN/…) → fixed roster colour.
 *  - `name`: a real user's name → initials + a deterministic colour.
 */
export function Avatar({
  code,
  name,
  size = 26,
  className = "",
}: {
  code?: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  let label: string;
  let title: string;
  let bg: string;
  let fg: string;

  if (code) {
    const p = person(code);
    label = code;
    title = p.name;
    bg = p.bg;
    fg = p.fg;
  } else {
    const n = name?.trim() || "—";
    label = name ? initials(name) : "—";
    title = n;
    const c = userColor(n);
    bg = c.bg;
    fg = c.fg;
  }

  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-grid place-items-center rounded-full font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  );
}
