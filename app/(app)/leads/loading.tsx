import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

function LeadColumn({ cards }: { cards: number }) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      <Skeleton className="h-5 w-28 rounded-md" />
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LeadsLoading() {
  return (
    <>
      <TopbarSkeleton section="Sales" title="Lead management" />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        <div className="flex gap-4 overflow-x-auto pb-4">
          <LeadColumn cards={3} />
          <LeadColumn cards={5} />
          <LeadColumn cards={2} />
          <LeadColumn cards={4} />
        </div>
      </main>
    </>
  );
}
