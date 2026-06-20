/**
 * Small date helpers for ISO date strings ("YYYY-MM-DD"), which `date` columns
 * return. Client-safe (no server-only). ISO strings compare chronologically with
 * plain string comparison, so today/overdue checks are just `<` / `===`.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's local date as "YYYY-MM-DD". */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-06-18" → "18 Jun". Empty for null/blank. */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MON[m - 1]}`;
}

/** "2026-06-18" → "18 Jun 2026". */
export function fmtDayYear(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MON[m - 1]} ${y}`;
}

export function isOverdue(iso: string | null | undefined, today = todayISO()): boolean {
  return !!iso && iso < today;
}

export function isToday(iso: string | null | undefined, today = todayISO()): boolean {
  return !!iso && iso === today;
}
