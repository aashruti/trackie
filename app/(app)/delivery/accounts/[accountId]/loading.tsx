import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function DeliveryAccountLoading() {
  return (
    <>
      <TopbarSkeleton section="Delivery" title="Account" />
      <main className="mx-auto w-full max-w-[1180px] space-y-5 px-6 py-6">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </main>
    </>
  );
}
