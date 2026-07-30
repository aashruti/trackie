import { Money } from "@/components/ui/money";

export function AccountLogisticsMeta({
  city,
  guestHouseAvailable,
  guestHouseCostPerNight,
  preferredStayCount,
}: {
  city: string | null;
  guestHouseAvailable: boolean | null;
  guestHouseCostPerNight: number | null;
  preferredStayCount: number;
}) {
  const guestHouse = guestHouseAvailable == null
    ? "Guest house not recorded"
    : guestHouseAvailable
      ? "Guest house available"
      : "No guest house";

  return (
    <div aria-label="Delivery logistics metadata" className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="rounded-full border border-border bg-surface-sunken px-2 py-1 text-text-secondary">
        Campus: {city || "city not recorded"}
      </span>
      <span className="rounded-full border border-border bg-surface-sunken px-2 py-1 text-text-secondary">
        {guestHouse}
        {guestHouseAvailable && guestHouseCostPerNight != null && (
          <> · <Money value={guestHouseCostPerNight} />/night</>
        )}
      </span>
      <span className="rounded-full border border-border bg-surface-sunken px-2 py-1 text-text-secondary">
        {preferredStayCount} preferred stay{preferredStayCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
