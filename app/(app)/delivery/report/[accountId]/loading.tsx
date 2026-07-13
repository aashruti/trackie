import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function DeliveryReportLoading() {
  return (
    <>
      <TopbarSkeleton section="Delivery" title="Delivery report" />
      <main className="mx-auto w-full max-w-[1100px] space-y-6 px-6 py-6">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </>
  );
}
