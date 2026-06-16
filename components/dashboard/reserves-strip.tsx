import { Money } from "@/components/ui/money";
import type { Portfolio } from "@/lib/dal/portfolio";

function Item({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex-1 px-5 py-4">
      <div className="text-xs font-medium text-text-secondary">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        <Money value={value} compact tone="info" />
      </div>
      <div className="mt-0.5 text-[11px] text-text-muted">{hint}</div>
    </div>
  );
}

/**
 * Set-aside reserves — money owed to / recoverable from the government. Visually
 * distinct from profit (info-toned, "set aside" framing) so it's never mistaken
 * for earnings.
 */
export function ReservesStrip({ reserves }: { reserves: Portfolio["reserves"] }) {
  return (
    <div className="rounded-xl border border-[var(--info-border)] bg-[var(--info-subtle)]">
      <div className="flex items-center gap-2 border-b border-[var(--info-border)] px-5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--info-text)]">
          Set aside for government
        </span>
        <span className="text-[11px] text-text-muted">— reserves, not profit</span>
      </div>
      <div className="flex flex-wrap divide-x divide-[var(--info-border)]">
        <Item label="Net GST payable" value={reserves.netGst} hint="output − input GST, remit to govt" />
        <Item label="TDS receivable" value={reserves.tdsReceivable} hint="withheld by universities (recoverable)" />
        <Item label="TDS payable" value={reserves.tdsPayable} hint="withheld from OEMs (deposit for them)" />
        <Item label="Advance TDS cost" value={reserves.advanceTdsCost} hint="fronted on advances (real cost)" />
      </div>
    </div>
  );
}
