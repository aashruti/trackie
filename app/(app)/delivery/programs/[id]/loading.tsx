import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function ProgramDetailLoading() {
  return (
    <>
      <TopbarSkeleton section="Delivery" title="Program" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <Skeleton className="h-4 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </main>
    </>
  );
}
