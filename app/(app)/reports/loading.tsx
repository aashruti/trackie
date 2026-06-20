import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <>
      <TopbarSkeleton section="Reports" title="Reports" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <Skeleton className="h-3 w-40" />
        {/* Tab bar */}
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        {/* Table */}
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </main>
    </>
  );
}
