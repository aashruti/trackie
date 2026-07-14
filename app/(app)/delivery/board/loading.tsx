import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

function BoardColumn({ cards }: { cards: number }) {
  return (
    <div className="flex w-56 shrink-0 flex-col gap-2">
      <Skeleton className="h-5 w-24 rounded-md" />
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export default function DeliveryBoardLoading() {
  return (
    <>
      <TopbarSkeleton section="Delivery" title="Delivery board" />
      <main className="flex min-h-0 flex-1 flex-col px-6 py-6">
        {/* Filter bar */}
        <div className="mb-4 flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4">
          <BoardColumn cards={2} />
          <BoardColumn cards={3} />
          <BoardColumn cards={4} />
          <BoardColumn cards={2} />
          <BoardColumn cards={1} />
          <BoardColumn cards={2} />
        </div>
      </main>
    </>
  );
}
