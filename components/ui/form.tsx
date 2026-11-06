export const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--ring)]";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function FormMessage({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg px-3 py-2 text-[12px] font-medium"
      style={
        ok
          ? { background: "var(--positive-subtle)", color: "var(--positive-text)" }
          : { background: "var(--negative-subtle)", color: "var(--negative-text)" }
      }
    >
      {children}
    </p>
  );
}
