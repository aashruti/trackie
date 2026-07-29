import { TopbarSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function SalesPushLoading() {
  return (
    <>
      <TopbarSkeleton section="Sales" title="Sales push" />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-80 rounded-xl" />
          ))}
        </div>
      </main>
    </>
  );
}
