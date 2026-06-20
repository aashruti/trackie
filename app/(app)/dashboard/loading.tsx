import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <>
      <TopbarSkeleton section="Overview" title="Dashboard" />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        {/* Today panel */}
        <Skeleton className="h-24 w-full rounded-xl" />

        {/* Section heading */}
        <div className="space-y-1">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-36" />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>

        {/* Reserves strip */}
        <Skeleton className="h-12 w-full rounded-xl" />

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>

        {/* Accounts table */}
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </main>
    </>
  );
}
